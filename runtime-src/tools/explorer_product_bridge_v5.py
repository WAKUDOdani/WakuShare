"""Product-native generation: independent immutable modules and SDK checks."""
from pathlib import Path
import ctypes as C
import json
from explorer_media_lab import invoke as dispatch
from explorer_native_compat import require_vendor_imports
from explorer_native_runtime_v3 import EventsRequest,SessionRelay
from explorer_native_runtime_v3 import BinWithTitles
from live_add import atomic
from load_native_lab import ROOT,digest,modules

BUILD=ROOT/'artifacts/NativeExplorerObserveBuild'
OBSERVER_BINARIES={key:BUILD/f'CapSync.ExplorerProduct{name}V5.dll' for key,name in [('Events','Events'),('SessionRelay','Relay'),('Catalog','Catalog')]}
OBSERVER_BINARIES['Catalog']=BUILD/'CapSync.ExplorerProductCatalogV6.dll'
OBSERVER_MANIFEST=ROOT/'artifacts/ExplorerProductObserveV6/manifest.json'
STAGING=ROOT/'artifacts/ExplorerProductModules'
COMMAND_BINARIES={key:BUILD/f'CapSync.ExplorerProduct{name}V3.dll' for key,name in [('Import','Import'),('Folder','Folder'),('Tree','Tree'),('BinMedia','Bin'),('Source','Source'),('Save','Save'),('Remove','Remove')]}
COMMAND_BINARIES['View']=BUILD/'CapSync.ExplorerProductMediaViewV1.dll'
COMMAND_BINARIES['PromoteRoot']=BUILD/'CapSync.ExplorerProductPromoteRootV1.dll'
COMMAND_BINARIES['BatchImport']=BUILD/'CapSync.ExplorerProductWholeImportV1.dll'
COMMAND_BINARIES['BatchMove']=BUILD/'CapSync.ExplorerProductWholeMoveV1.dll'
COMMAND_BINARIES['FolderBatch']=BUILD/'CapSync.ExplorerProductFolderBatchV2.dll'
COMMAND_MANIFEST=ROOT/'artifacts/ExplorerProductCommandsV10/manifest.json'
ALIASES={'Import':'Import','Folder':'Folder','TreeMove':'Tree','TreeLinked':'Tree','BinPath':'BinMedia','BinAliases':'BinMedia','SourceWindows':'Source','StoreSave':'Save','Remove':'Remove','ViewRebuild':'View','PromoteRoot':'PromoteRoot','BatchImport':'BatchImport','BatchMove':'BatchMove','FolderBatch':'FolderBatch'}

class ProductBin(C.Structure):
    _fields_=BinWithTitles._fields_+[('previousRoot',C.c_wchar*1024)]

def prepare_commands():
    prepare_observer()
    for path in COMMAND_BINARIES.values():require_vendor_imports(path)
    value={'build':'9.6.0.4097','productRuntime':True,'observer':json.loads(OBSERVER_MANIFEST.read_text(encoding='utf8'))['binaries'],'binaries':{key:digest(path) for key,path in COMMAND_BINARIES.items()}}
    if COMMAND_MANIFEST.exists() and json.loads(COMMAND_MANIFEST.read_text(encoding='utf8'))!=value:raise ValueError('Immutable product commands changed')
    COMMAND_MANIFEST.parent.mkdir(parents=True,exist_ok=True)
    if not COMMAND_MANIFEST.exists():atomic(COMMAND_MANIFEST,value)
    return value

def invoke_command(pid,adapter,export,request,output):
    prepare_commands();check_build(pid)
    return dispatch(pid,ALIASES[adapter],export,request,output,manifest_path=COMMAND_MANIFEST,binaries=COMMAND_BINARIES,staging_root=STAGING,completion_timeout=120 if adapter in ('BatchImport','BatchMove','FolderBatch') else 15)

def prepare_observer():
    for path in OBSERVER_BINARIES.values():require_vendor_imports(path)
    manifest={'build':'9.6.0.4097','productRuntime':True,'binaries':{key:digest(path) for key,path in OBSERVER_BINARIES.items()}}
    if OBSERVER_MANIFEST.exists() and json.loads(OBSERVER_MANIFEST.read_text(encoding='utf8'))!=manifest:raise ValueError('Immutable product observer changed')
    if not OBSERVER_MANIFEST.exists():
        OBSERVER_MANIFEST.parent.mkdir(parents=True,exist_ok=True);atomic(OBSERVER_MANIFEST,manifest)
    return manifest

def check_build(pid):
    loaded=modules(pid)
    expected={'vecreator.dll':'5bac0b46e9e045de20d278e98e652a5a55637b3d903b416f18d9f5e0b25f38f9','videoeditor.dll':'47e341ce930074bd7d11ef418ea5c893fc6330aa73b2f2203c5098f302d63e9f'}
    for name,sha in expected.items():
        found=[m for m in loaded if m['name'].casefold()==name]
        if len(found)!=1 or Path(found[0]['path']).parent.name!='9.6.0.4097' or digest(found[0]['path'])!=sha:raise ValueError('Unaccepted CapCut build; synchronization suspended')

def invoke_observer(pid,key,export,request,output):
    prepare_observer()
    return dispatch(pid,key,export,request,output,manifest_path=OBSERVER_MANIFEST,binaries=OBSERVER_BINARIES,staging_root=STAGING)

def bootstrap(data):
    bridge=data['bridge'];pid=bridge['ProcessId'];check_build(pid)
    output=Path(data['evidence'])/'evidence/bridge-status.json'
    result=invoke_observer(pid,'Events','CapSync_ExplorerEventsThread',EventsRequest(expectedLocation='',pipe=bridge['PipeName'],token=bridge['Token'].encode('ascii')),output)
    if result['status'] not in ('connecting','connected'):raise ValueError('Product observer scope unavailable')
    result=invoke_observer(pid,'SessionRelay','CapSync_SessionRelayThread',SessionRelay(),output.with_name('session-relay.json'))
    if result.get('status')!='attached':raise ValueError('Product session relay unavailable')
    return {'attached':True,'productRuntime':True}
