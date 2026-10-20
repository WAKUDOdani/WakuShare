using System.Security.Cryptography;

namespace CapSync.Core;

public sealed record ScanWorkMetrics(int Scopes, int MetadataEntries, int HashedFiles, long HashedBytes);
public sealed record SliceScanResult(bool RootAvailable, InventorySlice[] Slices, ScanWorkMetrics Work);

/// <summary>Reads only signaled files/subtrees; produces explicitly scoped deltas.</summary>
public sealed class IncrementalInventoryScanner
{
    public TimeSpan Stabilization { get; init; } = TimeSpan.FromMilliseconds(350);
    private sealed record Scope(string Relative, bool Recursive);
    private sealed record Stamp(string Relative, string FullPath, long Size, long Ticks, string? Identity);
    private sealed class Capture
    {
        public Dictionary<string, Stamp> Files { get; } = new(SourcePaths.Comparer);
        public List<string> Warnings { get; } = [];
        public bool Complete { get; set; } = true;
    }

    public async Task<SliceScanResult> ScanAsync(Binding binding, Inventory cached,
        IReadOnlyList<string> dirtyPaths, CancellationToken cancellation = default,
        IReadOnlyList<string>? contentOnlyPaths = null)
    {
        var root = Path.GetFullPath(binding.RootPath);
        var metadataEntries = 0; var hashedFiles = 0; long hashedBytes = 0;
        ScanWorkMetrics Work(int count) => new(count, metadataEntries, hashedFiles, hashedBytes);
        if (!Directory.Exists(root)) return new(false, [], Work(0));
        var scopes = new List<Scope>();
        var contentOnly = (contentOnlyPaths ?? []).Select(Path.GetFullPath).ToHashSet(SourcePaths.Comparer);
        foreach (var path in dirtyPaths.Select(Path.GetFullPath).Distinct(SourcePaths.Comparer))
        {
            cancellation.ThrowIfCancellationRequested();
            if (!SourcePaths.Within(root, path)) throw new InvalidDataException("Dirty path escaped its source root.");
            // Directory mtime changes accompany child notifications. They do
            // not imply a new subtree; Created/Deleted/Renamed still expand it.
            if (contentOnly.Contains(path) && Directory.Exists(path)) continue;
            var relative = Path.GetRelativePath(root, path);
            relative = relative == "." ? "" : SourcePaths.Relative(relative);
            var recursive = relative == "" || Directory.Exists(path) || cached.Files.Any(file =>
                file.RelativePath.StartsWith(relative + "/", StringComparison.OrdinalIgnoreCase));
            scopes.Add(new(relative, recursive));
        }
        scopes = scopes.Where(scope => !scopes.Any(other => !ReferenceEquals(scope, other) && other.Recursive &&
            (other.Relative == "" || scope.Relative.StartsWith(other.Relative + "/", StringComparison.OrdinalIgnoreCase))))
            .OrderBy(scope => scope.Relative, SourcePaths.Comparer).ToList();
        if (scopes.Count == 0) return new(true, [], Work(0));
        var first = scopes.Select(CaptureScope).ToArray();
        if (Stabilization > TimeSpan.Zero) await Task.Delay(Stabilization, cancellation);
        if (!Directory.Exists(root)) return new(false, [], Work(scopes.Count));
        var after = scopes.Select(CaptureScope).ToArray();
        var slices = new List<InventorySlice>();
        for (var i = 0; i < scopes.Count; ++i)
        {
            var scope = scopes[i]; var current = after[i]; var observed = new List<FileSnapshot>();
            foreach (var (relative, stamp) in current.Files)
            {
                cancellation.ThrowIfCancellationRequested();
                if (!first[i].Files.TryGetValue(relative, out var before) || stamp != before)
                { observed.Add(new(relative, stamp.Size, stamp.Ticks, stamp.Identity, null, false)); continue; }
                try
                {
                    EnsureOrdinaryPath(stamp.FullPath);
                    await using var input = new FileStream(stamp.FullPath, FileMode.Open, FileAccess.Read,
                        FileShare.Read | FileShare.Delete, 64 * 1024, FileOptions.Asynchronous | FileOptions.SequentialScan);
                    var hash = Convert.ToHexString(await SHA256.HashDataAsync(input, cancellation));
                    ++hashedFiles; hashedBytes += input.Position;
                    if (ReadStamp(stamp.FullPath) != stamp)
                        observed.Add(new(relative, stamp.Size, stamp.Ticks, stamp.Identity, null, false));
                    else observed.Add(new(relative, stamp.Size, stamp.Ticks, stamp.Identity, hash));
                }
                catch (Exception error) when (error is IOException or UnauthorizedAccessException)
                {
                    current.Warnings.Add($"Not ready: {relative}: {error.Message}");
                    observed.Add(new(relative, stamp.Size, stamp.Ticks, stamp.Identity, null, false));
                }
            }
            slices.Add(new(scope.Relative, scope.Recursive, first[i].Complete && current.Complete,
                observed, first[i].Warnings.Concat(current.Warnings).Distinct().Take(256).ToArray()));
        }
        return new(Directory.Exists(root), slices.ToArray(), Work(scopes.Count));

        Stamp ReadStamp(string path)
        {
            ++metadataEntries;
            var info = new FileInfo(path);
            return new(SourcePaths.Relative(Path.GetRelativePath(root, path)), Path.GetFullPath(path),
                info.Length, info.LastWriteTimeUtc.Ticks, FileIdentity.Read(path));
        }
        void EnsureOrdinaryPath(string path)
        {
            var ancestors = new Stack<string>();
            for (string? current = path; current != null && SourcePaths.Within(root, current);
                current = Directory.GetParent(current)?.FullName)
                ancestors.Push(current);
            // Check parents before a possibly missing leaf, so a missing name
            // below a newly introduced junction is not accepted as a deletion.
            foreach (var current in ancestors)
                if ((File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0)
                    throw new IOException("Linked source paths are not traversed.");
        }
        Capture CaptureScope(Scope scope)
        {
            var result = new Capture(); var initial = Path.GetFullPath(Path.Combine(root, scope.Relative));
            var pending = new Stack<string>(); pending.Push(initial);
            while (pending.TryPop(out var path))
            {
                cancellation.ThrowIfCancellationRequested();
                try
                {
                    EnsureOrdinaryPath(path);
                    var attributes = File.GetAttributes(path);
                    if ((attributes & FileAttributes.Directory) != 0)
                    {
                        if (!scope.Recursive) { result.Complete = false; result.Warnings.Add("File became a directory during capture."); continue; }
                        foreach (var child in Directory.EnumerateFileSystemEntries(path)) pending.Push(child);
                    }
                    else if (InventoryScanner.IsCandidate(path)) result.Files.Add(SourcePaths.Relative(Path.GetRelativePath(root, path)), ReadStamp(path));
                }
                catch (Exception error) when (error is FileNotFoundException or DirectoryNotFoundException)
                {
                    // Only an absent explicitly signaled path is an authoritative
                    // deletion. A child disappearing during traversal is a race.
                    if (!SourcePaths.Comparer.Equals(path, initial))
                    { result.Complete = false; result.Warnings.Add($"Entry disappeared during enumeration: {path}"); }
                }
                catch (Exception error) when (error is IOException or UnauthorizedAccessException)
                { result.Complete = false; result.Warnings.Add($"Incomplete scope: {path}: {error.Message}"); }
            }
            return result;
        }
    }
}
