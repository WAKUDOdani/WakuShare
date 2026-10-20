namespace CapSync.Core;

public sealed record FolderJob(Guid Id, Guid BindingId, string ProjectId, string ProjectDirectory,
    string RootPath, string RelativePath, string FolderId, string ParentFolderId);
public sealed class ManagedFolder
{
    public required FolderJob Job { get; set; }
    public string Status { get; set; } = "Prepared";
    public string? Reason { get; set; }
    public Guid? BatchId { get; set; }
}
public static class FolderResolver
{
    public static string DirectoryOf(string relativeFile)
    {
        var normalized=SourcePaths.Relative(relativeFile);
        var index=normalized.LastIndexOf('/');
        return index<0 ? "" : normalized[..index];
    }

    public static bool OwnsDestination(SyncState state, Binding binding, string relativeFile, string destination)
    {
        var directory=DirectoryOf(relativeFile);
        if (directory.Length==0) return destination==binding.MediaFolderId;
        var folder=state.ManagedFolders.SingleOrDefault(f=>f.Job.BindingId==binding.Id &&
            SourcePaths.Comparer.Equals(f.Job.RelativePath,directory));
        return folder is { Status: "Completed" } && folder.Job.FolderId==destination &&
            folder.Job.ProjectId==binding.ProjectId && SourcePaths.Comparer.Equals(folder.Job.RootPath,binding.RootPath);
    }

    public static async Task<string?> EnsureAsync(SyncState state, Binding binding, string relativeFile,
        string projectDirectory, IAddAdapter adapter, Action persist, CancellationToken cancellation)
    {
        var directory=DirectoryOf(relativeFile);
        var parent=binding.MediaFolderId;
        if (directory.Length==0) return parent;
        var path="";
        foreach (var part in directory.Split('/'))
        {
            if (cancellation.IsCancellationRequested) return null;
            path=path.Length==0 ? part : path+"/"+part;
            var folder=state.ManagedFolders.SingleOrDefault(f=>f.Job.BindingId==binding.Id &&
                SourcePaths.Comparer.Equals(f.Job.RelativePath,path));
            if (folder==null)
            {
                folder=new ManagedFolder {Job=new FolderJob(Guid.NewGuid(),binding.Id,binding.ProjectId,
                    Path.GetFullPath(projectDirectory),binding.RootPath,path,Guid.NewGuid().ToString(),parent)};
                state.ManagedFolders.Add(folder);
                persist(); // Assigned UUID/parent are durable before creation.
            }
            if (folder.Job.ParentFolderId!=parent || folder.Job.ProjectId!=binding.ProjectId ||
                !SourcePaths.Comparer.Equals(folder.Job.RootPath,binding.RootPath))
            {
                folder.Status="Conflict";folder.Reason="Folder ownership/parent changed";persist();return null;
            }
            if (folder.Status=="Conflict") return null;
            if (folder.Status!="Completed")
            {
                AddReply reply;
                try { reply=await adapter.EnsureFolderAsync(folder.Job); }
                catch(Exception error) when(error is IOException or InvalidOperationException or System.Text.Json.JsonException or System.ComponentModel.Win32Exception)
                { reply=new(folder.Job.Id,"Unknown",Reason:error.Message); }
                if (reply.JobId!=folder.Job.Id || reply.Status=="Verified" && reply.MaterialId!=folder.Job.FolderId)
                    reply=new(folder.Job.Id,"Conflict",Reason:"Folder receipt identity mismatch");
                folder.Status=reply.Status=="Verified" ? "Completed" : reply.Status is "Waiting" or "Conflict" ? reply.Status : "Unknown";
                folder.Reason=reply.Reason;persist();
                if(folder.Status!="Completed")return null;
            }
            parent=folder.Job.FolderId;
        }
        return parent;
    }

