namespace CapSync.Core;

// This planner writes its own state only. It never invokes CapCut or edits a draft.
public static class Reconciler
{
    public static void Apply(SyncState state, Binding binding, Inventory scan, DateTimeOffset now)
    {
        if (!scan.RootAvailable) { binding.Status = "RootUnavailable"; return; }
        binding.Status = scan.Complete ? "Ready" : "IncompleteScan";
        var files = scan.Files.ToDictionary(f => SourcePaths.Relative(f.RelativePath), SourcePaths.Comparer);
        var owned = state.Sources.Where(s => s.BindingId == binding.Id).ToList();
        var byPath = owned.ToDictionary(s => s.RelativePath, SourcePaths.Comparer);
        var pendingBySource = state.Pending.ToDictionary(p => p.SourceId);
        var removePending = new HashSet<Guid>();
        void PlanSource(Source source) => Plan(state, binding, source, now, pendingBySource, removePending);
        void FlushRemoved() { if (removePending.Count > 0) state.Pending.RemoveAll(p => removePending.Contains(p.Id)); }

        // A rename needs a unique physical identity AND matching bytes in this binding.
        // Equal name/hash alone never supplies ownership. Hard-link aliases stay separate.
        if (scan.Complete)
        {
            var oldIdentities = owned.Where(s => s.Presence == Presence.Present && s.FileIdentity != null)
                .GroupBy(s => s.FileIdentity!).ToDictionary(g => g.Key, g => g.ToList());
            var newIdentities = scan.Files.Where(f => f.FileIdentity != null)
                .GroupBy(f => f.FileIdentity!).ToDictionary(g => g.Key, g => g.ToList());
            var relocations = new Dictionary<Source,string>();
            foreach (var old in owned.Where(s => s.Presence == Presence.Present))
            {
                if (old.FileIdentity == null || oldIdentities[old.FileIdentity].Count != 1 ||
                    !newIdentities.TryGetValue(old.FileIdentity, out var candidates) || candidates.Count != 1) continue;
                var file = candidates[0];
                var target = SourcePaths.Relative(file.RelativePath);
                if (!file.Ready || file.Hash != old.Hash || SourcePaths.Comparer.Equals(target,old.RelativePath)) continue;
                relocations.Add(old,target);
            }
            // Resolve all physical identities before assigning paths. The old
            // path may already contain a new file, or two tracked files may swap
            // names. Applying one path at a time would overwrite ownership.
            if(relocations.Any(move=>byPath.TryGetValue(move.Value,out var occupant)&&!relocations.ContainsKey(occupant)))
            {
                binding.Status="IdentityConflict";
                return; // No guessing or partial reassignment of this snapshot.
            }
            foreach(var source in relocations.Keys)byPath.Remove(source.RelativePath);
            foreach(var (source,target) in relocations)
            {
                source.RelativePath=target;source.Version++;
                byPath.Add(target,source);
            }
        }
        foreach (var (relative, file) in files)
        {
            if (!file.Ready || file.Hash == null) continue;
            if (!byPath.TryGetValue(relative, out var source))
            {
                source = new Source { BindingId = binding.Id, RelativePath = relative,
                    FileIdentity = file.FileIdentity, Hash = file.Hash, Size = file.Size,
                    LastWriteTicks = file.LastWriteTicks, Presence = Presence.Present };
                var imports = binding.InitialImports.Where(p => SourcePaths.Comparer.Equals(p.Key, relative)).ToList();
                if (imports.Count == 1)
                {
                    source.MaterialId = imports[0].Value;
                    source.AppliedPath = relative; source.AppliedHash = file.Hash;
                    source.AppliedPresence = Presence.Present;
                    binding.InitialImports.Remove(imports[0].Key);
                }
                state.Sources.Add(source); owned.Add(source); byPath.Add(relative, source);
            }
            else
            {
                if (source.Hash != file.Hash || source.Presence != Presence.Present) source.Version++;
                source.Hash = file.Hash; source.Size = file.Size;
                source.LastWriteTicks = file.LastWriteTicks; source.FileIdentity = file.FileIdentity;
                source.Presence = Presence.Present;
            }
            PlanSource(source);
        }
        if (!scan.Complete) { FlushRemoved(); return; }
        // Imported sources missing at the initial binding still need an owned tombstone.
        foreach (var import in binding.InitialImports.ToArray())
        {
            var relative = SourcePaths.Relative(import.Key);
            if (files.ContainsKey(relative) || byPath.ContainsKey(relative)) continue;
            var source = new Source { BindingId = binding.Id, RelativePath = relative,
                MaterialId = import.Value, Presence = Presence.Missing,
                AppliedPath = relative, AppliedPresence = Presence.Present };
            state.Sources.Add(source); owned.Add(source); byPath.Add(relative, source);
            binding.InitialImports.Remove(import.Key);
            PlanSource(source);
        }
        foreach (var source in owned.Where(s => s.Presence == Presence.Present && !files.ContainsKey(s.RelativePath)))
        {
            source.Presence = Presence.Missing; source.Version++;
            PlanSource(source);
        }
        FlushRemoved();
    }

