namespace CapSync.Core;

public static class WatchConfigurationRules
{
    public static string[] Roots(IEnumerable<string> roots, string statePath)
    {
        var values = roots.ToArray();
        if (values.Length > 256) throw new InvalidDataException("Too many observed roots.");
        if (values.Any(path => string.IsNullOrWhiteSpace(path) || path.Length > 8192 ||
            !Path.IsPathFullyQualified(path) || path.Contains('\0')))
            throw new InvalidDataException("Absolute source roots required.");
        var normalized = values.Select(SourcePaths.NormalizeRoot).Order(SourcePaths.Comparer).ToArray();
        if (normalized.Distinct(SourcePaths.Comparer).Count() != normalized.Length)
            throw new InvalidDataException("Duplicate observed root.");
        if (normalized.Any(root => SourcePaths.Within(root, statePath)))
            throw new InvalidDataException("Source root contains the private worker state.");
        return normalized;
    }
    public static void Validate(SyncState state, string statePath)
    {
        if (state.WatchConfiguration is { } configuration)
        {
            if (configuration.Revision < 0 || configuration.Revision > 9007199254740991 || configuration.Roots == null)
                throw new InvalidDataException("Invalid watch configuration.");
            Roots(configuration.Roots, statePath);
        }
        if (state.RootInventories == null || state.RootInventories.Count > 512 ||
            state.RootInventories.Any(cache => cache == null || !Path.IsPathFullyQualified(cache.RootPath) || cache.Files == null))
            throw new InvalidDataException("Invalid durable root inventory.");
        if (state.RootInventories.GroupBy(cache => SourcePaths.NormalizeRoot(cache.RootPath), SourcePaths.Comparer).Any(group => group.Count() > 1))
            throw new InvalidDataException("Duplicate durable root inventory.");
        foreach (var cache in state.RootInventories)
        {
            if (cache.Files.Length > 500000 || cache.Files.Any(file => file == null || !file.Ready || file.Size < 0 || file.LastWriteTicks < 0 ||
                string.IsNullOrWhiteSpace(file.FileIdentity) || file.FileIdentity.Length > 128 || file.Hash?.Length != 64 || !file.Hash.All(Uri.IsHexDigit)))
                throw new InvalidDataException("Invalid durable file observation.");
            foreach (var file in cache.Files) SourcePaths.Relative(file.RelativePath);
            if (cache.Files.GroupBy(file => SourcePaths.Relative(file.RelativePath), SourcePaths.Comparer).Any(group => group.Count() > 1))
                throw new InvalidDataException("Duplicate durable source path.");
        }
    }
}
