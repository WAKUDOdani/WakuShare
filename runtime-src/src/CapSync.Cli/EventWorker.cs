using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading.Channels;
using CapSync.Core;

// Versioned worker. Planning is the default; the explicit development native
// capability is restricted to the authorized laboratory and negotiated by main.
internal sealed class EventWorker
{
    private const int ProtocolVersion = 1, MaxFrameChars = 32768, ReplayWindow = 256;
    private static readonly JsonSerializerOptions Json = new(StateStore.JsonOptions) { WriteIndented = false };
    private readonly SyncState _state;
    private readonly StateStore _store;
    private readonly string _statePath;
    private EditorEventChannel? _editor;
    private ExplorerNativeAdapter? _native;
    private readonly string? _nativeRoot;
    private readonly bool _productRuntime;
    private readonly EditorProcessEvents? _processEvents;
    private Task<int>? _processRead;
    private Task? _bootstrap, _execution;
    private CancellationTokenSource? _nativeCancellation;
    private Task<EditorObservation?>? _editorRead;
    private readonly Dictionary<string, (string Hash, Reply Reply)> _replies = new(StringComparer.Ordinal);
    private readonly Queue<string> _replyOrder = new();
    private EventPlanningEngine? _engine;
    private CancellationTokenSource? _planningCancellation;
    private Task<EventPlanningResult>? _planning;
    private EventPlanningResult? _last;
    private string _phase = "Paused";
    private long _outSequence, _epoch, _batches;
    private readonly object _outputLock = new();
    private int _sources, _pending;
    private sealed record ImportStage(string Project,string Phase);
    private readonly Channel<ImportStage> _stages = Channel.CreateBounded<ImportStage>(new BoundedChannelOptions(64) { SingleReader=true, FullMode=BoundedChannelFullMode.DropOldest });
    private Task<ImportStage>? _stageRead;
    private ImportStage? _importStage;
    private void ReportStage(string project,string phase) => _stages.Writer.TryWrite(new(project,phase));
    private sealed record Reply(bool Ok, object? Result = null, string? Error = null);
    private sealed record Request(string Id, string Command, JsonElement Payload, string Hash);
    private sealed record Frame(string? Text, bool TooLarge = false);
    private sealed class ProtocolException(string code) : Exception(code);

    private EventWorker(StateStore store, SyncState state, string statePath, int? editorPid, string? nativeRoot, bool productRuntime)
    {
        _store = store; _state = state; _statePath = statePath; _sources = state.Sources.Count; _pending = state.Pending.Count;
        _nativeRoot = nativeRoot; _productRuntime = productRuntime;
        if (productRuntime && nativeRoot != null) _processEvents = new();
        if (editorPid.HasValue) _editor = new(editorPid.Value);
        if (nativeRoot != null && _editor != null) {
            _native = new(nativeRoot, statePath, _editor, productRuntime, ReportStage);
            foreach (var binding in state.Bindings) binding.Status = "Suspended";
        }
    }

