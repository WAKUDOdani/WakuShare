using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.Encodings.Web;
using System.Text.Unicode;

namespace CapSync.Core;

public sealed class StateStore(string path)
{
    private readonly string _path = Path.GetFullPath(path);
    private string? _loadedHash;
    private bool _loaded;
    public static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true, Encoder = JavaScriptEncoder.Create(UnicodeRanges.All),
        Converters = { new JsonStringEnumConverter() }
    };

    public SyncState Load()
    {
        _loaded = true;
        if (!File.Exists(_path)) { _loadedHash = null; return new SyncState(); }
        var bytes = File.ReadAllBytes(_path);
        var state = JsonSerializer.Deserialize<SyncState>(bytes, JsonOptions) ?? throw new InvalidDataException("Empty state.");
        if (state.SchemaVersion is not (1 or 2 or 3 or 4 or 5 or 6 or 7 or 8 or 9)) throw new InvalidDataException("Unsupported state version.");
        WatchConfigurationRules.Validate(state, _path);
        ValidateTransfers(state);
        if (state.Bindings == null || state.Sources == null || state.Pending == null || state.AddAttempts==null || state.ManagedFolders==null || state.UpdateAttempts==null || state.DeleteAttempts==null ||
            state.Bindings.Any(b=>b==null || b.Id==Guid.Empty || string.IsNullOrWhiteSpace(b.ProjectId) || string.IsNullOrWhiteSpace(b.MediaFolderId) || !Path.IsPathFullyQualified(b.RootPath)) ||
            state.Sources.Any(s=>s==null || s.Id==Guid.Empty || s.Version<1 || s.RetiredMaterialIds==null || !state.Bindings.Any(b=>b.Id==s.BindingId)) ||
            state.Pending.Any(p=>p==null || !state.Sources.Any(s=>s.Id==p.SourceId && s.BindingId==p.BindingId && s.Version==p.SourceVersion)) ||
            state.Bindings.GroupBy(b=>b.Id).Any(g=>g.Count()>1) || state.Sources.GroupBy(s=>s.Id).Any(g=>g.Count()>1) ||
            state.Sources.GroupBy(s=>s.BindingId+"/"+s.RelativePath,SourcePaths.Comparer).Any(g=>g.Count()>1) ||
            state.Pending.GroupBy(p=>p.SourceId).Any(g=>g.Count()>1) ||
            state.AddAttempts.Any(a=>a==null || a.Job==null || a.Job.Id==Guid.Empty || a.Job.SourceVersion<1 ||
                !state.Sources.Any(s=>s.Id==a.Job.SourceId && MaterialOwnership.InBinding(state,s,a.Job.BindingId,a.Status)) ||
                !Path.IsPathFullyQualified(a.Job.SourcePath) || !Path.IsPathFullyQualified(a.Job.RootPath) ||
                !SourcePaths.Within(a.Job.RootPath,a.Job.SourcePath)) ||
            state.AddAttempts.GroupBy(a=>a.Job.Id).Any(g=>g.Count()>1) ||
            state.AddAttempts.Where(a=>a.Status is not ("Completed" or "Abandoned")).GroupBy(a=>a.Job.SourceId).Any(g=>g.Count()>1) ||
            state.ManagedFolders.Any(f=>f==null || f.Job==null || f.Job.Id==Guid.Empty || string.IsNullOrWhiteSpace(f.Job.FolderId) ||
                !state.Bindings.Any(b=>b.Id==f.Job.BindingId && b.ProjectId==f.Job.ProjectId && SourcePaths.Comparer.Equals(b.RootPath,f.Job.RootPath))) ||
            state.ManagedFolders.GroupBy(f=>f.Job.Id).Any(g=>g.Count()>1) ||
            state.ManagedFolders.GroupBy(f=>f.Job.BindingId+"/"+f.Job.RelativePath,SourcePaths.Comparer).Any(g=>g.Count()>1) ||
            state.ManagedFolders.GroupBy(f=>f.Job.ProjectId+"/"+f.Job.FolderId).Any(g=>g.Count()>1) ||
            state.UpdateAttempts.Any(a=>a==null || a.Job==null || a.Job.Id==Guid.Empty || a.Job.SourceVersion<1 ||
                !state.Sources.Any(s=>s.Id==a.Job.SourceId && MaterialOwnership.InBinding(state,s,a.Job.BindingId,a.Status) && MaterialOwnership.Historical(s,a.Job.MaterialId,a.Status)) ||
                !state.Bindings.Any(b=>b.Id==a.Job.BindingId && b.ProjectId==a.Job.ProjectId && SourcePaths.Comparer.Equals(b.RootPath,a.Job.RootPath)) ||
                !Path.IsPathFullyQualified(a.Job.SourcePath) || !SourcePaths.Within(a.Job.RootPath,a.Job.SourcePath)) ||
            state.UpdateAttempts.GroupBy(a=>a.Job.Id).Any(g=>g.Count()>1) ||
            state.UpdateAttempts.Where(a=>a.Status is not ("Completed" or "Abandoned")).GroupBy(a=>a.Job.SourceId).Any(g=>g.Count()>1) ||
            state.Sources.Any(s=>s.MaterialRemoved && (s.MaterialId==null || s.AppliedPath==null || s.AppliedPresence!=Presence.Missing)) ||
            state.DeleteAttempts.Any(a=>a==null || a.Job==null || a.Job.Id==Guid.Empty || a.Job.SourceVersion<1 || a.Job.Flags!=ChangeFlags.Missing ||
                !state.Sources.Any(s=>s.Id==a.Job.SourceId && MaterialOwnership.InBinding(state,s,a.Job.BindingId,a.Status) && MaterialOwnership.Historical(s,a.Job.MaterialId,a.Status)) ||
                !state.Bindings.Any(b=>b.Id==a.Job.BindingId && b.ProjectId==a.Job.ProjectId && SourcePaths.Comparer.Equals(b.RootPath,a.Job.RootPath)) ||
                !Path.IsPathFullyQualified(a.Job.SourcePath) || !SourcePaths.Within(a.Job.RootPath,a.Job.SourcePath)) ||
            state.DeleteAttempts.GroupBy(a=>a.Job.Id).Any(g=>g.Count()>1) ||
            state.DeleteAttempts.Where(a=>a.Status is not ("Completed" or "Abandoned")).GroupBy(a=>a.Job.SourceId).Any(g=>g.Count()>1))
            throw new InvalidDataException("State ownership, identities or queue revisions are inconsistent.");
        ValidateRestores(state);
        foreach(var attempt in state.UpdateAttempts.Where(a=>a.Job.DestinationFolderId!=null))
        {
            var job=attempt.Job;var binding=state.Bindings.Single(b=>b.Id==job.BindingId);
            if(job.Flags!=ChangeFlags.Path || string.IsNullOrWhiteSpace(job.DestinationFolderId) ||
                SourcePaths.Comparer.Equals(FolderResolver.DirectoryOf(job.PreviousPath),FolderResolver.DirectoryOf(job.RelativePath)) ||
                !FolderResolver.OwnsDestination(state,binding,job.RelativePath,job.DestinationFolderId))
                throw new InvalidDataException("Move destination ownership changed");
        }
        foreach(var source in state.Sources) SourcePaths.Relative(source.RelativePath);
        foreach(var folder in state.ManagedFolders) SourcePaths.Relative(folder.Job.RelativePath);
        foreach(var update in state.UpdateAttempts){SourcePaths.Relative(update.Job.PreviousPath);SourcePaths.Relative(update.Job.RelativePath);}
        foreach(var deletion in state.DeleteAttempts){SourcePaths.Relative(deletion.Job.PreviousPath);SourcePaths.Relative(deletion.Job.RelativePath);}
        _loadedHash = Hash(bytes);
        return state;
    }

    public void Save(SyncState state)
    {
        if (!_loaded) throw new InvalidOperationException("Load before saving to establish concurrency ownership.");
        WatchConfigurationRules.Validate(state, _path);
        Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
        using var stateLock = new FileStream(_path + ".lock", FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
        var current = File.Exists(_path) ? File.ReadAllBytes(_path) : null;
        if ((current == null ? null : Hash(current)) != _loadedHash)
            throw new InvalidOperationException("State was changed by another writer; reload before retrying.");
        // An older observe-only binary must refuse a state carrying live jobs.
        if (state.AddAttempts.Count>0) state.SchemaVersion=2;
        if (state.ManagedFolders.Count>0) state.SchemaVersion=3;
        if (state.UpdateAttempts.Count>0) state.SchemaVersion=4;
        if (state.DeleteAttempts.Count>0 || state.Sources.Any(s=>s.MaterialRemoved)) state.SchemaVersion=5;
        if (state.RestoreAttempts.Count>0 || state.Sources.Any(s=>s.RetiredMaterialIds.Count>0)) state.SchemaVersion=6;
        if (state.UpdateAttempts.Any(a=>a.Job.DestinationFolderId!=null)) state.SchemaVersion=7;
        if (state.TransferAttempts.Count>0) state.SchemaVersion=8;
        if (state.WatchConfiguration != null || state.RootInventories.Count > 0) state.SchemaVersion=9;
        var bytes = JsonSerializer.SerializeToUtf8Bytes(state, JsonOptions);
        if (current != null && bytes.AsSpan().SequenceEqual(current)) return;
        var temporary = _path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            using (var output = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            { output.Write(bytes); output.Flush(flushToDisk: true); }
            if (current != null) File.Copy(_path, _path + ".bak", overwrite: true);
            File.Move(temporary, _path, overwrite: true);
            _loadedHash = Hash(bytes);
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }

    private static string Hash(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes));

    private static void ValidateRestores(SyncState state)
    {
        if(state.RestoreAttempts==null || state.Sources.Any(s=>s.RetiredMaterialIds.Any(string.IsNullOrWhiteSpace) ||
            s.RetiredMaterialIds.Contains(s.MaterialId??"",SourcePaths.Comparer) ||
            s.RetiredMaterialIds.Distinct(SourcePaths.Comparer).Count()!=s.RetiredMaterialIds.Count))
            throw new InvalidDataException("Invalid retired material identities");
        var owners=state.Sources.SelectMany(s=>s.RetiredMaterialIds.Concat(s.MaterialId==null?[]:[s.MaterialId])
            .Select(id=>state.Bindings.Single(b=>b.Id==s.BindingId).ProjectId+"/"+id));
        if(owners.GroupBy(id=>id,SourcePaths.Comparer).Any(g=>g.Count()>1))
            throw new InvalidDataException("Material identity belongs to several sources");
        foreach(var attempt in state.RestoreAttempts)
        {
            var job=attempt?.Job?.Import;
            if(job==null || job.Id==Guid.Empty || job.SourceVersion<1 || string.IsNullOrWhiteSpace(attempt!.Job.PreviousMaterialId))
                throw new InvalidDataException("Invalid restore job");
            var source=state.Sources.SingleOrDefault(s=>s.Id==job.SourceId && MaterialOwnership.InBinding(state,s,job.BindingId,attempt.Status));
            var binding=state.Bindings.SingleOrDefault(b=>b.Id==job.BindingId && b.ProjectId==job.ProjectId && SourcePaths.Comparer.Equals(b.RootPath,job.RootPath));
            if(source==null || binding==null || !MaterialOwnership.Historical(source,attempt.Job.PreviousMaterialId,attempt.Status) ||
                !Path.IsPathFullyQualified(job.SourcePath) || !SourcePaths.Within(job.RootPath,job.SourcePath) ||
                !SourcePaths.Comparer.Equals(Path.GetFullPath(Path.Combine(job.RootPath,SourcePaths.Relative(job.RelativePath))),job.SourcePath) ||
                (attempt.Status is not ("Completed" or "Abandoned") && !source.MaterialRemoved) ||
                (attempt.Status=="Completed" && (string.IsNullOrWhiteSpace(attempt.MaterialId) ||
                    !MaterialOwnership.Has(source,attempt.MaterialId) || !source.RetiredMaterialIds.Contains(attempt.Job.PreviousMaterialId,SourcePaths.Comparer) ||
                    SourcePaths.Comparer.Equals(attempt.MaterialId,attempt.Job.PreviousMaterialId))))
                throw new InvalidDataException("Restore ownership or history changed");
        }
        if(state.RestoreAttempts.GroupBy(a=>a.Job.Import.Id).Any(g=>g.Count()>1) ||
            state.RestoreAttempts.Where(a=>a.Status is not ("Completed" or "Abandoned")).GroupBy(a=>a.Job.Import.SourceId).Any(g=>g.Count()>1))
            throw new InvalidDataException("Duplicate restore job");
    }

    private static void ValidateTransfers(SyncState state)
    {
        if(state.Bindings==null || state.Sources==null || state.TransferAttempts==null)
            throw new InvalidDataException("Transfer ownership state is missing");
        foreach(var attempt in state.TransferAttempts)
        {
            var job=attempt?.Job;
            if(job==null || job.Id==Guid.Empty || job.SourceVersion<1 || job.Flags!=ChangeFlags.Path ||
                job.BindingId==job.DestinationBindingId || string.IsNullOrWhiteSpace(job.FileIdentity) || string.IsNullOrWhiteSpace(job.MaterialId))
                throw new InvalidDataException("Invalid transfer job");
            var source=state.Sources.SingleOrDefault(s=>s.Id==job.SourceId);
            var old=state.Bindings.SingleOrDefault(b=>b.Id==job.BindingId);
            var destination=state.Bindings.SingleOrDefault(b=>b.Id==job.DestinationBindingId);
            if(source==null || old==null || destination==null || old.ProjectId!=job.ProjectId || destination.ProjectId!=job.ProjectId ||
                !MaterialOwnership.Has(source,job.MaterialId) || source.Version<job.SourceVersion ||
                !SourcePaths.Comparer.Equals(old.RootPath,job.RootPath) || !SourcePaths.Comparer.Equals(destination.RootPath,job.DestinationRootPath) ||
                old.MediaFolderId!=job.MediaFolderId || destination.MediaFolderId!=job.DestinationMediaFolderId ||
                !Path.IsPathFullyQualified(job.SourcePath) || !SourcePaths.Within(job.DestinationRootPath,job.SourcePath) ||
                !SourcePaths.Comparer.Equals(Path.GetFullPath(Path.Combine(job.DestinationRootPath,SourcePaths.Relative(job.RelativePath))),job.SourcePath) ||
                !FolderResolver.OwnsDestination(state,destination,job.RelativePath,job.DestinationFolderId) ||
                attempt!.Status is not ("Completed" or "Abandoned") && source.BindingId!=job.BindingId)
                throw new InvalidDataException("Transfer roots, source or destination changed");
            SourcePaths.Relative(job.PreviousPath);
        }
        if(state.TransferAttempts.GroupBy(a=>a.Job.Id).Any(g=>g.Count()>1) ||
            state.TransferAttempts.Where(a=>a.Status is not ("Completed" or "Abandoned")).GroupBy(a=>a.Job.SourceId).Any(g=>g.Count()>1))
            throw new InvalidDataException("Duplicate transfer job");
        foreach(var group in state.TransferAttempts.Where(a=>a.Status=="Completed").GroupBy(a=>a.Job.SourceId))
        {
            var jobs=group.Select(a=>a.Job).ToArray();
            for(var i=1;i<jobs.Length;i++)
                if(jobs[i-1].DestinationBindingId!=jobs[i].BindingId || jobs[i-1].SourceVersion>=jobs[i].SourceVersion)
                    throw new InvalidDataException("Transfer ownership history is disconnected");
            if(state.Sources.Single(s=>s.Id==group.Key).BindingId!=jobs[^1].DestinationBindingId)
                throw new InvalidDataException("Current source binding differs from transfer history");
        }
    }
}
