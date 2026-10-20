namespace CapSync.Core;

// This lane observes stock missing/restore behavior only. It never invokes a
// project mutation and therefore has no uncertain native dispatch to replay.
public interface IPresenceAdapter { Task<AddReply> TrackPresenceAsync(UpdateJob job); }

public sealed class PresenceTracker(IPresenceAdapter adapter,string projectDirectory,string? projectId=null)
{
    public async Task RunAsync(SyncState state,Action persist,CancellationToken cancellation)
    {
        foreach(var pending in state.Pending.Where(p=>projectId==null || p.ProjectId==projectId).ToArray())
        {
            if(cancellation.IsCancellationRequested)return;
            if((pending.Flags & (ChangeFlags.Missing|ChangeFlags.Restore))==0)continue;
            var binding=state.Bindings.Single(b=>b.Id==pending.BindingId);
            var source=state.Sources.Single(s=>s.Id==pending.SourceId);
            if(source.MaterialRemoved)
            {pending.Status="WaitingForRemovedMaterialRestore";pending.Reason="The bin card was removed; stock missing-file recovery cannot recreate it";continue;}
            if(state.DeleteAttempts.Any(a=>a.Job.SourceId==source.Id && a.Status is not ("Completed" or "Abandoned")))
            {pending.Status="WaitingForDeleteResolution";continue;}
            if(state.UpdateAttempts.Any(a=>a.Job.SourceId==source.Id && a.Status is not ("Completed" or "Abandoned")))
            {pending.Status="WaitingForUpdateResolution";continue;}
            if(binding.Status!="Ready"){pending.Status="WaitingForReadyRoot";continue;}
            if(pending.Flags is not (ChangeFlags.Missing or ChangeFlags.Restore))
            {pending.Status="WaitingForPresenceContentAdapter";continue;}
            if(source.AppliedPath==null || !SourcePaths.Comparer.Equals(source.RelativePath,source.AppliedPath))
            {pending.Status="WaitingForPresencePathAdapter";continue;}
            var expected=pending.Flags==ChangeFlags.Missing?Presence.Missing:Presence.Present;
            if(source.MaterialId==null || source.MaterialId!=pending.MaterialId || source.Version!=pending.SourceVersion ||
                source.Hash!=pending.Hash || source.Presence!=expected || pending.ProjectId!=binding.ProjectId ||
                pending.MediaFolderId!=binding.MediaFolderId)
                throw new InvalidDataException("Presence ownership changed before observation");
            if(pending.Flags==ChangeFlags.Restore && source.Hash!=source.AppliedHash)
            {pending.Status="WaitingForPresenceContentAdapter";continue;}
            var path=Path.GetFullPath(Path.Combine(binding.RootPath,SourcePaths.Relative(source.RelativePath)));
            if(!SourcePaths.Within(binding.RootPath,path))throw new InvalidDataException("Presence source escaped root");
            // Stable identity per observed revision, with no mutable request
            // overwrite and no unbounded new job on each retry of that revision.
            var key=System.Text.Encoding.UTF8.GetBytes($"{pending.Id}:{source.Version}:{pending.Flags}");
            var id=new Guid(System.Security.Cryptography.SHA256.HashData(key).AsSpan(0,16));
            var job=new UpdateJob(id,source.Id,binding.Id,source.Version,binding.ProjectId,
                Path.GetFullPath(projectDirectory),binding.MediaFolderId,binding.RootPath,source.AppliedPath,
                source.RelativePath,path,source.Hash,source.MaterialId,pending.Flags,source.Size);
            AddReply reply;
            try{reply=await adapter.TrackPresenceAsync(job);}
            catch(Exception error) when(error is IOException or InvalidOperationException or System.Text.Json.JsonException or System.ComponentModel.Win32Exception)
            {reply=new(id,"Waiting",Reason:error.Message);}
            if(reply.JobId!=id || (reply.Status=="Verified" && reply.MaterialId!=job.MaterialId))
                reply=new(id,"Conflict",Reason:"Wrong stock presence receipt");
            if(reply.Status=="Verified")
            {
                if(source.Version!=job.SourceVersion || source.MaterialId!=job.MaterialId || source.Presence!=expected ||
                    source.Hash!=job.Hash || !SourcePaths.Comparer.Equals(source.RelativePath,job.RelativePath) ||
                    binding.ProjectId!=job.ProjectId || !SourcePaths.Comparer.Equals(binding.RootPath,job.RootPath))
                {pending.Status="PresenceObservationStale";continue;}
                source.AppliedPresence=expected;
                Reconciler.Refresh(state,binding,source,DateTimeOffset.UtcNow);
            }
            else {pending.Status="StockPresence"+reply.Status;pending.Reason=reply.Reason;}
            persist();
        }
        persist();
    }
}
