namespace CapSync.Core;

public sealed record SourceWatchStatus(string RootPath, string Status, string? Reason);

/// <summary>Event-only root and parent watches. No recurring recovery scan.</summary>
public sealed class EventFolderSignals(ChangeInbox inbox) : IDisposable
{
    private sealed class RootWatch(string path)
    {
        public string Path { get; } = path;
        public List<FileSystemWatcher> Watchers { get; } = [];
        public bool Refresh { get; set; }
        public string Status { get; set; } = "Preparing";
        public string? Reason { get; set; }
    }
    private readonly object _gate = new();
    private readonly Dictionary<string, RootWatch> _roots = new(SourcePaths.Comparer);
    private bool _disposed;
    private int _configuring;

    public SourceWatchStatus[] Configure(IEnumerable<string> roots, bool recover = false, bool announce = true)
    {
        var desired = roots.Select(SourcePaths.NormalizeRoot).Distinct(SourcePaths.Comparer).ToArray();
        if (Interlocked.Exchange(ref _configuring, 1) != 0)
            throw new InvalidOperationException("Watch configuration has one owner.");
        var retired = new List<RootWatch>(); var starting = new List<RootWatch>();
        try
        {
            lock (_gate)
            {
                ObjectDisposedException.ThrowIf(_disposed, this);
                foreach (var old in _roots.Values.ToArray())
                    if (!desired.Contains(old.Path, SourcePaths.Comparer) || old.Refresh || recover)
                    { _roots.Remove(old.Path); retired.Add(old); }
                foreach (var root in desired)
                    if (!_roots.ContainsKey(root))
                    { var watch = new RootWatch(root); _roots.Add(root, watch); starting.Add(watch); }
            }
            // Never dispose under the callback lock: an in-flight handler may be waiting for it.
            foreach (var old in retired) DisposeWatchers(old);
            foreach (var watch in starting)
            {
                try { Install(watch); }
                catch (Exception error) when (error is IOException or UnauthorizedAccessException or ArgumentException)
                {
                    // An available parent can still announce root restoration
                    // after a source-open race. Retain only functioning watches.
                    foreach (var failed in watch.Watchers.Where(w => !w.EnableRaisingEvents).ToArray())
                    { watch.Watchers.Remove(failed); failed.Dispose(); }
                    watch.Status = "WatchUnavailable"; watch.Reason = error.Message;
                }
                // One cause-driven recovery pass, even if setup failed. A failed
                // setup is not retried again until a new recovery signal/request.
                if (announce) Post(watch, () => inbox.Rescan(watch.Path, "WatchConfigured"));
            }
            lock (_gate) return _roots.Values.Select(w => new SourceWatchStatus(w.Path, w.Status, w.Reason)).ToArray();
        }
        finally { Volatile.Write(ref _configuring, 0); }
    }

    private void Install(RootWatch watch)
    {
        var root = watch.Path;
        var ancestor = Directory.GetParent(root)?.FullName;
        while (ancestor != null && !Directory.Exists(ancestor)) ancestor = Directory.GetParent(ancestor)?.FullName;
        if (ancestor == null) throw new IOException("No available parent for source root; wait for a device/recovery event.");
        EnsureOrdinaryAncestors(ancestor);
        var next = Path.GetFullPath(Path.Combine(ancestor, Path.GetRelativePath(ancestor, root)
            .Split(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)[0]));
        var parent = new FileSystemWatcher(ancestor)
        {
            IncludeSubdirectories = false,
            NotifyFilter = NotifyFilters.DirectoryName | NotifyFilters.FileName
        };
        void ParentChanged(object? sender, FileSystemEventArgs change)
        {
            if (SourcePaths.Comparer.Equals(change.FullPath, next) ||
                change is RenamedEventArgs renamed && SourcePaths.Comparer.Equals(renamed.OldFullPath, next))
                Post(watch, () => { watch.Refresh = true; inbox.Rescan(root, "RootTopologyChanged"); });
        }
        parent.Created += ParentChanged; parent.Deleted += ParentChanged; parent.Renamed += ParentChanged;
        parent.Error += (_, _) => Fault(watch);
        watch.Watchers.Add(parent); parent.EnableRaisingEvents = true;
        if (!Directory.Exists(root)) { watch.Status = "RootUnavailable"; return; }
        EnsureOrdinaryAncestors(root);
        var source = new FileSystemWatcher(root)
        {
            IncludeSubdirectories = true,
            NotifyFilter = NotifyFilters.FileName | NotifyFilters.DirectoryName | NotifyFilters.LastWrite |
                NotifyFilters.Size | NotifyFilters.CreationTime
        };
        void Changed(object? sender, FileSystemEventArgs change) => Post(watch, () => {
            if (SourcePaths.Within(root, change.FullPath)) inbox.FileChanged(root, change.FullPath,
                structural: change.ChangeType != WatcherChangeTypes.Changed);
            else { watch.Refresh = true; inbox.Rescan(root, "EventPathChanged", true); }
        });
        source.Created += Changed; source.Changed += Changed; source.Deleted += Changed;
        source.Renamed += (sender, change) => {
            Post(watch, () => {
                if (SourcePaths.Within(root, change.OldFullPath)) inbox.FileChanged(root, change.OldFullPath);
                else { watch.Refresh = true; inbox.Rescan(root, "EventPathChanged", true); }
            });
            Changed(sender, change);
        };
        source.Error += (_, _) => Fault(watch);
        watch.Watchers.Add(source);
        try { source.EnableRaisingEvents = true; }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException) {
            // Retain the successfully installed parent subscription when the
            // source disappears between existence checking and opening its watch.
            watch.Watchers.Remove(source); source.Dispose();
            watch.Status = "RootUnavailable"; watch.Reason = error.Message; return;
        }
        watch.Status = "Watching";
    }

    private void Fault(RootWatch watch) => Post(watch, () => {
        watch.Refresh = true; watch.Status = "WatchFault";
        inbox.Rescan(watch.Path, "WatcherFault", true);
    });

    private void Post(RootWatch watch, Action action)
    {
        lock (_gate)
        {
            if (_disposed || !_roots.TryGetValue(watch.Path, out var current) || !ReferenceEquals(current, watch)) return;
            // Filesystem callback paths must never throw into the watcher or
            // resurrect a subscription retired by a configuration change.
            try { action(); }
            catch (ObjectDisposedException) { }
            catch (Exception error) when (error is ArgumentException or IOException)
            { watch.Refresh = true; watch.Status = "WatchFault"; watch.Reason = error.Message; }
        }
    }

    private static void EnsureOrdinaryAncestors(string path)
    {
        for (string? current = path; current != null; current = Directory.GetParent(current)?.FullName)
            if ((File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0)
                throw new IOException("A watched source or its parent is a reparse point.");
    }
    private static void DisposeWatchers(RootWatch watch)
    {
        foreach (var watcher in watch.Watchers) watcher.Dispose();
        watch.Watchers.Clear();
    }
    public void Dispose()
    {
        RootWatch[] retired;
        lock (_gate)
        {
            if (_disposed) return;
            _disposed = true; retired = _roots.Values.ToArray(); _roots.Clear();
        }
        foreach (var watch in retired) DisposeWatchers(watch);
    }
}
