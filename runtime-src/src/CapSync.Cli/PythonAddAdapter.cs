using System.Diagnostics;
using System.Text.Json;
using CapSync.Core;

internal sealed class PythonAddAdapter(string workspace, string journal, bool refreshJpeg=false, bool refreshPng=false,bool recoverOnly=false,bool photoPaths=false,bool crossBinding=false) : IAddAdapter,IUpdateAdapter,IPresenceAdapter,IDeleteAdapter,IRestoreAdapter,ITransferAdapter
{
    public static async Task<JsonElement> EnsureFolderViewAsync(string workspace)
    {
        var start=new ProcessStartInfo("python") {
            UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true,
            StandardOutputEncoding=System.Text.Encoding.UTF8,StandardErrorEncoding=System.Text.Encoding.UTF8
        };
        start.Environment["PYTHONIOENCODING"]="utf-8";
        start.ArgumentList.Add(Path.Combine(workspace,"tools","live_folder_view.py"));
        using var process=Process.Start(start) ?? throw new IOException("Cannot start folder-view setup.");
        var stdout=process.StandardOutput.ReadToEndAsync();var stderr=process.StandardError.ReadToEndAsync();
        await process.WaitForExitAsync();var output=await stdout;var error=await stderr;
        if(process.ExitCode!=0)throw new IOException("Folder-view setup: "+error.Trim());
        using var reply=JsonDocument.Parse(output);
        if(reply.RootElement.GetProperty("status").GetString()!="ready")throw new IOException("Folder-view setup not confirmed.");
        return reply.RootElement.Clone();
    }

    public Task<AddReply> ExecuteAsync(AddJob job) => Invoke(job.Id,job,"live_add.py",journal);
    public Task<AddReply> TransferAsync(TransferJob job)=>Invoke(job.Id,job,"live_photo_path.py",
        Path.Combine(Path.GetDirectoryName(journal)!,"transfer-journal"));
    public Task<AddReply> EnsureFolderAsync(FolderJob job) => Invoke(job.Id,job,"live_folder.py",
        Path.Combine(Path.GetDirectoryName(journal)!,"folder-journal"));
    public Task<AddReply> UpdateAsync(UpdateJob job)
    {
        var generalPhoto=photoPaths && job.Flags==ChangeFlags.Path &&
            new[]{".png",".jpg",".jpeg"}.Contains(Path.GetExtension(job.RelativePath),StringComparer.OrdinalIgnoreCase);
        return Invoke(job.Id,job,generalPhoto?"live_photo_path.py":
            job.Flags.HasFlag(ChangeFlags.Content)?"live_content.py":job.DestinationFolderId==null?"live_update.py":"live_move.py",
            Path.Combine(Path.GetDirectoryName(journal)!,generalPhoto?"photo-path-journal":
                job.Flags.HasFlag(ChangeFlags.Content)?"content-journal":job.DestinationFolderId==null?"update-journal":"move-journal"));
    }
    public Task<AddReply> TrackPresenceAsync(UpdateJob job) => Invoke(job.Id,job,"live_presence.py",
        Path.Combine(Path.GetDirectoryName(journal)!,"presence-journal"));
    public Task<AddReply> DeleteUnusedAsync(UpdateJob job) => Invoke(job.Id,job,"live_delete_unused.py",
        Path.Combine(Path.GetDirectoryName(journal)!,"delete-journal"));
    public Task<AddReply> RestoreRemovedAsync(RestoreJob job) => Invoke(job.Import.Id,job,"live_restore_removed.py",
        Path.Combine(Path.GetDirectoryName(journal)!,"restore-journal"));

    private async Task<AddReply> Invoke<T>(Guid id,T job,string script,string directory)
    {
        if(recoverOnly)script="live_reconcile.py";
        Directory.CreateDirectory(directory);
        var request=Path.Combine(directory,id+".request.json");
        var bytes=JsonSerializer.SerializeToUtf8Bytes(job,StateStore.JsonOptions);
        if (File.Exists(request))
        {
            var existing=JsonSerializer.Deserialize<T>(File.ReadAllBytes(request),StateStore.JsonOptions);
            if (!Equals(existing,job))
                return new(id,"Conflict",Reason:"Job request changed.");
        }
        else
        {
            using var file=new FileStream(request,FileMode.CreateNew,FileAccess.Write,FileShare.Read);
            file.Write(bytes); file.Flush(true);
        }
        var start=new ProcessStartInfo("python") {
            UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true,
            StandardOutputEncoding=System.Text.Encoding.UTF8,StandardErrorEncoding=System.Text.Encoding.UTF8
        };
        start.Environment["PYTHONIOENCODING"]="utf-8";
        start.Environment["CAPSYNC_LAB_JPEG_CONTENT"]=refreshJpeg?"1":"0";
        start.Environment["CAPSYNC_LAB_PNG_CONTENT"]=refreshPng?"1":"0";
        start.Environment["CAPSYNC_LAB_PHOTO_PATHS"]=photoPaths?"1":"0";
        start.Environment["CAPSYNC_LAB_CROSS_BINDING"]=crossBinding?"1":"0";
        start.ArgumentList.Add(Path.Combine(workspace,"tools",script));
        start.ArgumentList.Add("--request"); start.ArgumentList.Add(request);
        start.ArgumentList.Add("--journal"); start.ArgumentList.Add(directory);
        using var process=Process.Start(start) ?? throw new IOException("Cannot start live-add adapter.");
        var stdout=process.StandardOutput.ReadToEndAsync();
        var stderr=process.StandardError.ReadToEndAsync();
        // Let an in-flight operation finish even if the watcher is stopping.
        await process.WaitForExitAsync();
        var output=await stdout; var error=await stderr;
        if (process.ExitCode!=0) throw new IOException("Live-add adapter: "+error.Trim());
        return JsonSerializer.Deserialize<AddReply>(output,StateStore.JsonOptions)
            ?? throw new IOException("Empty adapter receipt.");
    }
}
