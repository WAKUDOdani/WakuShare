namespace CapSync.Core;

// A slice explicitly describes the area which was enumerated. It is never
// passed to Reconciler as if it were a complete root inventory.
public sealed record InventorySlice(string RelativeScope, bool Recursive, bool Complete,
    IReadOnlyList<FileSnapshot> Files, IReadOnlyList<string> Warnings);

public sealed class InventoryIndex
{
    private readonly Dictionary<string, FileSnapshot> _files = new(SourcePaths.Comparer);
    private readonly Dictionary<string, (string Scope, bool Recursive)> _incomplete = new(SourcePaths.Comparer);
    private bool _initialized;
    private bool _available;
    private string[] _warnings = [];

    public Inventory Replace(Inventory full)
    {
        ValidateFiles(full.Files);
        if (full.RootAvailable && full.Complete)
        {
            _files.Clear();
            foreach (var file in full.Files) Store(file);
            _incomplete.Clear(); _initialized = true;
        }
        else
        {
            // A partial recovery cannot turn unseen entries into deletions.
            if (full.RootAvailable) foreach (var file in full.Files) Store(file);
            _incomplete["root"] = ("", true);
        }
        _available = full.RootAvailable; _warnings = full.Warnings.Distinct().Take(256).ToArray();
        return Snapshot();
    }

    public Inventory Apply(IReadOnlyList<InventorySlice> slices, bool rootAvailable = true)
    {
        if (!_initialized) throw new InvalidOperationException("A complete baseline is required before applying deltas.");
        // Validate the whole packet before changing a single cached source.
        var normalized = slices.Select(slice => slice with { RelativeScope = NormalizeScope(slice.RelativeScope, slice.Recursive) }).ToArray();
        foreach (var slice in normalized)
        {
            var scope = NormalizeScope(slice.RelativeScope, slice.Recursive);
            ValidateFiles(slice.Files);
            if (slice.Files.Any(file => !Contains(scope, slice.Recursive, SourcePaths.Relative(file.RelativePath))))
                throw new InvalidDataException("Observed file escaped the enumerated slice.");
        }
        for (var i = 0; i < normalized.Length; ++i)
            for (var j = i + 1; j < normalized.Length; ++j)
                if (Contains(normalized[i].RelativeScope, normalized[i].Recursive, normalized[j].RelativeScope) ||
                    Contains(normalized[j].RelativeScope, normalized[j].Recursive, normalized[i].RelativeScope))
                    throw new InvalidDataException("Overlapping slices must be coalesced before applying.");
        _available = rootAvailable;
        if (!rootAvailable) {
            _incomplete["root"] = ("", true);
            _warnings = ["Root unavailable; cached entries retained."]; return Snapshot();
        }
        foreach (var slice in normalized)
        {
            var scope = NormalizeScope(slice.RelativeScope, slice.Recursive);
            if (slice.Complete)
            {
                foreach (var path in _files.Keys.Where(path => Contains(scope, slice.Recursive, path)).ToArray()) _files.Remove(path);
                foreach (var pair in _incomplete.ToArray())
                    if (Contains(scope, slice.Recursive, pair.Value.Scope) &&
                        (slice.Recursive || !pair.Value.Recursive)) _incomplete.Remove(pair.Key);
            }
            else _incomplete[(slice.Recursive ? "tree:" : "file:") + scope] = (scope, slice.Recursive);
            foreach (var file in slice.Files) Store(file);
        }
        _warnings = slices.SelectMany(slice => slice.Warnings).Distinct().Take(256).ToArray();
        return Snapshot();
    }

    public Inventory Snapshot() => new(_available, _initialized && _incomplete.Count == 0,
        _files.Values.OrderBy(file => file.RelativePath, SourcePaths.Comparer).ToArray(), _warnings.ToArray());

    private void Store(FileSnapshot file)
    {
        var path = SourcePaths.Relative(file.RelativePath);
        _files[path] = file with { RelativePath = path };
    }

    private static string NormalizeScope(string value, bool recursive)
    {
        if (value == "" && recursive) return "";
        return SourcePaths.Relative(value);
    }
    private static bool Contains(string scope, bool recursive, string path) =>
        scope == "" && recursive || SourcePaths.Comparer.Equals(scope, path) || recursive &&
        path.StartsWith(scope.TrimEnd('/') + "/", StringComparison.OrdinalIgnoreCase);
    private static void ValidateFiles(IReadOnlyList<FileSnapshot> files)
    {
        var paths = new HashSet<string>(SourcePaths.Comparer);
        foreach (var file in files)
        {
            if (file == null || !paths.Add(SourcePaths.Relative(file.RelativePath)) ||
                file.Size < 0 || file.Ready && string.IsNullOrEmpty(file.Hash))
                throw new InvalidDataException("Invalid or duplicate inventory entry.");
        }
    }
}