    private static void Plan(SyncState state, Binding binding, Source source, DateTimeOffset now,
        Dictionary<Guid, PendingChange>? pendingIndex = null, HashSet<Guid>? removals = null)
    {
        var flags = ChangeFlags.None;
        if (source.MaterialId == null)
        {
            if (source.Presence == Presence.Present) flags = ChangeFlags.Add;
        }
        else if (source.Presence == Presence.Missing)
        {
            if (source.AppliedPresence != Presence.Missing) flags = ChangeFlags.Missing;
        }
        else
        {
            if (source.AppliedPresence == Presence.Missing) flags |= ChangeFlags.Restore;
            if (!SourcePaths.Comparer.Equals(source.RelativePath, source.AppliedPath)) flags |= ChangeFlags.Path;
            if (source.Hash != source.AppliedHash) flags |= ChangeFlags.Content;
        }
        PendingChange? pending;
        if (pendingIndex != null) pendingIndex.TryGetValue(source.Id, out pending);
        else pending = state.Pending.SingleOrDefault(p => p.SourceId == source.Id);
        if (flags == ChangeFlags.None)
        {
            if (pending != null)
            {
                pendingIndex?.Remove(source.Id);
                if (removals != null) removals.Add(pending.Id); else state.Pending.Remove(pending);
            }
            return;
        }
        if (pending == null)
        {
            pending = new PendingChange { SourceId = source.Id, BindingId = binding.Id,
                ProjectId = binding.ProjectId, MediaFolderId = binding.MediaFolderId, CreatedAt = now };
            state.Pending.Add(pending);
            pendingIndex?.Add(source.Id, pending);
        }
        var changed = pending.Flags != flags || pending.SourceVersion != source.Version ||
            pending.RelativePath != source.RelativePath || pending.Hash != source.Hash || pending.MaterialId != source.MaterialId;
        pending.Flags = flags; pending.SourceVersion = source.Version;
        pending.PreviousPath = source.AppliedPath; pending.RelativePath = source.RelativePath;
        pending.Hash = source.Hash; pending.MaterialId = source.MaterialId;
        if (changed) { pending.UpdatedAt = now; pending.Reason = null; }
    }

    public static void Refresh(SyncState state, Binding binding, Source source, DateTimeOffset now)
        => Plan(state,binding,source,now);

    // Future adapters may acknowledge a verified result, guarded by the source version.
    // The CLI does not expose this operation or claim that pending edits were applied.
    public static void Acknowledge(SyncState state, Guid sourceId, int expectedVersion, string materialId)
    {
        if (string.IsNullOrWhiteSpace(materialId)) throw new InvalidDataException("Missing verified material ID.");
        var source = state.Sources.Single(s => s.Id == sourceId);
        if (source.Version != expectedVersion) throw new InvalidOperationException("Source changed since planning.");
        source.MaterialId = materialId; source.AppliedHash = source.Hash;
        source.AppliedPath = source.RelativePath; source.AppliedPresence = source.Presence;
        state.Pending.RemoveAll(p => p.SourceId == sourceId);
    }
}
