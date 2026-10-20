namespace CapSync.Core;

public enum Presence { Present, Missing }
[Flags] public enum ChangeFlags { None = 0, Add = 1, Content = 2, Path = 4, Missing = 8, Restore = 16 }
public sealed class Binding
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string ProjectId { get; set; } = "";
    public string MediaFolderId { get; set; } = "";
    public string RootPath { get; set; } = "";
    public string Status { get; set; } = "Ready";
    // Explicitly adopted imports in the selected target folder, keyed by relative path.
    public Dictionary<string, string> InitialImports { get; set; } = [];
}
public sealed class Source
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid BindingId { get; set; }
    public string RelativePath { get; set; } = "";
    public string? FileIdentity { get; set; }
    public string Hash { get; set; } = "";
    public long Size { get; set; }
    public long LastWriteTicks { get; set; }
    public Presence Presence { get; set; }
    public int Version { get; set; } = 1;
    public string? MaterialId { get; set; }
    public string? AppliedPath { get; set; }
    public string? AppliedHash { get; set; }
    public Presence? AppliedPresence { get; set; }
    // Keep the retired bin UUID and logical source identity. A returned file
    // requires an explicit restore adapter, not adoption/import by name/hash.
    public bool MaterialRemoved { get; set; }
    public List<string> RetiredMaterialIds { get; set; } = [];
}
public sealed class PendingChange
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid SourceId { get; set; }
    public Guid BindingId { get; set; }
    public string ProjectId { get; set; } = "";
    public string MediaFolderId { get; set; } = "";
    public string? MaterialId { get; set; }
    public int SourceVersion { get; set; }
    public ChangeFlags Flags { get; set; }
    public string? PreviousPath { get; set; }
    public string RelativePath { get; set; } = "";
    public string Hash { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public string Status { get; set; } = "WaitingForMediaAdapter";
    public string? Reason { get; set; }
}
public sealed class SyncState
{
    [System.Text.Json.Serialization.JsonRequired]
    public int SchemaVersion { get; set; } = 1;
    [System.Text.Json.Serialization.JsonRequired]
    public List<Binding> Bindings { get; set; } = [];
    [System.Text.Json.Serialization.JsonRequired]
    public List<Source> Sources { get; set; } = [];
    [System.Text.Json.Serialization.JsonRequired]
    public List<PendingChange> Pending { get; set; } = [];
    // Optional for observer states created before the live-add executor.
    public List<AddAttempt> AddAttempts { get; set; } = [];
    public List<ManagedFolder> ManagedFolders { get; set; } = [];
    public List<UpdateAttempt> UpdateAttempts { get; set; } = [];
    public List<DeleteAttempt> DeleteAttempts { get; set; } = [];
    public List<RestoreAttempt> RestoreAttempts { get; set; } = [];
    public List<TransferAttempt> TransferAttempts { get; set; } = [];
    public WatchConfiguration? WatchConfiguration { get; set; }
    public List<RootInventoryCache> RootInventories { get; set; } = [];
}

public sealed record WatchConfiguration(long Revision, string[] Roots);
public sealed record RootInventoryCache(string RootPath, FileSnapshot[] Files);

public static class MaterialOwnership
{
    public static bool InBinding(SyncState state,Source source,Guid binding,string status)=>source.BindingId==binding ||
        status is "Completed" or "Abandoned" && state.TransferAttempts.Any(a=>a.Status=="Completed" &&
            a.Job.SourceId==source.Id && a.Job.BindingId==binding);
    // A new file at a reused path must wait until the existing material has
    // actually left that path in CapCut, not merely in the desired inventory.
    public static bool AppliedPathOccupied(SyncState state,Binding binding,string relative,Guid exceptSource)
    {
        var path=Path.GetFullPath(Path.Combine(binding.RootPath,SourcePaths.Relative(relative)));
        return state.Sources.Any(source=>source.Id!=exceptSource && source.MaterialId!=null && !source.MaterialRemoved &&
            source.AppliedPath!=null && state.Bindings.Any(owner=>owner.Id==source.BindingId && owner.ProjectId==binding.ProjectId &&
                SourcePaths.Comparer.Equals(path,Path.GetFullPath(Path.Combine(owner.RootPath,SourcePaths.Relative(source.AppliedPath))))));
    }
    public static bool Has(Source source,string id) => SourcePaths.Comparer.Equals(source.MaterialId,id) ||
        source.RetiredMaterialIds.Contains(id,SourcePaths.Comparer);
    public static bool Conflicts(SyncState state,Source source,string project,string id) =>
        state.Sources.Any(s=>s.Id!=source.Id && Has(s,id) && state.Bindings.Single(b=>b.Id==s.BindingId).ProjectId==project);
    public static bool Historical(Source source,string id,string status) => SourcePaths.Comparer.Equals(source.MaterialId,id) ||
        status is "Completed" or "Abandoned" && source.RetiredMaterialIds.Contains(id,SourcePaths.Comparer);
}
public sealed record FileSnapshot(string RelativePath, long Size, long LastWriteTicks,
    string? FileIdentity, string? Hash, bool Ready = true);
public sealed record Inventory(bool RootAvailable, bool Complete, IReadOnlyList<FileSnapshot> Files,
    IReadOnlyList<string> Warnings);

public static class SourcePaths
{
    public static readonly StringComparer Comparer = StringComparer.OrdinalIgnoreCase;
    public static string NormalizeRoot(string value) => Path.TrimEndingDirectorySeparator(Path.GetFullPath(value));
    public static string Relative(string value)
    {
        var path = value.Replace('\\', '/');
        if (string.IsNullOrWhiteSpace(path) || Path.IsPathRooted(path) || path.Contains(':') ||
            path.Split('/').Any(p => p is "" or "." or ".."))
            throw new InvalidDataException("Source path must be a non-traversing relative path.");
        return path;
    }
    public static bool Within(string root, string path)
    {
        var relative = Path.GetRelativePath(Path.GetFullPath(root), Path.GetFullPath(path));
        return relative == "." || !Path.IsPathRooted(relative) && relative != ".." &&
            !relative.StartsWith(".." + Path.DirectorySeparatorChar, StringComparison.Ordinal);
    }
    public static void AddBinding(SyncState state, Binding binding)
    {
        if (string.IsNullOrWhiteSpace(binding.ProjectId) || string.IsNullOrWhiteSpace(binding.MediaFolderId))
            throw new InvalidDataException("Project and target folder identities are required.");
        binding.RootPath = Path.GetFullPath(binding.RootPath);
        if (state.Bindings.Any(b => b.Id == binding.Id || b.ProjectId == binding.ProjectId &&
            (Within(b.RootPath, binding.RootPath) || Within(binding.RootPath, b.RootPath))))
            throw new InvalidDataException("Bindings in one project must not overlap.");
        state.Bindings.Add(binding);
    }
}
