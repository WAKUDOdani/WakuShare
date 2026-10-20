namespace CapSync.Core;

public sealed record RestoreJob(AddJob Import,string PreviousMaterialId);
public sealed class RestoreAttempt
{
    public required RestoreJob Job { get; set; }
    public string Status { get; set; } = "Prepared";
    public string? MaterialId { get; set; }
    public string? Reason { get; set; }
}
public interface IRestoreAdapter { Task<AddReply> RestoreRemovedAsync(RestoreJob job); }

// Only a removed, unused bin card may receive a new ID. Used missing sources
// stay in PresenceTracker and never enter this import lane.
public sealed class RestoreExecutor(IRestoreAdapter adapter,string projectDirectory,
    Func<Binding,PendingChange,string?>? unsupported=null,string? projectId=null)
{
    public static bool HasUnresolved(SyncState state,string? projectId=null)=>state.RestoreAttempts.Any(a=>(projectId==null || a.Job.Import.ProjectId==projectId) && a.Status is not ("Completed" or "Abandoned"));
    public async Task RunAsync(SyncState state,Action persist,CancellationToken cancellation)
    {
        foreach(var attempt in state.RestoreAttempts.Where(a=>(projectId==null || a.Job.Import.ProjectId==projectId) && a.Status is not ("Completed" or "Abandoned")).ToArray())
        {
            if(cancellation.IsCancellationRequested || attempt.Status=="Conflict")return;
            await Execute(state,attempt,persist);
            if(attempt.Status is not ("Completed" or "Abandoned"))return;
        }
        foreach(var pending in state.Pending.Where(p=>projectId==null || p.ProjectId==projectId).ToArray())
        {
            if(cancellation.IsCancellationRequested)return;
            var source=state.Sources.Single(s=>s.Id==pending.SourceId);
            if(!source.MaterialRemoved || (pending.Flags & ChangeFlags.Restore)==0)continue;
            var binding=state.Bindings.Single(b=>b.Id==pending.BindingId);
            if(binding.Status!="Ready"){pending.Status="WaitingForReadyRoot";continue;}
            if(!SourcePaths.Comparer.Equals(source.RelativePath,source.AppliedPath))
            {pending.Status="WaitingForRemovedMaterialMove";continue;}
            var reason=unsupported?.Invoke(binding,pending);
            if(reason!=null){pending.Status=reason;continue;}
            if(UpdateExecutor.HasUnresolved(state,projectId) || DeleteExecutor.HasUnresolved(state,projectId) ||
                state.AddAttempts.Any(a=>(projectId==null || a.Job.ProjectId==projectId) && a.Status is not ("Completed" or "Abandoned")))return;
            if(source.MaterialId==null || source.MaterialId!=pending.MaterialId || source.Version!=pending.SourceVersion ||
                source.Hash!=pending.Hash || source.Presence!=Presence.Present || source.AppliedPresence!=Presence.Missing ||
                pending.ProjectId!=binding.ProjectId || pending.MediaFolderId!=binding.MediaFolderId)
                throw new InvalidDataException("Removed material ownership changed before restoration");
            var directory=FolderResolver.DirectoryOf(source.RelativePath);
            var destination=directory==""?binding.MediaFolderId:state.ManagedFolders.SingleOrDefault(f=>
                f.Job.BindingId==binding.Id && SourcePaths.Comparer.Equals(f.Job.RelativePath,directory) && f.Status=="Completed")?.Job.FolderId;
            if(destination==null){pending.Status="WaitingForRestoreFolder";continue;}
            var path=Path.GetFullPath(Path.Combine(binding.RootPath,SourcePaths.Relative(source.RelativePath)));
            if(!SourcePaths.Within(binding.RootPath,path))throw new InvalidDataException("Restore escaped root");
            var attempt=new RestoreAttempt {Job=new(new AddJob(Guid.NewGuid(),source.Id,binding.Id,source.Version,
                binding.ProjectId,Path.GetFullPath(projectDirectory),destination,binding.RootPath,source.RelativePath,
                path,source.Hash,source.FileIdentity,source.Size),source.MaterialId)};
            state.RestoreAttempts.Add(attempt);pending.Status="RestorePrepared";persist();
            await Execute(state,attempt,persist);
            if(attempt.Status is not ("Completed" or "Abandoned"))return;
        }
        persist();
    }

    private async Task Execute(SyncState state,RestoreAttempt attempt,Action persist)
    {
        var job=attempt.Job.Import;
        AddReply reply;
        try{reply=await adapter.RestoreRemovedAsync(attempt.Job);}
        catch(Exception error) when(error is IOException or InvalidOperationException or System.Text.Json.JsonException or System.ComponentModel.Win32Exception)
        {reply=new(job.Id,"Unknown",Reason:error.Message);}
        if(reply.JobId!=job.Id)reply=new(job.Id,"Conflict",Reason:"Wrong restore receipt");
        if(reply.Status=="Superseded"){attempt.Status="Abandoned";attempt.Reason=reply.Reason;persist();return;}
        var source=state.Sources.Single(s=>s.Id==job.SourceId);
        var binding=state.Bindings.Single(b=>b.Id==job.BindingId);
        if(reply.Status=="Verified")
        {
            if(string.IsNullOrWhiteSpace(reply.MaterialId) || MaterialOwnership.Has(source,reply.MaterialId) ||
                !source.MaterialRemoved || source.MaterialId!=attempt.Job.PreviousMaterialId || source.BindingId!=binding.Id ||
                binding.ProjectId!=job.ProjectId || !SourcePaths.Comparer.Equals(binding.RootPath,job.RootPath) ||
                !FolderResolver.OwnsDestination(state,binding,job.RelativePath,job.MediaFolderId) ||
                MaterialOwnership.Conflicts(state,source,job.ProjectId,reply.MaterialId))
                reply=new(job.Id,"Conflict",Reason:"Restore cannot claim this bin identity");
            else
            {
                source.RetiredMaterialIds.Add(source.MaterialId);
                source.MaterialId=reply.MaterialId;source.MaterialRemoved=false;
                source.AppliedPath=job.RelativePath;source.AppliedHash=job.Hash;source.AppliedPresence=Presence.Present;
                attempt.Status="Completed";attempt.MaterialId=reply.MaterialId;attempt.Reason=null;
                Reconciler.Refresh(state,binding,source,DateTimeOffset.UtcNow);persist();return;
            }
        }
        attempt.Status=reply.Status is "Waiting" or "Conflict"?reply.Status:"Unknown";attempt.Reason=reply.Reason;
        var pending=state.Pending.SingleOrDefault(p=>p.SourceId==source.Id);
        if(pending!=null){pending.Status="Restore"+attempt.Status;pending.Reason=reply.Reason;}
        persist();
    }
}
