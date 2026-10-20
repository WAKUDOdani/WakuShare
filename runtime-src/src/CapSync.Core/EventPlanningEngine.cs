namespace CapSync.Core;

public sealed record PlanningWork(long FullScans, long PartialScans, long MetadataEntries, long HashedFiles, long HashedBytes);
public sealed record RootInventoryStatus(string RootPath, bool Available, bool Complete, int Files, int WaitingFiles, string[] Warnings);
public sealed record EventPlanningResult(long Sequence, SourceWatchStatus[] Watches, PlanningWork Work,
    IReadOnlyList<CrossBindingMove> Transfers, bool EditorBlocked, string[] SessionReasons, string[] BlockedProjects,
    ReadinessRetryStatus? Readiness = null, RootInventoryStatus[]? InventoryRoots = null);

/// <summary>
/// Event-driven planning only. This component cannot send commands to CapCut.
/// Every reconciler receives all bound inventories, including unchanged roots.
/// </summary>
public sealed class EventPlanningEngine : IDisposable
{
    private readonly SyncState _state;
    private readonly ChangeInbox _inbox;
    private readonly EventFolderSignals _signals;
    private readonly InventoryScanner _full;
    private readonly IncrementalInventoryScanner _partial;
    private readonly ReadinessRetries _readiness;
    private readonly Dictionary<string, InventoryIndex> _indices = new(SourcePaths.Comparer);
    private long _fullScans, _partialScans, _metadataEntries, _hashedFiles, _hashedBytes;
    private int _processing;
    private bool _disposed;
    private sealed record RootFacts(Inventory Inventory, Dictionary<string, FileSnapshot> ByPath, HashSet<string> Identities);
    private static RootFacts Facts(Inventory inventory) => new(inventory,
        inventory.Files.ToDictionary(file => file.RelativePath, SourcePaths.Comparer),
        inventory.Files.Where(file => file.FileIdentity != null).Select(file => file.FileIdentity!).ToHashSet(StringComparer.Ordinal));