    public static async Task<int> Run(string statePath, int? editorPid = null, string? nativeRoot = null, bool productRuntime = false)
    {
        statePath = Path.GetFullPath(statePath);
        if (!File.Exists(statePath)) throw new InvalidDataException("event-worker requires an existing explicit private state.");
        // Own both modes before loading; a stale snapshot never starts a worker.
        using var observerLease = new FileStream(statePath + ".observer.lock", FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
        using var executorLease = new FileStream(statePath + ".executor.lock", FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
        var store = new StateStore(statePath); var state = store.Load();
        if (state.Bindings.Any(b => SourcePaths.Within(b.RootPath, statePath)))
            throw new InvalidDataException("Keep worker state outside source roots.");
        var worker = new EventWorker(store, state, statePath, editorPid, nativeRoot, productRuntime);
        return await worker.Loop();
    }

    private async Task<int> Loop()
    {
        using var inputCancellation = new CancellationTokenSource();
        // Explicit UTF-8 works with Electron pipes as well as a UTF-8 console.
        using var input = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false, true), false, 4096, leaveOpen: true);
        var read = ReadFrame(input, inputCancellation.Token);
        _stageRead = _stages.Reader.ReadAsync(inputCancellation.Token).AsTask();
        _editorRead = _editor?.ReadAsync();
        try
        {
            if (_processEvents != null) { await _processEvents.Ready; _processRead = _processEvents.ReadAsync(); }
            Emit("event", null, new { name = "ready", state = Snapshot(), capabilities = new {
                planningOnly = !NativeManaged, nativeDispatch = NativeManaged, runtimeConfiguration = true,
                maxFrameChars = MaxFrameChars, replayWindow = ReplayWindow, recurringScanTimers = 0,
                nativeObservation = _editor != null || _processEvents != null, nativeManaged = NativeManaged
            }, bridge = _editor == null || _native != null ? null : new {
                _editor.PipeName, _editor.Token, _editor.ConnectionId, _editor.ProcessId
            }});
            if (_native != null) _bootstrap = _native.Bootstrap();
            while (true)
            {
                var waiting = new List<Task> { read };
                waiting.Add(_stageRead);
                if (_planning != null) waiting.Add(_planning);
                if (_editorRead != null) waiting.Add(_editorRead);
                if (_bootstrap != null) waiting.Add(_bootstrap);
                if (_execution != null) waiting.Add(_execution);
                if (_processRead != null) waiting.Add(_processRead);
                await Task.WhenAny(waiting);
                if(_stageRead.IsCompleted) {
                    _importStage=await _stageRead;
                    _stageRead=_stages.Reader.ReadAsync(inputCancellation.Token).AsTask();
                    if(_importStage.Project==_editor?.State.Project?.Value && _execution!=null)
                        Emit("event",null,new{name="stateChanged",state=Snapshot()});
                }
                if (_bootstrap is { IsCompleted: true }) {
                    try { await _bootstrap; } catch (IOException) {
                        _editor!.Disconnect("NativeBootstrapFailed"); _editor.Dispose();
                        if (_editorRead != null) try { await _editorRead; } catch (Exception error) when (error is OperationCanceledException or ObjectDisposedException or IOException) { }
                        _editorRead = null;
                        Emit("event", null, new { name = "editorChanged", state = Snapshot() });
                    }
                    _bootstrap = null;
                }
                if (_editorRead is { IsCompleted: true }) await CompleteEditorRead();
                if (_execution is { IsCompleted: true }) await CompleteExecution();
                // Commit a completed batch before handling a simultaneous pause.
                if (_planning is { IsCompleted: true }) await CompletePlanning();
                if (_processRead is { IsCompleted: true }) {
                    var candidate = await _processRead; _processRead = _processEvents!.ReadAsync();
                    if (_bootstrap == null && (_editor == null || _editor.State.Status is "Disconnected" or "Faulted")) {
                        var pid = ExplorerNativeAdapter.FindEditor();
                        if (pid == candidate) await ConnectEditor(candidate);
                    }
                }
                if (!read.IsCompleted) continue;
                var frame = await read;
                if (frame.TooLarge)
                {
                    await Pause(); _phase = "Faulted";
                    Emit("event", null, new { name = "fault", code = "FrameTooLarge", state = Snapshot() });
                    return 2;
                }
                if (frame.Text == null)
                {
                    await Pause(); _phase = "Stopped";
                    Emit("event", null, new { name = "stopped", reason = "ParentDisconnected", state = Snapshot() });
                    return 0;
                }
                Request? request = null;
                try
                {
                    request = Parse(frame.Text);
                    if (_replies.TryGetValue(request.Id, out var prior))
                    {
                        Respond(request.Id, prior.Hash == request.Hash ? prior.Reply : new(false, Error: "RequestIdConflict"));
                    }
                    else
                    {
                        var reply = await Dispatch(request);
                        Remember(request, reply); Respond(request.Id, reply);
                        if (request.Command == "stop" && reply.Ok)
                        {
                            Emit("event", null, new { name = "stopped", reason = "Requested", state = Snapshot() });
                            return 0;
                        }
                    }
                }
                catch (Exception error) when (error is JsonException or ProtocolException)
                {
                    var reply = new Reply(false, Error: error.Message);
                    if (request != null) Remember(request, reply);
                    Respond(request?.Id, reply);
                }
                read = ReadFrame(input, inputCancellation.Token);
            }
        }
        finally
        {
            inputCancellation.Cancel();
            try { if(_stageRead!=null)await _stageRead; } catch(OperationCanceledException) { }
            _processEvents?.Dispose();
            _editor?.Dispose();
            await Pause();
            // Observe the bounded reader's cancellation before releasing stdin.
            try { await read; } catch (OperationCanceledException) { }
            if (_editorRead != null)
                try { await _editorRead; } catch (Exception error) when (error is OperationCanceledException or IOException or ObjectDisposedException) { }
        }
    }