    public static async Task<Dictionary<string,string>?> EnsureBatchAsync(SyncState state,Binding binding,
        string[] relativeFiles,string projectDirectory,IAddBatchAdapter adapter,Action persist,CancellationToken cancellation)
    {
        var directories=relativeFiles.Select(DirectoryOf).ToHashSet(SourcePaths.Comparer);
        bool Required(ManagedFolder f)=>f.Job.BindingId==binding.Id && directories.Any(d=>SourcePaths.Comparer.Equals(d,f.Job.RelativePath) || d.StartsWith(f.Job.RelativePath+"/",StringComparison.OrdinalIgnoreCase));
        var recovered=new HashSet<Guid>();
        foreach(var old in state.ManagedFolders.Where(f=>Required(f) && f.Status!="Completed").ToArray())
        {
            if(cancellation.IsCancellationRequested || old.Status=="Conflict")return null;
            if(old.BatchId is {} batchId)
            {
                if(!recovered.Add(batchId))continue;
                var members=state.ManagedFolders.Where(f=>f.BatchId==batchId).ToArray();
                if(members.Any(f=>f.Job.BindingId!=binding.Id || f.Status=="Conflict") || !await CompleteForest(members,batchId))return null;
            }
            else if(await EnsureAsync(state,binding,old.Job.RelativePath+"/__folder_probe__.png",projectDirectory,adapter,persist,cancellation)==null)return null;
        }
        var lookup=state.ManagedFolders.Where(f=>f.Job.BindingId==binding.Id).ToDictionary(f=>f.Job.RelativePath,SourcePaths.Comparer);
        var fresh=new List<ManagedFolder>();var forestId=Guid.NewGuid();
        foreach(var directory in directories.Where(d=>d.Length>0))
        {
            var prefix="";var parent=binding.MediaFolderId;
            foreach(var part in directory.Split('/'))
            {
                prefix=prefix.Length==0?part:prefix+"/"+part;
                if(!lookup.TryGetValue(prefix,out var folder))
                {
                    folder=new(){BatchId=forestId,Job=new(Guid.NewGuid(),binding.Id,binding.ProjectId,Path.GetFullPath(projectDirectory),binding.RootPath,prefix,Guid.NewGuid().ToString(),parent)};
                    lookup.Add(prefix,folder);fresh.Add(folder);state.ManagedFolders.Add(folder);
                }
                if(folder.Job.ParentFolderId!=parent || folder.Job.ProjectId!=binding.ProjectId || !SourcePaths.Comparer.Equals(folder.Job.RootPath,binding.RootPath))
                {folder.Status="Conflict";folder.Reason="Directory forest ownership changed";persist();return null;}
                parent=folder.Job.FolderId;
            }
        }
        if(fresh.Count>0){persist();if(cancellation.IsCancellationRequested || !await CompleteForest(fresh.ToArray(),forestId))return null;}
        return relativeFiles.Distinct(SourcePaths.Comparer).ToDictionary(file=>file,file=>DirectoryOf(file).Length==0?binding.MediaFolderId:lookup[DirectoryOf(file)].Job.FolderId,SourcePaths.Comparer);

        async Task<bool> CompleteForest(ManagedFolder[] members,Guid id)
        {
            IReadOnlyList<AddReply> replies;
            try{replies=await adapter.EnsureFoldersBatchAsync(id,members.Select(f=>f.Job).ToArray());}
            catch(Exception error) when(error is IOException or InvalidOperationException or System.Text.Json.JsonException or System.ComponentModel.Win32Exception)
            {replies=members.Select(f=>new AddReply(f.Job.Id,"Unknown",Reason:error.Message)).ToArray();}
            if(replies.Count!=members.Length || replies.Select(r=>r.JobId).Distinct().Count()!=members.Length || replies.Any(r=>!members.Any(f=>f.Job.Id==r.JobId)))
                replies=members.Select(f=>new AddReply(f.Job.Id,"Conflict",Reason:"Directory forest membership differs")).ToArray();
            foreach(var member in members.Where(f=>f.Status!="Completed"))
            {
                var reply=replies.Single(r=>r.JobId==member.Job.Id);
                member.Status=reply.Status=="Verified" && reply.MaterialId==member.Job.FolderId?"Completed":reply.Status=="Waiting"?"Waiting":reply.Status=="Conflict"?"Conflict":"Unknown";member.Reason=reply.Reason;
            }
            persist();return members.All(f=>f.Status=="Completed");
        }
    }
}
