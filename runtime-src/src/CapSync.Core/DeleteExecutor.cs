namespace CapSync.Core;

public sealed class DeleteAttempt
{
    public required UpdateJob Job { get; set; }
    public string Status { get; set; } = "Prepared";
    public string? Reason { get; set; }
}
public interface IDeleteAdapter { Task<AddReply> DeleteUnusedAsync(UpdateJob job); }

public sealed class DeleteExecutor(IDeleteAdapter adapter,string projectDirectory,Func<Binding,PendingChange,string?>? unsupported=null,string? projectId=null)
{
    public static bool HasUnresolved(SyncState state,string? projectId=null)=>state.DeleteAttempts.Any(a=>(projectId==null || a.Job.ProjectId==projectId) && a.Status is not ("Completed" or "Abandoned"));
    public async Task RunAsync(SyncState state,Action persist,CancellationToken cancellation)
    {
        foreach(var attempt in state.DeleteAttempts.Where(a=>(projectId==null || a.Job.ProjectId==projectId) && a.Status is not ("Completed" or "Abandoned")).ToArray())
        {
            if(cancellation.IsCancellationRequested || attempt.Status=="Conflict")return;
            await Execute(state,attempt,persist);
            if(attempt.Status is not ("Completed" or "Abandoned"))return;
        }
        foreach(var pending in state.Pending.Where(p=>projectId==null || p.ProjectId==projectId).ToArray())
        {
            if(cancellation.IsCancellationRequested)return;
            if(pending.Flags!=ChangeFlags.Missing || pending.Status!="StockPresenceUnused")continue;
            var binding=state.Bindings.Single(b=>b.Id==pending.BindingId);
            var source=state.Sources.Single(s=>s.Id==pending.SourceId);
            if(source.MaterialRemoved)continue;
            if(binding.Status!="Ready"){pending.Status="WaitingForReadyRoot";continue;}
            var reason=unsupported?.Invoke(binding,pending);
            if(reason!=null){pending.Status=reason;continue;}
            if(state.UpdateAttempts.Any(a=>a.Job.SourceId==source.Id && a.Status is not ("Completed" or "Abandoned")))
            {pending.Status="WaitingForUpdateResolution";continue;}
            if(source.MaterialId==null || source.MaterialId!=pending.MaterialId || source.Version!=pending.SourceVersion ||
               source.Hash!=pending.Hash || source.Presence!=Presence.Missing || source.AppliedPath==null ||
               !SourcePaths.Comparer.Equals(source.AppliedPath,source.RelativePath) || pending.ProjectId!=binding.ProjectId || pending.MediaFolderId!=binding.MediaFolderId)
                throw new InvalidDataException("Unused deletion ownership changed before dispatch");
            var path=Path.GetFullPath(Path.Combine(binding.RootPath,SourcePaths.Relative(source.RelativePath)));
            if(!SourcePaths.Within(binding.RootPath,path))throw new InvalidDataException("Delete source escaped root");
            var attempt=new DeleteAttempt {Job=new UpdateJob(Guid.NewGuid(),source.Id,binding.Id,source.Version,binding.ProjectId,
                Path.GetFullPath(projectDirectory),binding.MediaFolderId,binding.RootPath,source.AppliedPath,source.RelativePath,
                path,source.Hash,source.MaterialId,ChangeFlags.Missing,source.Size)};
            state.DeleteAttempts.Add(attempt);pending.Status="DeletePrepared";persist();
            await Execute(state,attempt,persist);
            if(attempt.Status is not ("Completed" or "Abandoned"))return;
        }
        persist();
    }

    private async Task Execute(SyncState state,DeleteAttempt attempt,Action persist)
    {
        AddReply reply;
        try{reply=await adapter.DeleteUnusedAsync(attempt.Job);}
        catch(Exception error) when(error is IOException or InvalidOperationException or System.Text.Json.JsonException or System.ComponentModel.Win32Exception)
        {reply=new(attempt.Job.Id,"Unknown",Reason:error.Message);}
        if(reply.JobId!=attempt.Job.Id || (reply.Status=="Verified" && reply.MaterialId!=attempt.Job.MaterialId))
            reply=new(attempt.Job.Id,"Conflict",Reason:"Wrong unused deletion receipt");
        if(reply.Status=="Superseded"){attempt.Status="Abandoned";attempt.Reason=reply.Reason;persist();return;}
        var source=state.Sources.Single(s=>s.Id==attempt.Job.SourceId);
        var binding=state.Bindings.Single(b=>b.Id==attempt.Job.BindingId);
        if(reply.Status=="Verified")
        {
            if(source.MaterialId!=attempt.Job.MaterialId || source.BindingId!=binding.Id || binding.ProjectId!=attempt.Job.ProjectId ||
               !SourcePaths.Comparer.Equals(binding.RootPath,attempt.Job.RootPath) || !SourcePaths.Comparer.Equals(source.AppliedPath,attempt.Job.PreviousPath))
                reply=new(attempt.Job.Id,"Conflict",Reason:"Removed bin ownership changed");
            else
            {
                // A file can return while the stock command is completing. Keep
                // that desired revision and queue its explicit restoration.
                source.MaterialRemoved=true;source.AppliedPresence=Presence.Missing;
                attempt.Status="Completed";attempt.Reason=null;
                Reconciler.Refresh(state,binding,source,DateTimeOffset.UtcNow);persist();return;
            }
        }
        attempt.Status=reply.Status is "Waiting" or "Conflict"?reply.Status:"Unknown";attempt.Reason=reply.Reason;
        var pending=state.Pending.SingleOrDefault(p=>p.SourceId==source.Id);
        if(pending!=null){pending.Status="Delete"+attempt.Status;pending.Reason=reply.Reason;}
        persist();
    }
}