    private bool NativeManaged => _native != null || (_productRuntime && _nativeRoot != null);
    private async Task ConnectEditor(int processId)
    {
        var running = _phase == "Running";
        await Pause();
        _editor?.Dispose();
        if (_editorRead != null) try { await _editorRead; } catch (Exception error) when (error is OperationCanceledException or ObjectDisposedException or IOException) { }
        _editor = new(processId); _native = new(_nativeRoot!, _statePath, _editor, productRuntime: true, progress:ReportStage);
        foreach (var binding in _state.Bindings) binding.Status = "Suspended";
        _editorRead = _editor.ReadAsync(); _bootstrap = _native.Bootstrap();
        if (running) Start();
        Emit("event", null, new { name = "editorChanged", state = Snapshot() });
    }
    private int CurrentProjectCount(IEnumerable<Guid> bindingIds)
    {
        var active = _state.Bindings.Where(binding => binding.ProjectId == _editor?.State.Project?.Value).Select(binding => binding.Id).ToHashSet();
        return bindingIds.Count(active.Contains);
    }
    private object? ImportProgress()
    {
        if (_editor?.State.Project is not { } project) return null;
        var bindings = _state.Bindings.Where(b => b.ProjectId == project.Value && b.Status != "Suspended").ToArray();
        var ids = bindings.Select(b => b.Id).ToHashSet();
        var sources = _state.Sources.Where(s => ids.Contains(s.BindingId) && s.Presence == Presence.Present).ToArray();
        var rejected = _state.AddAttempts.Where(a => a.Job.ProjectId == project.Value && a.Status == "Abandoned" && a.Reason == "UnsupportedMediaFile")
            .Select(a => (a.Job.SourceId, a.Job.SourceVersion)).ToHashSet();
        var imported = sources.Count(s => s.MaterialId != null && !s.MaterialRemoved);
        var skipped = sources.Count(s => s.MaterialId == null && rejected.Contains((s.Id, s.Version)));
        var roots = bindings.Select(b => SourcePaths.NormalizeRoot(b.RootPath)).ToHashSet(SourcePaths.Comparer);
        var total = Math.Max(sources.Length, (_last?.InventoryRoots ?? []).Where(r => roots.Contains(SourcePaths.NormalizeRoot(r.RootPath))).Sum(r => r.Files));
        var pending = _state.Pending.Where(p => ids.Contains(p.BindingId)).ToArray();
        var settled = pending.All(p => p.Flags == ChangeFlags.Add && rejected.Contains((p.SourceId, p.SourceVersion)));
        var stopped = _native?.Status is "Conflict" or "Unknown";
        var phase = stopped ? "stopped" : _editor.State.Status != "Project" || bindings.Length == 0 || _last == null ? "preparing" :
            _last.EditorBlocked || _native?.Status == "Waiting" ? "waiting" :
            _execution != null && _importStage?.Project == project.Value ? _importStage.Phase :
            _state.ManagedFolders.Any(f => ids.Contains(f.Job.BindingId) && f.Status != "Completed") ? "folders" :
            imported + skipped < total ? "preparing" : _execution != null || !settled ? "checking" : "ready";
        return new { projectKey = project.Value, total, imported, skipped, phase };
    }
    private object Snapshot() => new {
        phase = _phase, planningOnly = !NativeManaged, editorCommands = _native?.Commands ?? 0,
        nativeMode = NativeManaged ? (_productRuntime ? "product" : "laboratory") : null,
        sources = _productRuntime ? CurrentProjectCount(_state.Sources.Select(source => source.BindingId)) : _sources,
        pending = _productRuntime ? CurrentProjectCount(_state.Pending.Select(change => change.BindingId)) : _pending,
        runtimeEpoch = _epoch, batches = _batches,
        work = _last?.Work ?? new PlanningWork(0, 0, 0, 0, 0),
        readiness = _last?.Readiness ?? new ReadinessRetryStatus(0, 0, 0, 0),
        configurationRevision = _state.WatchConfiguration?.Revision ?? 0,
        inventoryRoots = _last?.InventoryRoots ?? [],
        watches = _phase == "Running" ? _last?.Watches ?? [] : [],
        editor = _editor?.State,
        nativeStatus = _native?.Status, nativeReason = _native?.Reason, nativeBusy = _execution != null,
        importProgress = ImportProgress(),
        editorBlocked = _phase != "Running" || (_last?.EditorBlocked ?? true) ||
            _editor != null && (_editor.State.Status != "Project" || !_state.Bindings.Any(binding => binding.ProjectId == _editor.State.Project?.Value)),
        blockedProjects = _last?.BlockedProjects ?? []
    };
    private void Emit(string type, string? requestId, object payload)
    {
        lock(_outputLock) Console.WriteLine(JsonSerializer.Serialize(new {
            protocolVersion = ProtocolVersion, sequence = ++_outSequence, type, requestId, payload
        }, Json));
    }
    private void Respond(string? id, Reply reply) => Emit("response", id, new { ok = reply.Ok, result = reply.Result, error = reply.Error });

