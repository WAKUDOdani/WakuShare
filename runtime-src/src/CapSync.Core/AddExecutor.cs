namespace CapSync.Core;

public sealed record AddJob(Guid Id, Guid SourceId, Guid BindingId, int SourceVersion,
    string ProjectId, string ProjectDirectory, string MediaFolderId, string RootPath,
    string RelativePath, string SourcePath, string Hash, string? FileIdentity, long Size);
public sealed class AddAttempt
{
    public required AddJob Job { get; set; }
    public string Status { get; set; } = "Prepared";
    public string? MaterialId { get; set; }
    public string? Reason { get; set; }
    public Guid? BatchId { get; set; }
}
public sealed record AddReply(Guid JobId, string Status, string? MaterialId = null, string? Reason = null);
public interface IAddAdapter
{
    // Repeating the same job must reconcile its durable journal, never blindly reimport.
    Task<AddReply> ExecuteAsync(AddJob job);
    Task<AddReply> EnsureFolderAsync(FolderJob job) => Task.FromResult(new AddReply(job.Id,"Conflict",Reason:"Folder adapter unavailable"));
}
public interface IAddBatchAdapter : IAddAdapter
{
    bool BatchEnabled { get; }
    Task<IReadOnlyList<AddReply>> ExecuteBatchAsync(Guid batchId,IReadOnlyList<AddJob> jobs);
    Task<IReadOnlyList<AddReply>> EnsureFoldersBatchAsync(Guid batchId,IReadOnlyList<FolderJob> jobs);
}

