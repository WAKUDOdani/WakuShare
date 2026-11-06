namespace CapSync.Core;

public sealed record UpdateJob(Guid Id, Guid SourceId, Guid BindingId, int SourceVersion,
    string ProjectId, string ProjectDirectory, string MediaFolderId, string RootPath,
    string PreviousPath, string RelativePath, string SourcePath, string Hash,
    string MaterialId, ChangeFlags Flags, long Size, string? DestinationFolderId = null);
public sealed class UpdateAttempt
{
    public required UpdateJob Job { get; set; }
    public string Status { get; set; } = "Prepared";
    public string? Reason { get; set; }
}
public interface IUpdateAdapter { Task<AddReply> UpdateAsync(UpdateJob job); }

public sealed class UpdateExecutor(IUpdateAdapter adapter, string projectDirectory,
    IAddAdapter? folders=null,Func<Binding,PendingChange,string?>? unsupportedMove=null,
    Func<string,bool>? pathFormats=null,bool observeContentOnly=false,string? projectId=null)
{
    public static bool HasUnresolved(SyncState state,string? projectId=null) => state.UpdateAttempts.Any(a=>(projectId==null || a.Job.ProjectId==projectId) && a.Status is not ("Completed" or "Abandoned"));

    public async Task RunAsync(SyncState state, Action persist, CancellationToken cancellation,bool recoverOnly=false)
    {
        foreach(var attempt in state.UpdateAttempts.Where(a=>(projectId==null || a.Job.ProjectId==projectId) && a.Status is not ("Completed" or "Abandoned")).ToArray())
        {
            if(cancellation.IsCancellationRequested || attempt.Status=="Conflict")return;
            await Execute(state,attempt,persist);
            if(attempt.Status is not ("Completed" or "Abandoned"))return;
        }
        if(recoverOnly){persist();return;}
        foreach(var pending in state.Pending.Where(p=>projectId==null || p.ProjectId==projectId).ToArray())
        {
            if(cancellation.IsCancellationRequested)return;
            if(pending.Flags==ChangeFlags.Add)continue;
            if((pending.Flags & (ChangeFlags.Missing|ChangeFlags.Restore))!=0)continue;
            if((pending.Flags & ~(ChangeFlags.Path|ChangeFlags.Content))!=0){pending.Status="WaitingForMirrorAdapter";continue;}
            var binding=state.Bindings.Single(b=>b.Id==pending.BindingId);
            var source=state.Sources.Single(s=>s.Id==pending.SourceId);
            if(binding.Status!="Ready"){pending.Status="WaitingForReadyRoot";continue;}
            // This product delegates byte refresh to CapCut. Do not prepare a
            // native content job that would hold later, independent imports.
            if(observeContentOnly && (pending.Flags & ChangeFlags.Content)!=0)
            {pending.Status="ObservedContentChange";pending.Reason="CapCut manages content refresh; no native command was prepared.";continue;}
            var imageFormats=new HashSet<string>(StringComparer.OrdinalIgnoreCase){".png",".jpg",".jpeg"};
            var renameFormats=new HashSet<string>(StringComparer.OrdinalIgnoreCase){".gif",".wav",".mp3",".mp4",".mov"};
            var supportedImages=pathFormats==null && imageFormats.Contains(Path.GetExtension(pending.RelativePath)) &&
                source.AppliedPath!=null && imageFormats.Contains(Path.GetExtension(source.AppliedPath));
            var renameOnly=pending.Flags==ChangeFlags.Path && source.AppliedPath!=null &&
                (pathFormats!=null ? pathFormats(pending.RelativePath) && pathFormats(source.AppliedPath) &&
                    SourcePaths.Comparer.Equals(Path.GetExtension(pending.RelativePath),Path.GetExtension(source.AppliedPath)) &&
                    MediaFormats.Kind(pending.RelativePath)==MediaFormats.Kind(source.AppliedPath) :
                    renameFormats.Contains(Path.GetExtension(pending.RelativePath)) && renameFormats.Contains(Path.GetExtension(source.AppliedPath)));
            if((!supportedImages && !renameOnly) || source.AppliedPath==null)
            {pending.Status="WaitingForUpdateFormat";continue;}
            var moving=!SourcePaths.Comparer.Equals(FolderResolver.DirectoryOf(source.AppliedPath),FolderResolver.DirectoryOf(pending.RelativePath));
            string? destination=null;
            if(moving)
            {
                if(pending.Flags!=ChangeFlags.Path || folders==null || unsupportedMove==null)
                {pending.Status="WaitingForFileMoveAdapter";continue;}
                var reason=unsupportedMove(binding,pending);
                if(reason!=null){pending.Status=reason;continue;}
                if(source.MaterialRemoved || source.AppliedHash!=source.Hash)
                {pending.Status="WaitingForMoveContentAdapter";continue;}
            }
            if(source.MaterialId==null || source.MaterialId!=pending.MaterialId || source.Version!=pending.SourceVersion ||
                source.Hash!=pending.Hash || source.Presence!=Presence.Present || pending.ProjectId!=binding.ProjectId ||
                pending.MediaFolderId!=binding.MediaFolderId)
                throw new InvalidDataException("Update ownership changed before dispatch");
            var path=Path.GetFullPath(Path.Combine(binding.RootPath,SourcePaths.Relative(pending.RelativePath)));
            if(!SourcePaths.Within(binding.RootPath,path))throw new InvalidDataException("Update source escaped root");
            if(moving)
            {
                destination=await FolderResolver.EnsureAsync(state,binding,pending.RelativePath,projectDirectory,folders!,persist,cancellation);
                if(destination==null){pending.Status="WaitingForMoveFolder";persist();return;}
            }
            var attempt=new UpdateAttempt {Job=new UpdateJob(Guid.NewGuid(),source.Id,binding.Id,source.Version,binding.ProjectId,
                Path.GetFullPath(projectDirectory),binding.MediaFolderId,binding.RootPath,source.AppliedPath,source.RelativePath,
                path,source.Hash,source.MaterialId,pending.Flags,source.Size,destination)};
            state.UpdateAttempts.Add(attempt);pending.Status="UpdatePrepared";persist();
            await Execute(state,attempt,persist);
            if(attempt.Status is not ("Completed" or "Abandoned"))return;
        }
        persist();
    }

    private async Task Execute(SyncState state,UpdateAttempt attempt,Action persist)
    {
        AddReply reply;
        try{reply=await adapter.UpdateAsync(attempt.Job);}
        catch(Exception error) when(error is IOException or InvalidOperationException or System.Text.Json.JsonException or System.ComponentModel.Win32Exception)
        {reply=new(attempt.Job.Id,"Unknown",Reason:error.Message);}
        if(reply.JobId!=attempt.Job.Id)reply=new(attempt.Job.Id,"Conflict",Reason:"Wrong update job receipt");
        if(reply.Status=="Superseded"){attempt.Status="Abandoned";attempt.Reason=reply.Reason;persist();return;}
        var source=state.Sources.Single(s=>s.Id==attempt.Job.SourceId);
        var binding=state.Bindings.Single(b=>b.Id==attempt.Job.BindingId);
        if(reply.Status=="Verified")
        {
            if(reply.MaterialId!=attempt.Job.MaterialId || source.MaterialId!=reply.MaterialId ||
                binding.ProjectId!=attempt.Job.ProjectId || binding.Id!=source.BindingId ||
                !SourcePaths.Comparer.Equals(binding.RootPath,attempt.Job.RootPath) ||
                (attempt.Job.DestinationFolderId!=null && !FolderResolver.OwnsDestination(state,binding,attempt.Job.RelativePath,attempt.Job.DestinationFolderId)))
                reply=new(attempt.Job.Id,"Conflict",Reason:"Update cannot replace owned bin ID");
            else
            {
                source.AppliedPath=attempt.Job.RelativePath;source.AppliedHash=attempt.Job.Hash;source.AppliedPresence=Presence.Present;
                attempt.Status="Completed";attempt.Reason=null;
                Reconciler.Refresh(state,binding,source,DateTimeOffset.UtcNow);persist();return;
            }
        }
        attempt.Status=reply.Status is "Waiting" or "Conflict" ? reply.Status : "Unknown";attempt.Reason=reply.Reason;
        var pending=state.Pending.SingleOrDefault(p=>p.SourceId==source.Id);
        if(pending!=null)pending.Status="Update"+attempt.Status;
        persist();
    }
}