    private async Task CompleteEditorRead()
    {
        var reading = _editorRead!; _editorRead = null;
        try
        {
            var observation = await reading;
            if (observation == null)
            {
                _editor!.Disconnect("NativeDisconnected"); _editor.Dispose();
                _engine?.SessionChanged("ProjectClosed");
            }
            else
            {
                var generation = _editor!.State.Generation;
                _editor.Apply(observation);
                _engine?.SessionChanged(generation != _editor.State.Generation ? "ProjectChanged" : "MediaChanged");
                _editorRead = _editor.ReadAsync();
            }
        }
        catch (Exception error) when (error is IOException or InvalidDataException or JsonException or InvalidOperationException or FormatException or ArgumentException)
        {
            _editor!.Disconnect("NativeProtocolFault"); _editor.Dispose();
            _engine?.SessionChanged("ProjectClosed");
        }
        Emit("event", null, new { name = "editorChanged", state = Snapshot() });
    }

    private async Task<Reply> Dispatch(Request request)
    {
        var payload = request.Payload;
        switch (request.Command)
        {
            case "configure":
                Fields(payload, "expectedRevision", "revision", "roots");
                var expectedRevision = Integer(payload, "expectedRevision"); var revision = Integer(payload, "revision");
                if (!payload.TryGetProperty("roots", out var rootList) || rootList.ValueKind != JsonValueKind.Array ||
                    rootList.GetArrayLength() > 256 || rootList.EnumerateArray().Any(item => item.ValueKind != JsonValueKind.String))
                    throw new ProtocolException("InvalidField:roots");
                string[] roots;
                try { roots = WatchConfigurationRules.Roots(rootList.EnumerateArray().Select(item => item.GetString()!), _statePath); }
                catch (Exception error) when (error is InvalidDataException or ArgumentException)
                { return new(false, Error: "InvalidObservedRoots"); }
                var current = _state.WatchConfiguration?.Revision ?? 0;
                if (revision == current && roots.SequenceEqual(_state.WatchConfiguration?.Roots ?? [], SourcePaths.Comparer))
                    return new(true, Snapshot());
                if (expectedRevision != current || revision <= current) return new(false, Error: "ConfigurationConflict");
                if (roots.SequenceEqual(_state.WatchConfiguration?.Roots ?? [], SourcePaths.Comparer))
                {
                    _state.WatchConfiguration = new(revision, roots); _store.Save(_state);
                    return new(true, Snapshot());
                }
                var resume = _phase == "Running";
                await Pause(); _state.WatchConfiguration = new(revision, roots); _store.Save(_state); _last = null;
                if (resume) Start();
                return new(true, Snapshot());
            case "project":
                Fields(payload, "projectKey", "bindings");
                var projectKey = String(payload, "projectKey");
                if (_native == null || _editor?.State.Project?.Value != projectKey || _editor.State.Status != "Project")
                    return new(false, Error: "ProjectNotConfirmed");
                if (!payload.TryGetProperty("bindings", out var bindingList) || bindingList.ValueKind != JsonValueKind.Array || bindingList.GetArrayLength() > 256)
                    return new(false, Error: "InvalidProjectBindings");
                foreach (var item in bindingList.EnumerateArray()) Fields(item, "Id", "RootPath", "MediaFolderId", "ContainerFolderId", "Name");
                var destinations = bindingList.Deserialize<ExplorerNativeAdapter.Destination[]>(Json)!;
                if (destinations.Any(binding => binding.Id == Guid.Empty || !Guid.TryParse(binding.MediaFolderId, out _) ||
                    (!(_productRuntime && binding.ContainerFolderId == "") && !Guid.TryParse(binding.ContainerFolderId, out _)) ||
                    string.IsNullOrWhiteSpace(binding.Name) || binding.Name.Length > 80 || binding.Name.IndexOfAny(['/', '\\']) >= 0 ||
                    !(_state.WatchConfiguration?.Roots ?? []).Contains(binding.RootPath, SourcePaths.Comparer)) || destinations.Select(b => b.Id).Distinct().Count() != destinations.Length)
                    return new(false, Error: "InvalidProjectBindings");
                foreach (var destination in destinations) {
                    var priorBinding = _state.Bindings.SingleOrDefault(b => b.Id == destination.Id);
                    if (priorBinding != null && (priorBinding.ProjectId != projectKey || priorBinding.MediaFolderId != destination.MediaFolderId || !SourcePaths.Comparer.Equals(priorBinding.RootPath, destination.RootPath)))
                        return new(false, Error: "BindingOwnershipConflict");
                }
                var running = _phase == "Running"; await Pause();
                if (_editor.State.Project?.Value != projectKey) return new(false, Error: "ProjectChanged");
                foreach (var binding in _state.Bindings) binding.Status = "Suspended";
                foreach (var destination in destinations) {
                    var binding = _state.Bindings.SingleOrDefault(b => b.Id == destination.Id);
                    if (binding == null) { binding = new() { Id = destination.Id, ProjectId = projectKey, RootPath = destination.RootPath, MediaFolderId = destination.MediaFolderId }; _state.Bindings.Add(binding); }
                    binding.Status = "WaitingForRootFolder";
                }
                _native.Destinations = destinations; _store.Save(_state);
                if (running) Start();
                return new(true, Snapshot());
            case "status": Fields(payload); return new(true, Snapshot());
            case "start":
                Fields(payload);
                if (_phase != "Running")
                {
                    Start();
                }
                return new(true, Snapshot());
            case "pause": Fields(payload); await Pause(); return new(true, Snapshot());
            case "stop": Fields(payload); await Pause(); _phase = "Stopped"; return new(true, Snapshot());
            case "rescan":
                Fields(payload, "root", "audit");
                if (_engine == null) return new(false, Error: "WorkerPaused");
                var root = String(payload, "root");
                if (payload.TryGetProperty("audit", out var value) && value.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
                    throw new ProtocolException("InvalidField:audit");
                var audit = value.ValueKind == JsonValueKind.True;
                try { _engine.Rescan(root, "ManualRescan", audit); }
                catch (Exception error) when (error is InvalidDataException or ArgumentException)
                { return new(false, Error: "InvalidOrUnconfiguredRoot"); }
                return new(true, new { queued = true });
            case "session":
                Fields(payload, "event");
                var reason = String(payload, "event");
                if (reason is not ("ProjectOpened" or "ProjectClosed" or "ProjectChanged" or "MediaChanged" or "Resume" or "DeviceChanged"))
                    throw new ProtocolException("InvalidSessionEvent");
                if (_engine == null) return new(false, Error: "WorkerPaused");
                _engine.SessionChanged(reason); return new(true, new { queued = true });
            default: return new(false, Error: "UnknownCommand");
        }
    }

    private void Start()
    {
        _engine = new(_state); _engine.Configure(); _last = null;
        ++_epoch; _phase = "Running"; SchedulePlanning();
    }

    private void SchedulePlanning()
    {
        _planningCancellation = new();
        _planning = _engine!.NextAsync(_planningCancellation.Token);
    }
    private async Task CompletePlanning(bool restart = true)
    {
        var current = _planning!; _planning = null;
        try
        {
            var result = await current;
            _store.Save(_state);
            _last = result; ++_batches; _sources = _state.Sources.Count; _pending = _state.Pending.Count;
            Emit("event", null, new { name = "stateChanged", state = Snapshot() });
            var transferReady = _native?.RemainderEnabled == true && _editor?.State.Project is { } currentProject && result.Transfers.Count > 0 &&
                _state.Bindings.Where(b => b.ProjectId == currentProject.Value && b.Status != "Suspended").All(b => b.Status is "Ready" or "WaitingForCrossBindingAdapter");
            if (restart && _native != null && _native.Destinations.Length > 0 && _editor?.State.Status == "Project" && (!result.EditorBlocked || transferReady))
            { _importStage=null; _nativeCancellation = new(); _execution = ExecuteNative(_nativeCancellation.Token); }
        }
        catch (OperationCanceledException) when (_planningCancellation!.IsCancellationRequested) { }
        finally { _planningCancellation!.Dispose(); _planningCancellation = null; }
        if (restart && _engine != null && _execution == null) SchedulePlanning();
    }
    private async Task ExecuteNative(CancellationToken cancellation)
    {
        if (!await _native!.EnsureRoots(_state, () => _store.Save(_state), cancellation) || cancellation.IsCancellationRequested) return;
        var project = _editor!.State.Project;
        if (project == null) return;
        if (_native.RemainderEnabled && _last?.Transfers.Count > 0)
        {
            var moves = _last.Transfers.Where(move => _state.Bindings.Single(b => b.Id == move.PreviousBindingId).ProjectId == project.Value).ToArray();
            foreach (var move in moves)
            {
                var destination = _state.Bindings.Single(b => b.Id == move.DestinationBindingId);
                if (await FolderResolver.EnsureAsync(_state, destination, move.RelativePath, project.Location, _native,
                    () => _store.Save(_state), cancellation) == null) return;
            }
            var completed = _state.TransferAttempts.Count(a => a.Status == "Completed");
            var transfer = new TransferExecutor(_native, project.Location, MediaFormats.IsCandidate, project.Value);
            await transfer.RunAsync(_state, moves, () => _store.Save(_state), cancellation);
            // Finish relocation first. A single event reconciles the retained
            // inventories before admitting a new occupant of the old path.
            if (_state.TransferAttempts.Count(a => a.Status == "Completed") > completed) _engine?.SessionChanged("TransferCompleted");
            return;
        }
        if (_native.RemainderEnabled)
        {
            var catalog = await _native.ReadCatalog();
            if (catalog == null || cancellation.IsCancellationRequested || _editor.State.Project != project) return;
            BinCatalogReconciler.Observe(_state, project.Value, catalog.ToHashSet(StringComparer.Ordinal), DateTimeOffset.UtcNow);
            _store.Save(_state);
            var presence = new PresenceTracker(_native, project.Location, project.Value);
            await presence.RunAsync(_state, () => _store.Save(_state), cancellation);
            var restore = new RestoreExecutor(_native, project.Location,
                (binding, pending) => binding.ProjectId != _editor.State.Project?.Value ? "WaitingForProject" :
                    MediaFormats.IsCandidate(pending.RelativePath) ? null : "WaitingForImportFormat", project.Value);
            await restore.RunAsync(_state, () => _store.Save(_state), cancellation);
            if (RestoreExecutor.HasUnresolved(_state,project.Value)) return;
            var delete = new DeleteExecutor(_native, project.Location, projectId:project.Value);
            await delete.RunAsync(_state, () => _store.Save(_state), cancellation);
            if (DeleteExecutor.HasUnresolved(_state,project.Value)) return;
        }
        var update = new UpdateExecutor(_native, project.Location, _native,
            (binding, pending) => binding.ProjectId != _editor.State.Project?.Value ? "WaitingForProject" :
                (_native.RemainderEnabled ? MediaFormats.IsCandidate(pending.RelativePath) : new[] { ".png", ".jpg", ".jpeg" }.Contains(Path.GetExtension(pending.RelativePath), StringComparer.OrdinalIgnoreCase)) ? null : "WaitingForMoveFormat",
            _native.RemainderEnabled ? MediaFormats.IsCandidate : null, observeContentOnly: _native.RemainderEnabled, projectId:project.Value);
        await update.RunAsync(_state, () => _store.Save(_state), cancellation);
        if (UpdateExecutor.HasUnresolved(_state,project.Value)) return;
        var add = new AddExecutor(_native, project.Location, (binding, pending) => binding.ProjectId != _editor.State.Project?.Value ? "WaitingForProject" :
            (_native.RemainderEnabled ? MediaFormats.IsCandidate(pending.RelativePath) : new[] { ".png", ".jpg", ".jpeg", ".gif", ".wav", ".mp3", ".mp4", ".mov" }.Contains(Path.GetExtension(pending.RelativePath), StringComparer.OrdinalIgnoreCase)) ? null : "WaitingForImportFormat", project.Value);
        await add.RunAsync(_state, () => {
            _store.Save(_state);
            Emit("event",null,new {name="stateChanged",state=Snapshot()});
        }, cancellation);
    }
    private async Task CompleteExecution()
    {
        var execution = _execution!; _execution = null;
        await execution; _nativeCancellation?.Dispose(); _nativeCancellation = null; _sources = _state.Sources.Count; _pending = _state.Pending.Count;
        Emit("event", null, new { name = "stateChanged", state = Snapshot() });
        if (_engine != null) SchedulePlanning();
    }
    private async Task Pause()
    {
        if (_execution != null) {
            _nativeCancellation?.Cancel();
            var execution = _execution; _execution = null; await execution;
            _nativeCancellation?.Dispose(); _nativeCancellation = null;
        }
        try
        {
            if (_planning != null)
            {
                _planningCancellation!.Cancel();
                await CompletePlanning(restart: false);
            }
        }
        finally
        {
            _engine?.Dispose(); _engine = null;
            if (_phase != "Stopped") _phase = "Paused";
        }
    }

    private void Remember(Request request, Reply reply)
    {
        _replies.Add(request.Id, (request.Hash, reply)); _replyOrder.Enqueue(request.Id);
        if (_replyOrder.Count > ReplayWindow) _replies.Remove(_replyOrder.Dequeue());
    }
    private static Request Parse(string text)
    {
        using var document = JsonDocument.Parse(text, new JsonDocumentOptions { MaxDepth = 12 });
        var root = document.RootElement;
        CheckObject(root); Fields(root, "protocolVersion", "requestId", "command", "payload");
        if (!root.TryGetProperty("protocolVersion", out var version) || version.ValueKind != JsonValueKind.Number ||
            !version.TryGetInt32(out var number) || number != ProtocolVersion)
            throw new ProtocolException("UnsupportedProtocolVersion");
        var id = String(root, "requestId");
        if (id.Length > 64 || id.Any(ch => !(char.IsAsciiLetterOrDigit(ch) || ch is '-' or '_')))
            throw new ProtocolException("InvalidRequestId");
        var command = String(root, "command");
        if (!root.TryGetProperty("payload", out var payload)) throw new ProtocolException("MissingPayload");
        CheckObject(payload);
        return new(id, command, payload.Clone(), Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(text))));
    }
    private static void CheckObject(JsonElement value)
    {
        if (value.ValueKind != JsonValueKind.Object) throw new ProtocolException("ExpectedObject");
        var names = new HashSet<string>(StringComparer.Ordinal);
        foreach (var property in value.EnumerateObject())
            if (!names.Add(property.Name)) throw new ProtocolException("DuplicateProperty");
    }
    private static void Fields(JsonElement value, params string[] allowed)
    {
        if (value.EnumerateObject().Any(property => !allowed.Contains(property.Name, StringComparer.Ordinal)))
            throw new ProtocolException("UnknownField");
    }
    private static string String(JsonElement value, string name)
    {
        if (!value.TryGetProperty(name, out var property) || property.ValueKind != JsonValueKind.String || string.IsNullOrWhiteSpace(property.GetString()))
            throw new ProtocolException("InvalidField:" + name);
        return property.GetString()!;
    }
    private static long Integer(JsonElement value, string name)
    {
        if (!value.TryGetProperty(name, out var property) || property.ValueKind != JsonValueKind.Number ||
            !property.TryGetInt64(out var number) || number < 0 || number > 9007199254740991)
            throw new ProtocolException("InvalidField:" + name);
        return number;
    }
    private static async Task<Frame> ReadFrame(StreamReader input, CancellationToken cancellation)
    {
        // ReadLineAsync has no maximum allocation. Read a bounded frame instead.
        var result = new StringBuilder(); var character = new char[1];
        while (await input.ReadAsync(character.AsMemory(), cancellation) != 0)
        {
            if (character[0] == '\n') return new(result.ToString().TrimEnd('\r'));
            if (result.Length == MaxFrameChars) return new(null, true);
            result.Append(character[0]);
        }
        return result.Length == 0 ? new(null) : new(result.ToString());
    }
}
