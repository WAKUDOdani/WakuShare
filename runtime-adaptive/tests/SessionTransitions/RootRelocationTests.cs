using System.Text.Json;
using CapSync.Core;

internal static class RootRelocationTests
{
    private static void Check(bool value,string reason){if(!value)throw new Exception(reason);}
    public static async Task<int> Run()
    {
        var directory=Path.Combine(Path.GetTempPath(),"wakushare-root-relocation-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(directory);
        try {
            var original=Path.Combine(directory,"original");var target=Path.Combine(directory,"moved");Directory.CreateDirectory(target);
            foreach(var status in new[]{"Unknown","Verified"}) {
                using var channel=new EditorEventChannel(Environment.ProcessId);var draft=Guid.NewGuid().ToString();channel.Apply(new(1,"Project",draft,Path.Combine(directory,"project"),1));var key=channel.State.Project!.Value;
                var binding=new Binding{ProjectId=key,RootPath=original,MediaFolderId=Guid.NewGuid().ToString(),Status="RootUnavailable"};
                var source=new Source{BindingId=binding.Id,RelativePath="clip.png",FileIdentity="old-volume:old-file",Hash="HASH",Size=50,MaterialId=Guid.NewGuid().ToString(),AppliedPath="clip.png",AppliedHash="HASH",Presence=Presence.Present,AppliedPresence=Presence.Present};
                var state=new SyncState{Bindings=[binding],Sources=[source]};var calls=0;
                var folder=new ManagedFolder{Status="Completed",Job=new(Guid.NewGuid(),binding.Id,key,Path.Combine(directory,"project"),original,"nested",Guid.NewGuid().ToString(),binding.MediaFolderId)};
                state.ManagedFolders.Add(folder);
                state.AddAttempts.Add(new(){Status="Completed",MaterialId=source.MaterialId,Job=new(Guid.NewGuid(),source.Id,binding.Id,1,key,Path.Combine(directory,"project"),binding.MediaFolderId,original,source.RelativePath,Path.Combine(original,source.RelativePath),source.Hash,source.FileIdentity,source.Size)});
                state.UpdateAttempts.Add(new(){Status="Completed",Job=new(Guid.NewGuid(),source.Id,binding.Id,1,key,Path.Combine(directory,"project"),binding.MediaFolderId,original,source.RelativePath,source.RelativePath,Path.Combine(original,source.RelativePath),source.Hash,source.MaterialId!,ChangeFlags.Content,source.Size)});
                var originalJobs=JsonSerializer.Serialize(new{state.AddAttempts,state.UpdateAttempts,state.ManagedFolders},StateStore.JsonOptions);
                var adapter=new ExplorerNativeAdapter("unused","unused",channel,true,invokeOverride:request=>{
                    calls++;var payload=JsonSerializer.SerializeToElement(request,StateStore.JsonOptions);
                    if(payload.GetProperty("action").GetString()=="relocateRoot")return Task.FromResult(JsonSerializer.SerializeToElement(new{Status=status,ReceiptId=Guid.NewGuid(),Sources=new[]{new{Id=source.Id,Identity="new-volume:new-file",LastWriteTicks=1}},NativeCommands=status=="Verified"?1:0}));
                    Check(binding.Status=="WaitingForRootFolder","The missing-old-root status must be cleared before folder ownership checks");
                    var id=payload.GetProperty("job").GetProperty("Id").GetGuid();return Task.FromResult(JsonSerializer.SerializeToElement(new{JobId=id,Status="Verified",MaterialId=binding.MediaFolderId,NativeCommands=0}));
                });
                adapter.ConfigureProject(key,[new(binding.Id,target,binding.MediaFolderId,"","original",[original])]);
                var beforeId=source.Id;var beforeMaterial=source.MaterialId;var saved=0;
                var accepted=await adapter.EnsureRoots(state,()=>saved++,CancellationToken.None);
                Check(accepted==(status=="Verified"),"Only a verified root repair can finish");
                Check(source.Id==beforeId && source.MaterialId==beforeMaterial,"Source/material identities survive relocation");
                if(status=="Unknown")Check(binding.RootPath==original && binding.RootMoves.Count==0 && source.FileIdentity=="old-volume:old-file" && calls==1 && saved==0,"Unknown result preserves original ownership, no folder/import dispatch");
                else {
                    Check(binding.RootPath==target && source.FileIdentity=="new-volume:new-file" && RootOwnership.Contains(binding,original),"Verified byte proof permits explicit cross-volume physical identity change");
                    RootOwnership.Validate(binding);
                    var statePath=Path.Combine(directory,"state.json");var store=new StateStore(statePath);store.Load();store.Save(state);var reloaded=new StateStore(statePath).Load();
                    Check(reloaded.Bindings[0].RootMoves.Count==1 && reloaded.Sources[0].Id==beforeId,"Verified history survives restart");
                    Check(reloaded.SchemaVersion==10 && FolderResolver.OwnsDestination(reloaded,reloaded.Bindings[0],"nested/new.png",folder.Job.FolderId),"Historical nested folders remain valid import destinations");
                    Check(JsonSerializer.Serialize(new{reloaded.AddAttempts,reloaded.UpdateAttempts,reloaded.ManagedFolders},StateStore.JsonOptions)==originalJobs,"Completed add/update/folder receipts are immutable across root repair");
                    reloaded.Bindings[0].RootMoves.Add(new("Z:\\wrong","S:\\new",Guid.NewGuid()));
                    try {RootOwnership.Validate(reloaded.Bindings[0]);throw new Exception("Disconnected history was accepted");}catch(InvalidDataException){}
                }
            }
            return 11;
        } finally {Directory.Delete(directory,true);}
    }
}