public sealed class AddExecutor(IAddAdapter adapter, string projectDirectory,
    Func<Binding, PendingChange, string?> unsupported, string? projectId=null)
{
    public async Task RunAsync(SyncState state, Action persist, CancellationToken cancellation,bool recoverOnly=false)
    {
        // Recover old attempts before accepting new work, including attempts whose
        // source disappeared or changed while CapCut was parsing it.
        var recoveredBatches=new HashSet<Guid>();
        foreach (var attempt in state.AddAttempts.Where(a=>(projectId==null || a.Job.ProjectId==projectId) && a.Status is not ("Completed" or "Abandoned")).ToArray())
        {
            if (cancellation.IsCancellationRequested) return;
            if(attempt.BatchId is {} batchId && adapter is IAddBatchAdapter batch)
            {
                if(!recoveredBatches.Add(batchId))continue;
                var members=state.AddAttempts.Where(a=>a.BatchId==batchId).ToArray();
                if(members.Any(a=>a.Job.ProjectId!=attempt.Job.ProjectId || a.Status=="Conflict"))return;
                await ExecuteBatch(state,batch,batchId,members,persist);
                if(members.Any(a=>a.Status is not ("Completed" or "Abandoned")))return;
                continue;
            }
            if (attempt.Status=="Conflict") return;
            await Execute(state, attempt, persist);
            if (attempt.Status is not ("Completed" or "Abandoned")) return;
        }
        if(recoverOnly){persist();return;}
        if(adapter is IAddBatchAdapter {BatchEnabled:true} batches)
        {await RunBatches(state,batches,persist,cancellation);return;}
        foreach (var pending in state.Pending.Where(p=>projectId==null || p.ProjectId==projectId).ToArray())
        {
            if (cancellation.IsCancellationRequested) return;
            if (state.AddAttempts.Any(a=>a.Job.SourceId==pending.SourceId && a.Status is not ("Completed" or "Abandoned"))) continue;
            if (pending.Flags!=ChangeFlags.Add) continue; // Other lanes own their status/reason.
            var binding=state.Bindings.Single(b=>b.Id==pending.BindingId);
            var source=state.Sources.Single(s=>s.Id==pending.SourceId);
            if (binding.Status!="Ready") { pending.Status="WaitingForReadyRoot"; continue; }
            if(state.AddAttempts.Any(a=>a.Status=="Abandoned" && a.Reason=="UnsupportedMediaFile" &&
                a.Job.SourceId==source.Id && a.Job.SourceVersion==source.Version && a.Job.Hash==source.Hash &&
                a.Job.FileIdentity==source.FileIdentity))
            {pending.Status="UnsupportedMediaFile";continue;}
            if(MaterialOwnership.AppliedPathOccupied(state,binding,pending.RelativePath,source.Id))
            {
                pending.Status="WaitingForSourceRelocation";
                pending.Reason="The previous material still owns this path in CapCut; verify its relocation before importing the new file.";
                continue;
            }
            var reason=unsupported(binding,pending);
            if (reason!=null) { pending.Status=reason; continue; }
            if (source.Version!=pending.SourceVersion || source.Hash!=pending.Hash || source.MaterialId!=null ||
                source.Presence!=Presence.Present || source.RelativePath!=pending.RelativePath ||
                pending.ProjectId!=binding.ProjectId || pending.MediaFolderId!=binding.MediaFolderId)
                throw new InvalidDataException("Queue ownership changed before execution.");
            var path=Path.GetFullPath(Path.Combine(binding.RootPath,SourcePaths.Relative(pending.RelativePath)));
            if (!SourcePaths.Within(binding.RootPath,path)) throw new InvalidDataException("Source escaped binding.");
            var destination=await FolderResolver.EnsureAsync(state,binding,pending.RelativePath,projectDirectory,adapter,persist,cancellation);
            if(destination==null){pending.Status="WaitingForFolderCreation";persist();return;}
            var job=new AddJob(Guid.NewGuid(),source.Id,binding.Id,source.Version,binding.ProjectId,
                Path.GetFullPath(projectDirectory),destination,binding.RootPath,source.RelativePath,
                path,source.Hash,source.FileIdentity,source.Size);
            var attempt=new AddAttempt { Job=job };
            state.AddAttempts.Add(attempt);
            pending.Status="ImportPrepared";
            persist(); // Durable before the first possible editor mutation.
            await Execute(state,attempt,persist);
            if (attempt.Status is not ("Completed" or "Abandoned")) return;
        }
        persist();
    }

    private async Task Execute(SyncState state, AddAttempt attempt, Action persist)
    {
        AddReply reply;
        try { reply=await adapter.ExecuteAsync(attempt.Job); }
        catch (Exception error) when (error is IOException or InvalidOperationException or System.Text.Json.JsonException or System.ComponentModel.Win32Exception)
        { reply=new(attempt.Job.Id,"Unknown",Reason:error.Message); }
        ApplyReply(state,attempt,reply,persist);
    }

    private async Task RunBatches(SyncState state,IAddBatchAdapter batch,Action persist,CancellationToken cancellation)
    {
        while(!cancellation.IsCancellationRequested)
        {
            var eligible=state.Pending.Where(p=>p.Flags==ChangeFlags.Add && (projectId==null || p.ProjectId==projectId))
                .Where(p=>state.Bindings.Single(b=>b.Id==p.BindingId).Status=="Ready")
                .Where(p=>unsupported(state.Bindings.Single(b=>b.Id==p.BindingId),p)==null)
                .Where(p=>!state.AddAttempts.Any(a=>a.Job.SourceId==p.SourceId && (a.Status is not ("Completed" or "Abandoned") || a.Reason=="UnsupportedMediaFile" && a.Job.SourceVersion==p.SourceVersion && a.Job.Hash==p.Hash)))
                .Where(p=>!MaterialOwnership.AppliedPathOccupied(state,state.Bindings.Single(b=>b.Id==p.BindingId),p.RelativePath,p.SourceId)).ToArray();
            if(eligible.Length==0)break;
            var first=eligible[0];var binding=state.Bindings.Single(b=>b.Id==first.BindingId);
            var selected=eligible.Where(p=>p.BindingId==binding.Id).ToArray();
            var destinations=await FolderResolver.EnsureBatchAsync(state,binding,selected.Select(p=>p.RelativePath).ToArray(),projectDirectory,batch,persist,cancellation);
            if(destinations==null){first.Status="WaitingForFolderCreation";persist();return;}
            var id=Guid.NewGuid();var members=new List<AddAttempt>();
            foreach(var pending in selected)
            {
                var source=state.Sources.Single(s=>s.Id==pending.SourceId);
                if(source.Version!=pending.SourceVersion || source.Hash!=pending.Hash || source.MaterialId!=null || source.Presence!=Presence.Present || source.RelativePath!=pending.RelativePath || pending.ProjectId!=binding.ProjectId || pending.MediaFolderId!=binding.MediaFolderId)
                    throw new InvalidDataException("Batch queue ownership changed");
                var path=Path.GetFullPath(Path.Combine(binding.RootPath,SourcePaths.Relative(pending.RelativePath)));
                if(!SourcePaths.Within(binding.RootPath,path))throw new InvalidDataException("Batch source escaped binding");
                var attempt=new AddAttempt{BatchId=id,Job=new(Guid.NewGuid(),source.Id,binding.Id,source.Version,binding.ProjectId,Path.GetFullPath(projectDirectory),destinations[pending.RelativePath],binding.RootPath,source.RelativePath,path,source.Hash,source.FileIdentity,source.Size)};
                state.AddAttempts.Add(attempt);members.Add(attempt);pending.Status="ImportPrepared";
            }
            persist(); // Entire membership and UUIDs are durable before dispatch.
            await ExecuteBatch(state,batch,id,members.ToArray(),persist);
            if(members.Any(a=>a.Status is not ("Completed" or "Abandoned")))return;
        }
        persist();
    }

    private async Task ExecuteBatch(SyncState state,IAddBatchAdapter adapter,Guid id,AddAttempt[] members,Action persist)
    {
        IReadOnlyList<AddReply> replies;
        try{replies=await adapter.ExecuteBatchAsync(id,members.Select(a=>a.Job).ToArray());}
        catch(Exception error) when(error is IOException or InvalidOperationException or System.Text.Json.JsonException or System.ComponentModel.Win32Exception)
        {replies=members.Select(a=>new AddReply(a.Job.Id,"Unknown",Reason:error.Message)).ToArray();}
        if(replies.Count!=members.Length || replies.Select(r=>r.JobId).Distinct().Count()!=members.Length || replies.Any(r=>!members.Any(a=>a.Job.Id==r.JobId)))
            replies=members.Select(a=>new AddReply(a.Job.Id,"Conflict",Reason:"Batch receipt membership differs")).ToArray();
        foreach(var member in members.Where(a=>a.Status is not ("Completed" or "Abandoned")))
            ApplyReply(state,member,replies.Single(r=>r.JobId==member.Job.Id),()=>{});
        persist();
    }

    private static void ApplyReply(SyncState state,AddAttempt attempt,AddReply reply,Action persist)
    {
        if (reply.JobId!=attempt.Job.Id) reply=new(attempt.Job.Id,"Conflict",Reason:"Receipt belongs to another job.");
        // Only a native preflight with zero dispatched editor mutations can
        // issue this result. Retain its rejected revision and let other files
        // proceed. New bytes/identity require a new proof, never a timer retry.
        if(reply.Status=="RejectedFormat")
        {
            attempt.Status="Abandoned";attempt.Reason="UnsupportedMediaFile";
            var rejected=state.Pending.SingleOrDefault(p=>p.SourceId==attempt.Job.SourceId);
            if(rejected!=null)rejected.Status="UnsupportedMediaFile";
            persist();return;
        }
        if (reply.Status=="Superseded")
        {
            attempt.Status="Abandoned"; attempt.Reason=reply.Reason;
            persist(); return;
        }
        if (reply.Status=="Verified")
        {
            var source=state.Sources.Single(s=>s.Id==attempt.Job.SourceId);
            var binding=state.Bindings.Single(b=>b.Id==attempt.Job.BindingId);
            if (string.IsNullOrWhiteSpace(reply.MaterialId) || source.BindingId!=binding.Id ||
                binding.ProjectId!=attempt.Job.ProjectId || !FolderResolver.OwnsDestination(state,binding,attempt.Job.RelativePath,attempt.Job.MediaFolderId) ||
                !SourcePaths.Comparer.Equals(binding.RootPath,attempt.Job.RootPath) ||
                source.MaterialId!=null && source.MaterialId!=reply.MaterialId ||
                MaterialOwnership.Conflicts(state,source,attempt.Job.ProjectId,reply.MaterialId))
                reply=new(attempt.Job.Id,"Conflict",Reason:"Verified ID conflicts with source ownership.");
            else
            {
                // Apply the imported revision, not a newer desired revision. This
                // preserves the returned ID if the source changed/disappeared.
                source.MaterialId=reply.MaterialId;
                source.AppliedHash=attempt.Job.Hash;
                source.AppliedPath=attempt.Job.RelativePath;
                source.AppliedPresence=Presence.Present;
                attempt.Status="Completed"; attempt.MaterialId=reply.MaterialId; attempt.Reason=null;
                Reconciler.Refresh(state,binding,source,DateTimeOffset.UtcNow);
                persist(); return;
            }
        }
        attempt.Status=reply.Status is "Waiting" or "Conflict" ? reply.Status : "Unknown";
        attempt.Reason=reply.Reason;
        var pending=state.Pending.SingleOrDefault(p=>p.SourceId==attempt.Job.SourceId);
        if (pending!=null) pending.Status=attempt.Status=="Waiting" ? "WaitingForMediaView" : "Import"+attempt.Status;
        persist();
    }
}
