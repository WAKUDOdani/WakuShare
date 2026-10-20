using System.Diagnostics;
using System.Text.Json;
using CapSync.Core;

// Development-only bridge to the accepted lab primitives. No old polling runner.
internal sealed class ExplorerNativeAdapter(string root, string statePath, EditorEventChannel editor, bool productRuntime = false, Action<string,string>? progress = null) : IAddBatchAdapter, IUpdateAdapter, IPresenceAdapter, IRestoreAdapter, IDeleteAdapter, ITransferAdapter
{
    public string Mode => productRuntime ? "product" : "laboratory";
    public bool BatchEnabled => productRuntime;
    public async Task<IReadOnlyList<AddReply>> ExecuteBatchAsync(Guid batchId,IReadOnlyList<AddJob> jobs)
    {
        if(!productRuntime || jobs.Count is <1 or >16384 || jobs.Any(j=>j.ProjectId!=editor.Lease()?.ProjectKey))
            return jobs.Select(j=>new AddReply(j.Id,"Waiting",Reason:"Wait for the batch's project to be open.")).ToArray();
        Status="Applying";
        try {
            var value=await Invoke(new {action="batch",batchId,jobs,statePath,editor=editor.State,token=editor.Token});
            var replies=value.GetProperty("Replies").Deserialize<AddReply[]>(StateStore.JsonOptions) ?? throw new InvalidDataException("Missing batch replies");
            var commands=value.GetProperty("NativeCommands").GetInt32();if(commands is <0 or >2)throw new InvalidDataException("Invalid batch command count");Commands+=commands;
            var failed=replies.FirstOrDefault(r=>r.Status is not ("Verified" or "RejectedFormat"));Status=failed?.Status ?? "Verified";Reason=failed?.Reason;
            return replies;
        }catch(Exception error) when(error is IOException or JsonException or InvalidDataException) {
            Status="Unknown";Reason="Batch completion is unknown; no automatic replay.";return jobs.Select(j=>new AddReply(j.Id,"Unknown",Reason:Reason)).ToArray();
        }
    }
    public async Task<IReadOnlyList<AddReply>> EnsureFoldersBatchAsync(Guid batchId,IReadOnlyList<FolderJob> folders)
    {
        if(!productRuntime || folders.Count is <1 or >4096 || folders.Any(j=>j.ProjectId!=editor.Lease()?.ProjectKey))
            return folders.Select(j=>new AddReply(j.Id,"Waiting",Reason:"Wait for the directory forest's project.")).ToArray();
        var jobs=folders.Select(j=>new {j.Id,j.ProjectId,j.RootPath,j.FolderId,j.ParentFolderId,Name=Path.GetFileName(j.RelativePath),SourceDirectory=Path.Combine(j.RootPath,j.RelativePath)}).ToArray();
        Status="Applying";
        try{
            var value=await Invoke(new{action="folders",batchId,jobs,statePath,editor=editor.State,token=editor.Token,destinations=Destinations});
            var replies=value.GetProperty("Replies").Deserialize<AddReply[]>(StateStore.JsonOptions) ?? throw new InvalidDataException("Missing directory forest replies");
            var count=value.GetProperty("NativeCommands").GetInt32();if(count is <0 or >1)throw new InvalidDataException("Invalid forest command count");Commands+=count;
            var failed=replies.FirstOrDefault(r=>r.Status!="Verified");Status=failed?.Status ?? "Verified";Reason=failed?.Reason;return replies;
        }catch(Exception error) when(error is IOException or JsonException or InvalidDataException){Status="Unknown";Reason="Directory forest completion is unknown; no replay.";return folders.Select(j=>new AddReply(j.Id,"Unknown",Reason:Reason)).ToArray();}
    }
    public bool RemainderEnabled => productRuntime || Environment.GetEnvironmentVariable("WAKUSHARE_LAB_REMAINDER") == "1";
    public sealed record Destination(Guid Id, string RootPath, string MediaFolderId, string ContainerFolderId, string Name);
    public Destination[] Destinations { get; set; } = [];
    public long Commands { get; private set; }
    public string? Reason { get; private set; }
    public string Status { get; private set; } = "Waiting";
    public static int? FindEditor()
    {
        var found = new List<int>();
        foreach (var process in Process.GetProcessesByName("CapCut"))
        {
            using (process) try {
                if (process.Modules.Cast<ProcessModule>().Any(module => module.ModuleName.Equals("VECreator.dll", StringComparison.OrdinalIgnoreCase))) found.Add(process.Id);
            } catch (Exception error) when (error is System.ComponentModel.Win32Exception or InvalidOperationException) { }
        }
        return found.Count == 1 ? found[0] : null;
    }
    public async Task Bootstrap()
    {
        await Invoke(new { action = "bootstrap", bridge = new { editor.ProcessId, editor.PipeName, editor.Token },
            evidence = Path.Combine(Path.GetDirectoryName(statePath)!, "native-session-" + editor.ConnectionId.ToString("N")) });
    }
    private async Task<JsonElement> Invoke(object request, string helper = "explorer_native_runtime.py")
    {
        if (productRuntime) helper = "explorer_product_runtime_v6.py";
        var start = new ProcessStartInfo("python") { UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true,
            StandardInputEncoding = new System.Text.UTF8Encoding(false), StandardOutputEncoding = new System.Text.UTF8Encoding(false) };
        start.Environment["PYTHONIOENCODING"] = "utf-8";
        start.ArgumentList.Add(Path.Combine(root, "tools", helper));
        using var process = Process.Start(start) ?? throw new IOException("Cannot start native development adapter.");
        var progressProject = editor.State.Project?.Value;
        var stdout = process.StandardOutput.ReadToEndAsync();
        var stderr = ReadDiagnostics(process.StandardError, progressProject);
        await process.StandardInput.WriteAsync(JsonSerializer.Serialize(request, StateStore.JsonOptions)); process.StandardInput.Close();
        await process.WaitForExitAsync();
        var output = await stdout; var diagnostic = await stderr;
        if (output.Length > (productRuntime ? 8 * 1024 * 1024 : 65536) || process.ExitCode != 0) {
            var directory = Path.Combine(Path.GetDirectoryName(statePath)!, "adapter-errors"); Directory.CreateDirectory(directory);
            await File.WriteAllTextAsync(Path.Combine(directory, Guid.NewGuid().ToString("N") + ".json"),
                JsonSerializer.Serialize(new { helper, exitCode = process.ExitCode, stderr = diagnostic[..Math.Min(diagnostic.Length, 65536)] }, StateStore.JsonOptions));
            throw new IOException("Native adapter stopped; inspect its private journal.");
        }
        return JsonDocument.Parse(output).RootElement.Clone();
    }
    private async Task<string> ReadDiagnostics(StreamReader reader,string? project)
    {
        var diagnostic = new System.Text.StringBuilder();
        while(await reader.ReadLineAsync() is {} line)
        {
            if(line.StartsWith("WAKUSHARE_STAGE ",StringComparison.Ordinal) && project != null &&
                line[16..] is "preparing" or "importing" or "placing" or "checking")
                progress?.Invoke(project,line[16..]);
            else if(diagnostic.Length<65536)diagnostic.AppendLine(line[..Math.Min(line.Length,65536-diagnostic.Length)]);
        }
        return diagnostic.ToString();
    }
    public async Task<AddReply> Run(string kind, object job, Guid id, string projectKey, string? identity = null, string? retiredMaterialId = null)
    {
        var lease = editor.Lease();
        if (lease == null || lease.ProjectKey != projectKey || (!productRuntime && editor.State.Project?.DraftId != "582F1BF9-2B25-4CF2-B83F-3528F1B868B2"))
            return new(id, "Waiting", Reason: productRuntime ? "Wait for this job's project to be open; another project's queue is retained." : "Open the authorized laboratory project; native dispatch is laboratory-only.");
        try {
            Status = "Applying";
            var value = await Invoke(new { action = "execute", kind, job, statePath, editor = editor.State, token = editor.Token, fileIdentity = identity, retiredMaterialId, mediaAdapters = RemainderEnabled, destinations = Destinations });
            var reply = value.Deserialize<AddReply>(StateStore.JsonOptions) ?? throw new InvalidDataException("Empty native reply.");
            if (value.TryGetProperty("NativeCommands", out var commands)) {
                if (!commands.TryGetInt32(out var count) || count < 0 || count > (RemainderEnabled ? 24 : 8)) throw new InvalidDataException("Invalid native command count.");
                Commands += count;
            }
            // A late durable result remains owned by the old job, never the new project.
            Reason = reply.Reason; Status = reply.Status == "RejectedFormat" ? "Waiting" : reply.Status;
            return reply;
        } catch (Exception error) when (error is IOException or JsonException or InvalidDataException) {
            Reason = "Native completion is unknown; automatic replay is disabled.";
            Status = "Unknown";
            return new(id, "Unknown", Reason: Reason);
        }
    }
    public async Task<bool> EnsureRoots(SyncState state, Action persist, CancellationToken cancellation)
    {
        var current = editor.State.Project;
        if (current == null) return false;
        foreach (var destination in Destinations)
        {
            foreach (var folder in new[] {
                (Id: destination.ContainerFolderId, Parent: "", Name: "WakuShare"),
                (Id: destination.MediaFolderId, Parent: destination.ContainerFolderId, Name: destination.Name) }.Where(folder => folder.Id.Length > 0))
            {
                if (cancellation.IsCancellationRequested) return false;
                // The adapter's durable marker owns creation; an existing UUID is
                // accepted only with its matching verified receipt.
                var id = Guid.Parse(folder.Id);
                var directory = productRuntime || folder.Parent != "" ? destination.RootPath : Path.Combine(root, "research", "fixtures", "AutoAddLab", "ExplorerRuntime");
                if (!productRuntime) Directory.CreateDirectory(Path.Combine(root, "research", "fixtures", "AutoAddLab", "ExplorerRuntime"));
                if (!Directory.Exists(directory)) { Status = "Waiting"; Reason = "Selected source root is unavailable."; return false; }
                var reply = await Run("folder", new { Id = id, ProjectId = current.Value, RootPath = directory,
                    FolderId = folder.Id, ParentFolderId = folder.Parent, Name = folder.Name, SourceDirectory = directory }, id, current.Value);
                if (reply.Status != "Verified") return false;
            }
            var binding = state.Bindings.Single(b => b.Id == destination.Id);
            binding.Status = "Ready"; persist();
        }
        return true;
    }
    public Task<AddReply> ExecuteAsync(AddJob job) => Run("add", job, job.Id, job.ProjectId, job.FileIdentity);
    public Task<AddReply> TransferAsync(TransferJob job) => RemainderEnabled
        ? Run("transfer", job, job.Id, job.ProjectId, job.FileIdentity)
        : Task.FromResult(new AddReply(job.Id, "Waiting", Reason: "Cross-root laboratory acceptance is not enabled."));
    public Task<AddReply> RestoreRemovedAsync(RestoreJob job) => Run("restore", job.Import, job.Import.Id, job.Import.ProjectId, job.Import.FileIdentity, job.PreviousMaterialId);
    public async Task<string[]?> ReadCatalog()
    {
        if (!RemainderEnabled || editor.Lease() == null) return null;
        var project = editor.State.Project!;
        try {
            var result = await Invoke(new { action = "catalog", statePath, editor = editor.State, token = editor.Token }, "explorer_catalog_runtime.py");
            if (!result.GetProperty("Verified").GetBoolean() || editor.State.Project != project ||
                result.GetProperty("ProjectKey").GetString() != project.Value || result.GetProperty("DraftId").GetString() != project.DraftId) return null;
            var ids = result.GetProperty("MaterialIds").Deserialize<string[]>() ?? [];
            if (ids.Length > (productRuntime ? 16384 : 512) || ids.Any(string.IsNullOrWhiteSpace) || ids.Distinct(StringComparer.Ordinal).Count() != ids.Length)
                throw new InvalidDataException("Invalid complete catalog identities.");
            return ids;
        } catch (Exception error) when (error is IOException or JsonException or InvalidDataException) {
            Reason = "A complete SDK/catalog read is unavailable; no restoration was dispatched."; Status = "Waiting"; return null;
        }
    }
    public async Task<AddReply> TrackPresenceAsync(UpdateJob job)
    {
        if (!RemainderEnabled || editor.Lease()?.ProjectKey != job.ProjectId) return new(job.Id, "Waiting", Reason: "Wait for the owned laboratory session.");
        try {
            var source = new StateStore(statePath).Load().Sources.Single(s => s.Id == job.SourceId);
            var result = await Invoke(new { action = "presence", job, statePath, editor = editor.State, token = editor.Token, fileIdentity = source.FileIdentity }, "explorer_catalog_runtime.py");
            return result.Deserialize<AddReply>(StateStore.JsonOptions) ?? new(job.Id, "Waiting", Reason: "Empty presence observation.");
        } catch (Exception error) when (error is IOException or JsonException or InvalidDataException) {
            return new(job.Id, "Waiting", Reason: "Source presence is changing; wait for the next event.");
        }
    }
    public async Task<AddReply> DeleteUnusedAsync(UpdateJob job)
    {
        if (!RemainderEnabled || editor.Lease()?.ProjectKey != job.ProjectId) return new(job.Id, "Waiting", Reason: "Wait for the owned laboratory session.");
        try {
            var result = await Invoke(new { action = "delete", job, statePath, editor = editor.State, token = editor.Token }, "explorer_catalog_runtime.py");
            if (result.TryGetProperty("NativeCommands", out var commands) && commands.TryGetInt32(out var count) && count is >= 0 and <= 1) Commands += count;
            return result.Deserialize<AddReply>(StateStore.JsonOptions) ?? new(job.Id, "Unknown", Reason: "Empty stock removal receipt; no replay.");
        } catch (Exception error) when (error is IOException or JsonException or InvalidDataException) {
            return new(job.Id, "Unknown", Reason: "Stock removal completion is unknown; no automatic replay.");
        }
    }
    public Task<AddReply> UpdateAsync(UpdateJob job)
    {
        if (job.Flags != ChangeFlags.Path || !(RemainderEnabled ? MediaFormats.IsCandidate(job.RelativePath) :
            new[] { ".png", ".jpg", ".jpeg" }.Contains(Path.GetExtension(job.RelativePath), StringComparer.OrdinalIgnoreCase)))
        {
            Status = "Waiting"; Reason = "Wait for an accepted media path adapter.";
            return Task.FromResult(new AddReply(job.Id, "Waiting", Reason: Reason));
        }
        var state = new StateStore(statePath).Load();
        return Run("update", job, job.Id, job.ProjectId, state.Sources.Single(source => source.Id == job.SourceId).FileIdentity);
    }
    public Task<AddReply> EnsureFolderAsync(FolderJob job) => Run("folder", new {
        job.Id, job.ProjectId, job.RootPath, job.FolderId, job.ParentFolderId,
        Name = Path.GetFileName(job.RelativePath), SourceDirectory = Path.Combine(job.RootPath, job.RelativePath)
    }, job.Id, job.ProjectId);
}
