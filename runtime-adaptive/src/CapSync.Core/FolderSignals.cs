using System.Collections.Concurrent;
using System.Threading.Channels;

namespace CapSync.Core;

public sealed class FolderSignals : IDisposable
{
    private readonly Channel<bool> _signal = Channel.CreateBounded<bool>(new BoundedChannelOptions(1)
    { FullMode = BoundedChannelFullMode.DropWrite, SingleReader = true });
    private readonly ConcurrentDictionary<string, byte> _dirty = new(SourcePaths.Comparer);
    private readonly ConcurrentDictionary<string, byte> _faults = new(SourcePaths.Comparer);
    private readonly Dictionary<string, FileSystemWatcher> _watchers = new(SourcePaths.Comparer);
    private int _forceHash;
    public void Refresh(IEnumerable<Binding> bindings)
    {
        foreach (var binding in bindings)
        {
            var root = binding.RootPath;
            if (!Directory.Exists(root) && _watchers.Remove(root, out var missing)) missing.Dispose();
            if (_faults.TryRemove(root, out _) && _watchers.Remove(root, out var faulted)) faulted.Dispose();
            if (_watchers.ContainsKey(root) || !Directory.Exists(root)) continue;
            try
            {
                var watcher = new FileSystemWatcher(root)
                {
                    IncludeSubdirectories = true,
                    NotifyFilter = NotifyFilters.FileName | NotifyFilters.DirectoryName | NotifyFilters.LastWrite | NotifyFilters.Size | NotifyFilters.CreationTime
                };
                void Changed(object? sender, FileSystemEventArgs e) { _dirty[e.FullPath] = 0; _signal.Writer.TryWrite(true); }
                watcher.Created += Changed; watcher.Changed += Changed; watcher.Deleted += Changed;
                watcher.Renamed += (sender, e) => { _dirty[e.OldFullPath] = 0; Changed(sender, e); };
                watcher.Error += (_, _) => { _faults[root] = 0; Interlocked.Exchange(ref _forceHash, 1); _signal.Writer.TryWrite(true); };
                watcher.EnableRaisingEvents = true;
                _watchers.Add(root, watcher);
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException or ArgumentException)
            { Interlocked.Exchange(ref _forceHash, 1); }
        }
    }
    public async Task<(bool ForceHash, string[] DirtyPaths)> WaitAsync(TimeSpan polling, CancellationToken cancellation)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
        deadline.CancelAfter(polling);
        try
        {
            await _signal.Reader.ReadAsync(deadline.Token);
            await Task.Delay(250, cancellation);
        }
        catch (OperationCanceledException) when (!cancellation.IsCancellationRequested) { }
        cancellation.ThrowIfCancellationRequested();
        while (_signal.Reader.TryRead(out _)) { }
        var paths = _dirty.Keys.ToArray();
        foreach (var item in paths) _dirty.TryRemove(item, out _);
        return (Interlocked.Exchange(ref _forceHash, 0) != 0, paths);
    }
    public void Dispose() { foreach (var watcher in _watchers.Values) watcher.Dispose(); }
}
