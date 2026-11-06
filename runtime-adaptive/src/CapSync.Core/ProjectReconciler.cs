namespace CapSync.Core;

public sealed record CrossBindingMove(Guid SourceId,int SourceVersion,Guid PreviousBindingId,
    Guid DestinationBindingId,string PreviousPath,string RelativePath,string FileIdentity,string Hash,long Size);

// Observe every root before changing any source ownership. Until the cross-root
// mutation adapter exists, retain the complete original graph and expose a plan;
// never misclassify the old path's new occupant as replacement content.
public static class ProjectReconciler
{
    public static IReadOnlyList<CrossBindingMove> Apply(SyncState state,
        IReadOnlyDictionary<Guid,Inventory> inventories,DateTimeOffset now,
        IReadOnlySet<string>? identityBlockedProjects = null)
    {
        if(state.Bindings.Any(b=>b.Status != "Suspended" && !inventories.ContainsKey(b.Id)))
            throw new InvalidDataException("All bound roots must be observed before project reconciliation.");
        var moves=new List<CrossBindingMove>();
        foreach(var project in state.Bindings.Where(b=>b.Status != "Suspended").GroupBy(b=>b.ProjectId))
        {
            var bindings=project.ToArray();
            if (identityBlockedProjects?.Contains(project.Key) == true)
            {
                Hold(state, bindings, "SourceIdentityConflict",
                    "A different or unproven file occupies an absent material's path; source ownership is retained.");
                continue;
            }
            if(bindings.Length==1)
            {Reconciler.Apply(state,bindings[0],inventories[bindings[0].Id],now);continue;}
            if(bindings.Any(b=>!inventories[b.Id].RootAvailable || !inventories[b.Id].Complete))
            {
                Hold(state,bindings,"WaitingForProjectInventory",
                    "All project roots must be readable before resolving file identity across bindings.");
                foreach(var b in bindings)
                    if(!inventories[b.Id].RootAvailable)b.Status="RootUnavailable";
                    else if(!inventories[b.Id].Complete)b.Status="IncompleteScan";
                continue;
            }
            var ids=bindings.Select(b=>b.Id).ToHashSet();
            var sources=state.Sources.Where(s=>ids.Contains(s.BindingId) && s.FileIdentity!=null).ToArray();
            var owners=sources.GroupBy(s=>s.FileIdentity!).ToDictionary(g=>g.Key,g=>g.ToArray());
            var observed=bindings.SelectMany(b=>inventories[b.Id].Files
                .Where(f=>f.FileIdentity!=null).Select(f=>(Binding:b,File:f)))
                .GroupBy(item=>item.File.FileIdentity!).ToDictionary(g=>g.Key,g=>g.ToArray());
            var planned=new List<CrossBindingMove>();string? blocked=null;
            foreach(var source in sources)
            {
                if(!observed.TryGetValue(source.FileIdentity!,out var candidates) ||
                    !candidates.Any(c=>c.Binding.Id!=source.BindingId))continue;
                if(owners[source.FileIdentity!].Length!=1 || candidates.Length!=1)
                {blocked="ProjectIdentityConflict";break;}
                var destination=candidates[0];var file=destination.File;
                if(!file.Ready || file.Hash==null || file.Hash!=source.Hash || file.Size!=source.Size)
                {blocked="WaitingForProjectIdentity";break;}
                planned.Add(new(source.Id,source.Version,source.BindingId,destination.Binding.Id,
                    source.RelativePath,SourcePaths.Relative(file.RelativePath),source.FileIdentity!,file.Hash,file.Size));
            }
            if(blocked!=null)
            {
                Hold(state,bindings,blocked,"Cross-root identity is ambiguous or its bytes are not yet proven; no source reassignment.");
                continue;
            }
            if(planned.Count>0)
            {
                moves.AddRange(planned);
                Hold(state,bindings,"WaitingForCrossBindingAdapter",
                    "Original file found in another binding; retain its ID and defer all project mutations until transfer is supported.");
                continue;
            }
            foreach(var binding in bindings)Reconciler.Apply(state,binding,inventories[binding.Id],now);
        }
        return moves;
    }

    public static bool BlocksEditor(SyncState state)=>state.Bindings.Any(b=>b.Status is
        "WaitingForProjectInventory" or "WaitingForProjectIdentity" or "ProjectIdentityConflict" or "WaitingForCrossBindingAdapter" or "SourceIdentityConflict") ||
        state.Bindings.GroupBy(b=>b.ProjectId).Any(project=>project.Count()>1 &&
            project.Any(b=>b.Status is "RootUnavailable" or "IncompleteScan"));

    private static void Hold(SyncState state,Binding[] bindings,string status,string reason)
    {
        var ids=bindings.Select(b=>b.Id).ToHashSet();
        foreach(var binding in bindings)binding.Status=status;
        foreach(var pending in state.Pending.Where(p=>ids.Contains(p.BindingId)))
        {pending.Status=status;pending.Reason=reason;}
    }
}
