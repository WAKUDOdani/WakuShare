namespace CapSync.Core;

// Called only after a complete, session-owned SDK/catalog read. A removed card
// retires its UUID; restoration imports a card and can never recreate clips.
public static class BinCatalogReconciler
{
    public static int Observe(SyncState state, string projectId, IReadOnlySet<string> materialIds, DateTimeOffset now)
    {
        var bindings = state.Bindings.Where(b => b.ProjectId == projectId && b.Status == "Ready").Select(b => b.Id).ToHashSet();
        if (bindings.Count == 0) return 0;
        // An incomplete native command owns its original revision until its
        // receipt is resolved. Absence must never silently retire that job.
        if (state.AddAttempts.Any(a => a.Job.ProjectId == projectId && a.Status is not ("Completed" or "Abandoned")) ||
            state.UpdateAttempts.Any(a => a.Job.ProjectId == projectId && a.Status is not ("Completed" or "Abandoned")) ||
            state.TransferAttempts.Any(a => a.Job.ProjectId == projectId && a.Status is not ("Completed" or "Abandoned")) ||
            state.DeleteAttempts.Any(a => a.Job.ProjectId == projectId && a.Status is not ("Completed" or "Abandoned")) ||
            state.RestoreAttempts.Any(a => a.Job.Import.ProjectId == projectId && a.Status is not ("Completed" or "Abandoned"))) return 0;
        var removed = state.Sources.Where(s => bindings.Contains(s.BindingId) && s.MaterialId != null && !s.MaterialRemoved &&
            s.AppliedPath != null && !materialIds.Contains(s.MaterialId)).ToArray();
        foreach (var source in removed)
        {
            source.MaterialRemoved = true;
            source.AppliedPresence = Presence.Missing;
            ++source.Version;
            Reconciler.Refresh(state, state.Bindings.Single(b => b.Id == source.BindingId), source, now);
        }
        return removed.Length;
    }
}
