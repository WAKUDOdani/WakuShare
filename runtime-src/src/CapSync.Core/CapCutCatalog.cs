using System.Text.Json;

namespace CapSync.Core;

public sealed record CatalogMaterial(string Id, string Path, string Kind, string Name);
public sealed record CatalogFolder(string Id, string Name);
public sealed record CatalogLink(string ChildId, string ParentId);
public sealed record CapCutCatalog(string ProjectId, string Name, IReadOnlyList<CatalogMaterial> Materials,
    IReadOnlyList<CatalogFolder> Folders, IReadOnlyList<CatalogLink> Links)
{
    public static CapCutCatalog Read(string projectDirectory)
    {
        var metaPath = Path.Combine(projectDirectory, "draft_meta_info.json");
        var foldersPath = Path.Combine(projectDirectory, "draft_virtual_store.json");
        var metaBytes = File.ReadAllBytes(metaPath);
        var folderBytes = File.ReadAllBytes(foldersPath);
        if (!metaBytes.AsSpan().SequenceEqual(File.ReadAllBytes(metaPath)) ||
            !folderBytes.AsSpan().SequenceEqual(File.ReadAllBytes(foldersPath)))
            throw new IOException("CapCut catalog changed while reading; retry the read-only snapshot.");
        using var meta = JsonDocument.Parse(metaBytes);
        using var folders = JsonDocument.Parse(folderBytes);
        static string Text(JsonElement node, string key) => node.TryGetProperty(key, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString()! : "";
        static IEnumerable<JsonElement> Group(JsonElement node, string key, int type)
        {
            if (!node.TryGetProperty(key, out var groups) || groups.ValueKind != JsonValueKind.Array) yield break;
            foreach (var group in groups.EnumerateArray())
                if (group.TryGetProperty("type", out var kind) && kind.TryGetInt32(out var number) && number == type &&
                    group.TryGetProperty("value", out var items) && items.ValueKind == JsonValueKind.Array)
                    foreach (var item in items.EnumerateArray()) yield return item;
        }
        var materials = Group(meta.RootElement, "draft_materials", 0)
            .Select(m => new CatalogMaterial(Text(m,"id"),Text(m,"file_Path"),Text(m,"metetype"),Text(m,"extra_info")))
            .Where(m => m.Id.Length > 0 && m.Path.Length > 0 && m.Kind != "none").ToList();
        var containers = Group(folders.RootElement,"draft_virtual_store",0)
            .Select(f => new CatalogFolder(Text(f,"id"),Text(f,"display_name"))).Where(f => f.Id.Length > 0).ToList();
        var links = Group(folders.RootElement,"draft_virtual_store",1)
            .Select(l => new CatalogLink(Text(l,"child_id"),Text(l,"parent_id"))).Where(l => l.ChildId.Length > 0).ToList();
        var projectId = Text(meta.RootElement,"draft_id");
        if (projectId.Length == 0 || materials.GroupBy(m=>m.Id).Any(g=>g.Count()>1) || containers.GroupBy(f=>f.Id).Any(g=>g.Count()>1))
            throw new InvalidDataException("Catalog identities are missing or duplicated.");
        return new(projectId,Text(meta.RootElement,"draft_name"),materials,containers,links);
    }

    public Dictionary<string,string> AdoptedImports(string folderId, string sourceRoot, out List<string> warnings)
    {
        warnings = [];
        if (!Folders.Any(f=>f.Id==folderId)) throw new InvalidDataException("The selected media folder does not exist.");
        var scope = new HashSet<string> { folderId };
        var queue = new Queue<string>(); queue.Enqueue(folderId);
        var folderIds = Folders.Select(f=>f.Id).ToHashSet();
        while (queue.TryDequeue(out var parent))
            foreach (var child in Links.Where(l=>l.ParentId==parent && folderIds.Contains(l.ChildId)))
            { if (!scope.Add(child.ChildId)) throw new InvalidDataException("Folder relationships are cyclic or ambiguous."); queue.Enqueue(child.ChildId); }
        var selected = Materials.Where(m=>Links.Any(l=>l.ChildId==m.Id && scope.Contains(l.ParentId))).ToList();
        var candidates = new List<(string Relative,string Id)>();
        foreach (var material in selected)
        {
            if (Links.Where(l=>l.ChildId==material.Id).Select(l=>l.ParentId).Distinct().Count()!=1)
            { warnings.Add($"Shared material record excluded: {material.Id}"); continue; }
            if (!Path.IsPathRooted(material.Path) || !SourcePaths.Within(sourceRoot,material.Path))
            { warnings.Add($"Source outside the selected root excluded: {material.Id}"); continue; }
            var relative=SourcePaths.Relative(Path.GetRelativePath(sourceRoot,material.Path));
            candidates.Add((relative,material.Id));
            if (Materials.Any(m=>m.Id!=material.Id && SourcePaths.Comparer.Equals(m.Path,material.Path)))
                warnings.Add($"This physical path is also used by a separate material: {relative}");
        }
        var result=new Dictionary<string,string>(SourcePaths.Comparer);
        foreach(var group in candidates.GroupBy(c=>c.Relative,SourcePaths.Comparer))
        {
            if(group.Count()!=1) { warnings.Add($"Multiple imported records for source: {group.Key}"); continue; }
            result.Add(group.Key,group.Single().Id);
        }
        return result;
    }
}