    public EventPlanningEngine(SyncState state, TimeSpan? stabilization = null, TimeSpan? coalesce = null,
        TimeSpan[]? readinessDelays = null)
    {
        _state = state; _inbox = new(coalesce: coalesce); _signals = new(_inbox);
        var pause = stabilization ?? TimeSpan.FromMilliseconds(350);
        _full = new() { Stabilization = pause }; _partial = new() { Stabilization = pause };
        _readiness = new(readinessDelays);
    }
    public PlanningWork Work => new(_fullScans, _partialScans, _metadataEntries, _hashedFiles, _hashedBytes);
    private IEnumerable<Binding> ActiveBindings() => _state.Bindings.Where(binding => binding.Status != "Suspended");
    private string[] ObservedRoots() => ActiveBindings().Select(binding => binding.RootPath)
        .Concat(_state.WatchConfiguration?.Roots ?? []).Select(SourcePaths.NormalizeRoot).Distinct(SourcePaths.Comparer).ToArray();
    public SourceWatchStatus[] Configure(bool recover = false)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        return _signals.Configure(ObservedRoots(), recover);
    }
    public void SessionChanged(string reason) => _inbox.SessionChanged(reason);
    public void Rescan(string root, string reason, bool audit = false)
    {
        root = SourcePaths.NormalizeRoot(root);
        if (!ObservedRoots().Contains(root, SourcePaths.Comparer))
            throw new InvalidDataException("Only configured roots can be rescanned.");
        _inbox.Rescan(root, reason, audit);
    }
    public Inventory Inventory(string root) => _indices.TryGetValue(SourcePaths.NormalizeRoot(root), out var index)
        ? index.Snapshot() : new(false, false, [], ["No baseline."]);

    public async Task<EventPlanningResult> NextAsync(CancellationToken cancellation = default)
    {
        if (Interlocked.Exchange(ref _processing, 1) != 0) throw new InvalidOperationException("One planning consumer is required.");
        SyncChangeBatch? batch = null;
        try
        {
            batch = await ReadNext(cancellation);
            var recoverWatchers = batch.SessionReasons.Any(reason => reason is "Resume" or "DeviceChanged");
            var watches = _signals.Configure(ObservedRoots(), recover: recoverWatchers, announce: false);
            var bindings = ActiveBindings().GroupBy(b => SourcePaths.NormalizeRoot(b.RootPath), SourcePaths.Comparer)
                .ToDictionary(g => g.Key, g => g.ToArray(), SourcePaths.Comparer);
            var scanned = new HashSet<string>(SourcePaths.Comparer);
            var scanBindings = ObservedRoots().ToDictionary(root => root,
                root => bindings.TryGetValue(root, out var group) ? group[0] : new Binding { Id = Guid.Empty, RootPath = root }, SourcePaths.Comparer);
            // A resume/device event closes an observation gap once. There is no
            // scheduled catch-up scan while the process is otherwise idle.
            if (recoverWatchers)
                foreach (var (root, binding) in scanBindings)
                {
                    if (!_indices.ContainsKey(root)) _indices.Add(root, new());
                    var audit = batch.Roots.Any(change => SourcePaths.Comparer.Equals(change.RootPath, root) && change.RequiresContentAudit);
                    await FullScan(root, binding, audit, cancellation); scanned.Add(root);
                }
            foreach (var change in batch.Roots)
            {
                if (!scanBindings.TryGetValue(change.RootPath, out var binding)) continue;
                if (recoverWatchers) continue;
                if (!_indices.TryGetValue(change.RootPath, out var index)) _indices.Add(change.RootPath, index = new());
                var before = index.Snapshot();
                if (change.RequiresScan || !before.RootAvailable || !before.Complete)
                {
                    await FullScan(change.RootPath, binding, change.RequiresContentAudit, cancellation);
                    scanned.Add(change.RootPath);
                }
                else
                {
                    var result = await _partial.ScanAsync(binding, before, change.DirtyPaths, cancellation, change.ContentOnlyPaths);
                    index.Apply(result.Slices, result.RootAvailable); ++_partialScans; AddWork(result.Work);
                }
            }
            foreach (var (root, binding) in scanBindings)
                if (!_indices.ContainsKey(root))
                { _indices.Add(root, new()); await FullScan(root, binding, false, cancellation); scanned.Add(root); }
            var facts = scanBindings.Keys.ToDictionary(root => root, root => Facts(_indices[root].Snapshot()), SourcePaths.Comparer);
            var bindingById = _state.Bindings.ToDictionary(binding => binding.Id);

            // Filesystem rename endpoints can arrive in different packets.
            // Before accepting disappearance/replacement of a known identity,
            // resolve that identity against fresh metadata of every project root.
            var projectRecovery = _state.Sources.Where(source => bindingById[source.BindingId].Status != "Suspended" && source.Presence == Presence.Present && source.FileIdentity != null)
                .Where(source => {
                    var binding = bindingById[source.BindingId];
                    var observed = facts[SourcePaths.NormalizeRoot(binding.RootPath)];
                    observed.ByPath.TryGetValue(source.RelativePath, out var currentPath);
                    if (currentPath is { Ready: false }) return false;
                    return observed.Inventory.RootAvailable && observed.Inventory.Complete &&
                        !observed.Identities.Contains(source.FileIdentity!);
                }).Select(source => bindingById[source.BindingId].ProjectId)
                .Distinct(StringComparer.Ordinal).ToHashSet(StringComparer.Ordinal);
            foreach (var (root, group) in bindings)
                if (group.Any(b => projectRecovery.Contains(b.ProjectId)) && scanned.Add(root))
                {
                    await FullScan(root, group[0], false, cancellation);
                    facts[root] = Facts(_indices[root].Snapshot());
                }

            var inventories = ActiveBindings().ToDictionary(b => b.Id, b => facts[SourcePaths.NormalizeRoot(b.RootPath)].Inventory);
            var identityConflicts = _state.Sources.Where(source => bindingById[source.BindingId].Status != "Suspended" && source.Presence == Presence.Missing &&
                source.MaterialId != null && !source.MaterialRemoved).Where(source => {
                    var root = SourcePaths.NormalizeRoot(bindingById[source.BindingId].RootPath);
                    facts[root].ByPath.TryGetValue(source.RelativePath, out var observed);
                    return observed is { Ready: true } && (source.FileIdentity == null || observed.FileIdentity != source.FileIdentity);
                }).Select(source => bindingById[source.BindingId].ProjectId)
                .ToHashSet(StringComparer.Ordinal);
            var transfers = ProjectReconciler.Apply(_state, inventories, DateTimeOffset.UtcNow, identityConflicts);
            _readiness.RetainRoots(scanBindings.Keys);
            foreach (var root in scanBindings.Keys)
            {
                var changed = batch.Roots.SingleOrDefault(change => SourcePaths.Comparer.Equals(change.RootPath, root));
                var retries = (changed?.ReadinessRetryPaths ?? []).ToHashSet(SourcePaths.Comparer);
                _readiness.Observe(root, facts[root].Inventory,
                    (changed?.DirtyPaths ?? []).Where(path => !retries.Contains(path)).ToArray(),
                    recoverWatchers || changed?.RequiresScan == true);
            }
            var blocked = ActiveBindings().GroupBy(binding => binding.ProjectId, StringComparer.Ordinal)
                .Where(project => project.Any(binding => binding.Status != "Ready" ||
                    !inventories[binding.Id].RootAvailable || !inventories[binding.Id].Complete ||
                    !watches.Any(w => SourcePaths.Comparer.Equals(w.RootPath, SourcePaths.NormalizeRoot(binding.RootPath)) && w.Status == "Watching")))
                .Select(project => project.Key).Order(StringComparer.Ordinal).ToArray();
            foreach (var (root, observed) in facts)
            {
                if (!observed.Inventory.RootAvailable) continue;
                var files = observed.Inventory.Files.Where(file => file.Ready && file.Hash != null && file.FileIdentity != null).ToArray();
                var old = _state.RootInventories.FindIndex(cache => SourcePaths.Comparer.Equals(SourcePaths.NormalizeRoot(cache.RootPath), root));
                var cache = new RootInventoryCache(root, files);
                if (old < 0) _state.RootInventories.Add(cache); else _state.RootInventories[old] = cache;
            }
            return new(batch.Sequence, watches, Work, transfers,
                blocked.Length > 0, batch.SessionReasons, blocked, _readiness.Status,
                facts.Select(pair => new RootInventoryStatus(pair.Key, pair.Value.Inventory.RootAvailable, pair.Value.Inventory.Complete,
                    pair.Value.Inventory.Files.Count, pair.Value.Inventory.Files.Count(file => !file.Ready), pair.Value.Inventory.Warnings.Take(64).ToArray())).ToArray());
        }
        catch (OperationCanceledException)
        {
            // Cancellation after dequeue must not acknowledge unfinished I/O.
            // Recovery is queued, not scheduled by a recurring timer.
            if (!_disposed && batch != null)
            {
                foreach (var root in batch.Roots)
                    _inbox.Rescan(root.RootPath, "InterruptedScan", true);
                foreach (var reason in batch.SessionReasons) _inbox.SessionChanged(reason);
            }
            throw;
        }
        finally { Volatile.Write(ref _processing, 0); }
    }

    private async Task<SyncChangeBatch> ReadNext(CancellationToken cancellation)
    {
        var delay = _readiness.NextDelay();
        if (delay == null) return await _inbox.ReadAsync(cancellation);
        using var timerCancellation = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
        var read = _inbox.ReadAsync(cancellation);
        try
        {
            while (!read.IsCompleted && delay != null)
            {
                var timer = Task.Delay(delay.Value, timerCancellation.Token);
                if (await Task.WhenAny(read, timer) != timer) break;
                cancellation.ThrowIfCancellationRequested();
                foreach (var (root, path) in _readiness.TakeDue())
                    _inbox.FileChanged(root, path, structural: false, readinessRetry: true);
                // A Windows timer can wake before the coarse monotonic ledger
                // deadline. Keep waiting for that one pending deadline instead
                // of abandoning it and blocking forever on an empty inbox.
                delay = _readiness.NextDelay();
            }
            return await read;
        }
        finally { timerCancellation.Cancel(); }
    }

    private async Task FullScan(string root, Binding binding, bool audit, CancellationToken cancellation)
    {
        var previous = _indices[root].Snapshot();
        var boundIds = _state.Bindings.Where(b => SourcePaths.Comparer.Equals(SourcePaths.NormalizeRoot(b.RootPath), root))
            .Select(b => b.Id).ToHashSet();
        var durableSources = _state.Sources.Where(source => boundIds.Contains(source.BindingId) && source.Presence == Presence.Present)
            .GroupBy(source => source.RelativePath, SourcePaths.Comparer).ToDictionary(group => group.Key, group => group.ToArray(), SourcePaths.Comparer);
        // Hash caching is root-local and contains no material IDs. Projects
        // sharing a root still retain independent sources and applied paths.
        var cachedFiles = previous.Files.Where(f => f.Ready && f.Hash != null).ToArray();
        if (cachedFiles.Length == 0)
            cachedFiles = (_state.RootInventories.SingleOrDefault(cache => SourcePaths.Comparer.Equals(SourcePaths.NormalizeRoot(cache.RootPath), root))?.Files ?? [])
                .Where(file => !durableSources.TryGetValue(file.RelativePath, out var sources) || sources.All(source =>
                    source.FileIdentity == file.FileIdentity && source.Hash == file.Hash && source.Size == file.Size && source.LastWriteTicks == file.LastWriteTicks)).ToArray();
        if (cachedFiles.Length == 0)
        {
            // Reuse durable observations only when all project observations of
            // that physical path agree. Never pick a convenient project's hash.
            cachedFiles = _state.Sources.Where(s => boundIds.Contains(s.BindingId) && s.Presence == Presence.Present &&
                    s.FileIdentity != null && s.Hash.Length > 0)
                .GroupBy(s => s.RelativePath, SourcePaths.Comparer)
                .Where(group => group.Select(s => (s.FileIdentity, s.Hash, s.Size, s.LastWriteTicks)).Distinct().Count() == 1)
                .Select(group => group.First()).Select(s => new FileSnapshot(s.RelativePath, s.Size, s.LastWriteTicks, s.FileIdentity, s.Hash)).ToArray();
        }
        var cache = cachedFiles.Select(f => new Source {
            BindingId = binding.Id, RelativePath = f.RelativePath, FileIdentity = f.FileIdentity,
            Size = f.Size, LastWriteTicks = f.LastWriteTicks, Hash = f.Hash!, Presence = Presence.Present
        }).ToArray();
        var observed = await _full.ScanAsync(binding, cache, audit, cancellation: cancellation);
        _indices[root].Replace(observed); ++_fullScans; AddWork(_full.LastWork);
    }
    private void AddWork(ScanWorkMetrics work)
    { _metadataEntries += work.MetadataEntries; _hashedFiles += work.HashedFiles; _hashedBytes += work.HashedBytes; }
    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true; _signals.Dispose(); _inbox.Dispose();
    }
}
