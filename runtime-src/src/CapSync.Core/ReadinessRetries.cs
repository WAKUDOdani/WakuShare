namespace CapSync.Core;

public sealed record ReadinessRetryStatus(int WaitingFiles, int ScheduledFiles, int ExhaustedFiles, long TotalAttempts, int DeferredFiles = 0);

// Owned by the planning consumer. No thread or timer lives in this ledger;
// NextAsync waits on at most one nearest deadline alongside its event inbox.
internal sealed class ReadinessRetries
{
    private const int Capacity = 8192;
    private sealed class Waiting(FileSnapshot snapshot)
    {
        public FileSnapshot Snapshot { get; } = snapshot;
        public int Attempts { get; set; }
        public long? Due { get; set; }
        public bool InFlight { get; set; }
    }
    private readonly Dictionary<string, Dictionary<string, Waiting>> _roots = new(SourcePaths.Comparer);
    private readonly Dictionary<string, int> _waitingCounts = new(SourcePaths.Comparer);
    private readonly TimeSpan[] _delays;
    private long _attempts;
    public ReadinessRetries(TimeSpan[]? delays = null)
    {
        _delays = delays?.ToArray() ?? [TimeSpan.FromMilliseconds(500), TimeSpan.FromMilliseconds(1500), TimeSpan.FromSeconds(4)];
        if (_delays.Length > 3 || _delays.Any(delay => delay < TimeSpan.Zero || delay > TimeSpan.FromSeconds(30)))
            throw new ArgumentException("Readiness retries are limited to three bounded delays.");
    }
    public void Observe(string root, Inventory inventory, IReadOnlyList<string> realPaths, bool reset)
    {
        if (!_roots.TryGetValue(root, out var entries)) _roots[root] = entries = new(SourcePaths.Comparer);
        if (!inventory.RootAvailable) { entries.Clear(); _waitingCounts[root] = 0; return; }
        var waiting = inventory.Files.Where(file => !file.Ready).ToDictionary(file => file.RelativePath, SourcePaths.Comparer);
        _waitingCounts[root] = waiting.Count;
        foreach (var path in entries.Keys.Where(path => !waiting.ContainsKey(path)).ToArray()) entries.Remove(path);
        var real = realPaths.Select(Path.GetFullPath).ToHashSet(SourcePaths.Comparer);
        foreach (var (path, snapshot) in waiting)
        {
            var fresh = reset || real.Contains(Path.GetFullPath(Path.Combine(root, path))) ||
                !entries.TryGetValue(path, out var existing) || existing.Snapshot != snapshot;
            if (fresh)
            {
                if (!entries.ContainsKey(path) && entries.Count >= Capacity) continue;
                entries[path] = new(snapshot);
            }
            var item = entries[path];
            if (fresh || item.InFlight)
            {
                item.InFlight = false;
                item.Due = item.Attempts < _delays.Length ? Environment.TickCount64 + (long)_delays[item.Attempts].TotalMilliseconds : null;
            }
        }
    }
    public void RetainRoots(IEnumerable<string> roots)
    {
        var current = roots.ToHashSet(SourcePaths.Comparer);
        foreach (var root in _roots.Keys.Where(root => !current.Contains(root)).ToArray())
        { _roots.Remove(root); _waitingCounts.Remove(root); }
    }
    public TimeSpan? NextDelay()
    {
        var due = _roots.Values.SelectMany(entries => entries.Values).Where(item => item.Due.HasValue)
            .Select(item => item.Due!.Value).DefaultIfEmpty(long.MaxValue).Min();
        return due == long.MaxValue ? null : TimeSpan.FromMilliseconds(Math.Max(0, due - Environment.TickCount64));
    }
    public (string Root, string Path)[] TakeDue()
    {
        var result = new List<(string, string)>(); var now = Environment.TickCount64;
        foreach (var (root, entries) in _roots)
            foreach (var (path, item) in entries)
                if (item.Due is long due && due <= now)
                {
                    item.Due = null; item.InFlight = true; ++item.Attempts; ++_attempts;
                    result.Add((root, Path.GetFullPath(Path.Combine(root, path))));
                }
        return result.ToArray();
    }
    public ReadinessRetryStatus Status => new(_waitingCounts.Values.Sum(),
        _roots.Values.Sum(entries => entries.Values.Count(item => item.Due != null || item.InFlight)),
        _roots.Values.Sum(entries => entries.Values.Count(item => item.Due == null && !item.InFlight && item.Attempts >= _delays.Length)), _attempts,
        _waitingCounts.Values.Sum() - _roots.Values.Sum(entries => entries.Count));
}
