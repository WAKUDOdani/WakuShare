using System.Text.Json;
using CapSync.Core;

static void Check(bool ok,string reason){if(!ok)throw new Exception(reason);}
static ExplorerNativeAdapter.Destination[] Destination()=>[new(Guid.NewGuid(),"C:\\Sources",Guid.NewGuid().ToString(),"","Sources")];
int checks=0;
foreach(var aDrive in new[]{"C","D","S","Z"})foreach(var bDrive in new[]{"C","D","S","Z"}){
 using var channel=new EditorEventChannel(Environment.ProcessId);long sequence=0,epoch=0;
 var a=Guid.NewGuid().ToString();var b=Guid.NewGuid().ToString();
 void Open(string id,string drive){channel.Apply(new(++sequence,"Project",id,drive+":\\Editing\\"+id,++epoch));}
 Open(a,aDrive);var aKey=channel.State.Project!.Value;var aLease=channel.Lease()!;
 var pending=new TaskCompletionSource<JsonElement>();int invoked=0;
 var adapter=new ExplorerNativeAdapter("unused","unused",channel,true,invokeOverride:_=>{++invoked;return pending.Task;});
 Check(!adapter.CanDispatch,"Project cannot dispatch before destination acknowledgement");
 adapter.ConfigureProject(aKey,Destination());Check(adapter.CanDispatch,"A owns its destinations");
 var job=Guid.NewGuid();var task=adapter.Run("folder",new{},job,aKey);Check(invoked==1,"A dispatches once");
 Open(b,bDrive);adapter.InvalidateSession();var bKey=channel.State.Project!.Value;
 Check(!adapter.CanDispatch && adapter.Destinations.Length==0,"B cannot inherit A destinations");
 var refused=await adapter.Run("folder",new{},Guid.NewGuid(),bKey);Check(refused.Status=="Waiting"&&invoked==1,"No stale dispatch before B acknowledgement");
 adapter.ConfigureProject(bKey,Destination());
 pending.SetResult(JsonSerializer.SerializeToElement(new{JobId=job,Status="Unknown",MaterialId=(string?)null,Reason="old A failure",NativeCommands=0}));
 var late=await task;Check(late.JobId==job&&late.Status=="Unknown","Late result remains owned by A job");
 Check(adapter.Status=="Waiting"&&adapter.Reason==null,"Late A failure cannot poison B");
 Open(a,aDrive);adapter.InvalidateSession();Check(!adapter.CanDispatch&&!channel.Matches(aLease),"A return needs new generation acknowledgement");
 adapter.ConfigureProject(aKey,Destination());Check(adapter.CanDispatch,"A can return independently");
 channel.Apply(new(++sequence,"Project",a,aDrive+":\\Editing\\"+a,epoch));Check(adapter.CanDispatch,"Same-project media event retains ownership");
 channel.Apply(new(++sequence,"Home",null,null,++epoch));adapter.InvalidateSession();Check(!adapter.CanDispatch&&adapter.Reason==null,"Home revokes destinations and status");
 Open(b,bDrive);adapter.ConfigureProject(bKey,Destination());channel.Disconnect("test");adapter.InvalidateSession();Check(!adapter.CanDispatch,"Disconnect revokes destinations");
 checks+=11;
}
// Exceptions arriving after a switch must also remain invisible to the new project.
using(var channel=new EditorEventChannel(Environment.ProcessId)){
 var a=Guid.NewGuid().ToString();var b=Guid.NewGuid().ToString();channel.Apply(new(1,"Project",a,"C:\\A",1));
 var pending=new TaskCompletionSource<JsonElement>();var adapter=new ExplorerNativeAdapter("unused","unused",channel,true,invokeOverride:_=>pending.Task);
 adapter.ConfigureProject(channel.State.Project!.Value,Destination());var task=adapter.Run("folder",new{},Guid.NewGuid(),channel.State.Project.Value);
 channel.Apply(new(2,"Project",b,"S:\\B",2));adapter.InvalidateSession();adapter.ConfigureProject(channel.State.Project!.Value,Destination());pending.SetException(new IOException("late failure"));
 Check((await task).Status=="Unknown"&&adapter.Status=="Waiting"&&adapter.Reason==null,"Late process failure belongs to old session");++checks;
}
Console.WriteLine(JsonSerializer.Serialize(new{accepted=true,checks,drivePairs=16,sequence="A-B-A-Home-B-Disconnected",nativeCalls=0}));
