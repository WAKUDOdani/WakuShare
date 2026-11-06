using System.Threading.Channels;

namespace CapSync.Core;

public sealed record RootChangeBatch(string RootPath, string[] DirtyPaths, bool RequiresScan,
    bool RequiresContentAudit, string[] Reasons, string[]? ContentOnlyPaths = null, string[]? ReadinessRetryPaths = null);
public sealed record SyncChangeBatch(long Sequence, RootChangeBatch[] Roots, string[] SessionReasons);

/// <summary>
/// Event inbox for the persistent worker. Paths and wake tokens are drained
/// under the same lock, so a concurrent notification cannot lose its wakeup.
/// No task/timer is scheduled while the inbox is empty.
/// </summary>
public sealed class ChangeInbox : IDisposable
{
    private sealed class RootPending(string path)
    {
        public string Path { get; } = path;
        public Dictionary<string, bool> Paths { get; } = new(SourcePaths.Comparer);
        public HashSet<string> RetryOnlyPaths { get; } = new(SourcePaths.Comparer);
        public HashSet<string> Reasons { get; } = new(StringComparer.Ordinal);
        public bool Scan { get; set; }
        public bool Audit { get; set; }
    }
    private readonly object _gate = new();
    private readonly Dictionary<string, RootPending> _roots = new(SourcePaths.Comparer);
    private readonly HashSet<string> _session = new(StringComparer.Ordinal);
    private readonly Channel<bool> _wake = Channel.CreateBounded<bool>(new BoundedChannelOptions(1)
    { FullMode = BoundedChannelFullMode.DropWrite, SingleReader = true });
    private readonly int _pathLimit;
    private readonly TimeSpan _coalesce;
    private long _sequence;
    private int _reading;
    private bool _disposed;

    public ChangeInbox(int pathLimit = 8192, TimeSpan? coalesce = null)
    {
        if (pathLimit < 1) throw new ArgumentOutOfRangeException(nameof(pathLimit));
        _pathLimit = pathLimit;
        _coalesce = coalesce ?? TimeSpan.FromMilliseconds(250);
        if (_coalesce < TimeSpan.Zero || _coalesce > TimeSpan.FromSeconds(2))
            throw new ArgumentOutOfRangeException(nameof(coalesce));
    }

    public void FileChanged(string root, string path, bool structural = true, bool readinessRetry = false)
    {
        root = SourcePaths.NormalizeRoot(root); path = Path.GetFullPath(path);
        if (!SourcePaths.Within(root, path)) throw new InvalidDataException("Event path escaped its observed root.");
        lock (_gate)
        {
            ThrowIfDisposed();
            var pending = Root(root);
            if (!pending.Scan)
            {
                var existed = pending.Paths.TryGetValue(path, out var previousStructural);
                if (!readinessRetry) pending.RetryOnlyPaths.Remove(path);
                else if (!existed) pending.RetryOnlyPaths.Add(path);
                pending.Paths.Remove(path);
                pending.Paths.Add(path, previousStructural || structural);
                if (pending.Paths.Count > _pathLimit)
                {
                    pending.Paths.Clear(); pending.RetryOnlyPaths.Clear(); pending.Scan = true; pending.Audit = true;
                    pending.Reasons.Add("EventQueueOverflow");
                }
            }
            _wake.Writer.TryWrite(true);
        }
    }

    public void Rescan(string root, string reason, bool contentAudit = false)
    {
        root = SourcePaths.NormalizeRoot(root); ValidateReason(reason);
        lock (_gate)
        {
            ThrowIfDisposed();
            var pending = Root(root);
            pending.Scan = true; pending.Audit |= contentAudit;
            pending.Paths.Clear(); pending.RetryOnlyPaths.Clear(); pending.Reasons.Add(reason);
            _wake.Writer.TryWrite(true);
        }
    }

    public void SessionChanged(string reason)
    {
        ValidateReason(reason);
        lock (_gate)
        {
            ThrowIfDisposed();
            if (_session.Count >= 32 && !_session.Contains(reason))
                throw new InvalidOperationException("Session signal reasons must be a bounded vocabulary.");
            _session.Add(reason); _wake.Writer.TryWrite(true);
        }
    }

    public async Task<SyncChangeBatch> ReadAsync(CancellationToken cancellation = default)
    {
        if (Interlocked.Exchange(ref _reading, 1) != 0)
            throw new InvalidOperationException("Only one consumer may read the event inbox.");
        try
        {
            await _wake.Reader.ReadAsync(cancellation);
            // This one-shot delay exists only after a real notification.
            if (_coalesce > TimeSpan.Zero) await Task.Delay(_coalesce, cancellation);
            lock (_gate)
            {
                ThrowIfDisposed();
                // Cancellation after taking the wake token must not consume the batch.
                if (cancellation.IsCancellationRequested)
                {
                    _wake.Writer.TryWrite(true);
                    cancellation.ThrowIfCancellationRequested();
                }
                var roots = _roots.Values.Select(p => new RootChangeBatch(p.Path,
                    p.Paths.Keys.Order(SourcePaths.Comparer).ToArray(), p.Scan, p.Audit,
                    p.Reasons.Order(StringComparer.Ordinal).ToArray(),
                    p.Paths.Where(pair => !pair.Value).Select(pair => pair.Key).ToArray(),
                    p.RetryOnlyPaths.ToArray())).OrderBy(p => p.RootPath, SourcePaths.Comparer).ToArray();
                var session = _session.Order(StringComparer.Ordinal).ToArray();
                _roots.Clear(); _session.Clear();
                while (_wake.Reader.TryRead(out _)) { }
                return new(++_sequence, roots, session);
            }
        }
        catch (OperationCanceledException)
        {
            lock (_gate)
                if (!_disposed && (_roots.Count > 0 || _session.Count > 0)) _wake.Writer.TryWrite(true);
            throw;
        }
        finally { Volatile.Write(ref _reading, 0); }
    }

    private RootPending Root(string path)
    {
        if (!_roots.TryGetValue(path, out var pending)) _roots.Add(path, pending = new(path));
        return pending;
    }
    private static void ValidateReason(string reason)
    {
        if (string.IsNullOrWhiteSpace(reason) || reason.Length > 128)
            throw new ArgumentException("A bounded reason code is required.", nameof(reason));
    }
    private void ThrowIfDisposed() => ObjectDisposedException.ThrowIf(_disposed, this);
    public void Dispose()
    {
        lock (_gate)
        {
            if (_disposed) return;
            _disposed = true; _roots.Clear(); _session.Clear();
            _wake.Writer.TryComplete();
        }
    }
}
