namespace CapSync.Core;

public sealed record TransferJob(Guid Id,Guid SourceId,Guid BindingId,Guid DestinationBindingId,int SourceVersion,
    string ProjectId,string ProjectDirectory,string RootPath,string DestinationRootPath,string MediaFolderId,
    string DestinationMediaFolderId,string PreviousPath,string RelativePath,string SourcePath,string Hash,
    string FileIdentity,long Size,string MaterialId,string DestinationFolderId,ChangeFlags Flags=ChangeFlags.Path);
public sealed class TransferAttempt
{
    public required TransferJob Job {get;set;}
    public string Status {get;set;}="Prepared";
    public string? Reason {get;set;}
}
public interface ITransferAdapter {Task<AddReply> TransferAsync(TransferJob job);}

public sealed class TransferExecutor(ITransferAdapter adapter,string projectDirectory,Func<string,bool>? pathFormats=null,string? projectId=null)
{
    public static bool HasUnresolved(SyncState state,string? projectId=null)=>state.TransferAttempts.Any(a=>(projectId==null || a.Job.ProjectId==projectId) && a.Status is not ("Completed" or "Abandoned"));

    public async Task RunAsync(SyncState state,IReadOnlyList<CrossBindingMove> moves,Action persist,
        CancellationToken cancellation,bool recoverOnly=false)
    {
        foreach(var attempt in state.TransferAttempts.Where(a=>(projectId==null || a.Job.ProjectId==projectId) && a.Status is not ("Completed" or "Abandoned")).ToArray())
        {
            if(cancellation.IsCancellationRequested || attempt.Status=="Conflict")return;
            await Execute(state,attempt,persist);
            if(attempt.Status is not ("Completed" or "Abandoned"))return;
        }
        if(recoverOnly)return;
        if(state.AddAttempts.Any(a=>(projectId==null || a.Job.ProjectId==projectId) && a.Status is not ("Completed" or "Abandoned")) || UpdateExecutor.HasUnresolved(state,projectId) ||
            RestoreExecutor.HasUnresolved(state,projectId) || DeleteExecutor.HasUnresolved(state,projectId))return;
        foreach(var move in moves)
        {
            if(cancellation.IsCancellationRequested)return;
            var source=state.Sources.Single(s=>s.Id==move.SourceId);
            var old=state.Bindings.Single(b=>b.Id==move.PreviousBindingId);
            if(projectId!=null && old.ProjectId!=projectId)continue;
            var destination=state.Bindings.Single(b=>b.Id==move.DestinationBindingId);
            if(source.BindingId!=old.Id || source.Version!=move.SourceVersion || source.FileIdentity!=move.FileIdentity ||
                source.Hash!=move.Hash || source.Size!=move.Size || source.RelativePath!=move.PreviousPath || old.ProjectId!=destination.ProjectId)
                throw new InvalidDataException("Transfer observation no longer owns the source revision.");
            if(source.MaterialId==null || source.MaterialRemoved || source.AppliedHash!=move.Hash ||
                !SourcePaths.Comparer.Equals(source.AppliedPath,move.PreviousPath))continue;
            if(!(pathFormats?.Invoke(move.PreviousPath) ?? new[]{".png",".jpg",".jpeg"}.Contains(Path.GetExtension(move.PreviousPath),StringComparer.OrdinalIgnoreCase)) ||
                !SourcePaths.Comparer.Equals(Path.GetExtension(move.PreviousPath),Path.GetExtension(move.RelativePath)))continue;
            // Cycles/occupied destinations require a batch adapter; never
            // create duplicate logical paths in a partially committed state.
            if(state.Sources.Any(s=>s.Id!=source.Id && s.BindingId==destination.Id && SourcePaths.Comparer.Equals(s.RelativePath,move.RelativePath)))continue;
            var folder=FolderResolver.DirectoryOf(move.RelativePath).Length==0?destination.MediaFolderId:
                state.ManagedFolders.SingleOrDefault(f=>f.Job.BindingId==destination.Id && f.Status=="Completed" &&
                    SourcePaths.Comparer.Equals(f.Job.RelativePath,FolderResolver.DirectoryOf(move.RelativePath)))?.Job.FolderId;
            if(folder==null || !FolderResolver.OwnsDestination(state,destination,move.RelativePath,folder))continue;
            var path=Path.GetFullPath(Path.Combine(destination.RootPath,SourcePaths.Relative(move.RelativePath)));
            var job=new TransferJob(Guid.NewGuid(),source.Id,old.Id,destination.Id,source.Version,old.ProjectId,
                Path.GetFullPath(projectDirectory),old.RootPath,destination.RootPath,old.MediaFolderId,destination.MediaFolderId,
                move.PreviousPath,move.RelativePath,path,move.Hash,move.FileIdentity,move.Size,source.MaterialId,folder);
            var attempt=new TransferAttempt{Job=job};state.TransferAttempts.Add(attempt);persist();
            await Execute(state,attempt,persist);
            if(attempt.Status is not ("Completed" or "Abandoned"))return;
        }
    }

    private async Task Execute(SyncState state,TransferAttempt attempt,Action persist)
    {
        var job=attempt.Job;AddReply reply;
        try{reply=await adapter.TransferAsync(job);}
        catch(Exception error) when(error is IOException or InvalidOperationException or System.Text.Json.JsonException or System.ComponentModel.Win32Exception)
        {reply=new(job.Id,"Unknown",Reason:error.Message);}
        if(reply.JobId!=job.Id)reply=new(job.Id,"Conflict",Reason:"Wrong transfer receipt");
        if(reply.Status=="Superseded"){attempt.Status="Abandoned";attempt.Reason=reply.Reason;persist();return;}
        var source=state.Sources.Single(s=>s.Id==job.SourceId);
        var old=state.Bindings.Single(b=>b.Id==job.BindingId);var destination=state.Bindings.Single(b=>b.Id==job.DestinationBindingId);
        if(reply.Status=="Verified")
        {
            if(reply.MaterialId!=job.MaterialId || source.MaterialId!=job.MaterialId || source.BindingId!=job.BindingId ||
                source.Version!=job.SourceVersion || source.FileIdentity!=job.FileIdentity || source.Hash!=job.Hash || source.Size!=job.Size ||
                source.RelativePath!=job.PreviousPath || source.MaterialRemoved || source.AppliedHash!=job.Hash ||
                !SourcePaths.Comparer.Equals(source.AppliedPath,job.PreviousPath) || old.ProjectId!=job.ProjectId || destination.ProjectId!=job.ProjectId ||
                !SourcePaths.Comparer.Equals(old.RootPath,job.RootPath) || !SourcePaths.Comparer.Equals(destination.RootPath,job.DestinationRootPath) ||
                old.MediaFolderId!=job.MediaFolderId || destination.MediaFolderId!=job.DestinationMediaFolderId ||
                !FolderResolver.OwnsDestination(state,destination,job.RelativePath,job.DestinationFolderId) ||
                state.Sources.Any(s=>s.Id!=source.Id && s.BindingId==destination.Id && SourcePaths.Comparer.Equals(s.RelativePath,job.RelativePath)))
                reply=new(job.Id,"Conflict",Reason:"Transfer cannot change the proven material/roots/revision");
            else
            {
                source.BindingId=destination.Id;source.RelativePath=job.RelativePath;source.AppliedPath=job.RelativePath;
                source.AppliedHash=job.Hash;source.Presence=Presence.Present;source.AppliedPresence=Presence.Present;source.Version++;
                state.Pending.RemoveAll(p=>p.SourceId==source.Id);
                attempt.Status="Completed";attempt.Reason=null;persist();return;
            }
        }
        attempt.Status=reply.Status is "Waiting" or "Conflict"?reply.Status:"Unknown";attempt.Reason=reply.Reason;persist();
    }
}
