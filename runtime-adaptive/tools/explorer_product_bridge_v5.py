"""Product-native generation: independent immutable modules and SDK checks."""
from pathlib import Path
import ctypes as C
import json
from explorer_media_lab import invoke as dispatch
from explorer_native_compat import require_vendor_imports
from explorer_native_runtime_v3 import EventsRequest as BaseEventsRequest,SessionRelay
from adaptive_context import bind, current
from adaptive_symbols import PROFILE
from explorer_native_runtime_v3 import BinWithTitles
from live_add import atomic
from load_native_lab import ROOT,digest,modules

BUILD=ROOT/'artifacts/NativeExplorerObserveBuild'
OBSERVER_BINARIES={key:BUILD/f'CapSync.Adaptive{name}V2.dll' for key,name in [('Events','Events'),('SessionRelay','Relay'),('Catalog','Catalog'),('Documents','Documents')]}
OBSERVER_BINARIES['Events']=BUILD/'CapSync.AdaptiveEventsV4.dll'
OBSERVER_BINARIES['Catalog']=BUILD/'CapSync.AdaptiveCatalogV5.dll'
OBSERVER_BINARIES['Preflight']=BUILD/'CapSync.AdaptivePreflightV3.dll'
OBSERVER_MANIFEST=ROOT/'artifacts/AdaptiveObserveV10/manifest.json'
STAGING=ROOT/'artifacts/AdaptiveModulesV2'
COMMAND_BINARIES={key:BUILD/f'CapSync.Adaptive{name}V2.dll' for key,name in [('Import','Import'),('Folder','Folder'),('Tree','Tree'),('BinMedia','Bin'),('Source','Source'),('Save','Save'),('Remove','Remove'),('View','View'),('PromoteRoot','PromoteRoot'),('BatchImport','BatchImport'),('BatchMove','BatchMove'),('FolderBatch','FolderBatch')]}
for key in ('Source','Save','Remove'):COMMAND_BINARIES[key]=BUILD/f'CapSync.Adaptive{key}V3.dll'
COMMAND_BINARIES['Source']=BUILD/'CapSync.AdaptiveSourceV4.dll'
COMMAND_MANIFEST=ROOT/'artifacts/AdaptiveCommandsV10/manifest.json'
ALIASES={'Import':'Import','Folder':'Folder','TreeMove':'Tree','TreeLinked':'Tree','BinPath':'BinMedia','BinAliases':'BinMedia','SourceWindows':'Source','StoreSave':'Save','Remove':'Remove','ViewRebuild':'View','PromoteRoot':'PromoteRoot','BatchImport':'BatchImport','BatchMove':'BatchMove','FolderBatch':'FolderBatch'}

class ProductBin(C.Structure):
    _fields_=BinWithTitles._fields_+[('previousRoot',C.c_wchar*1024)]

def prepare_commands():
    prepare_observer()
    value={'runtime':'adaptive-v1','productRuntime':True,'observer':json.loads(OBSERVER_MANIFEST.read_text(encoding='utf8'))['binaries'],'binaries':{key:digest(path) for key,path in COMMAND_BINARIES.items()}}
    if COMMAND_MANIFEST.exists() and json.loads(COMMAND_MANIFEST.read_text(encoding='utf8'))!=value:raise ValueError('Immutable product commands changed')
    COMMAND_MANIFEST.parent.mkdir(parents=True,exist_ok=True)
    if not COMMAND_MANIFEST.exists():atomic(COMMAND_MANIFEST,value)
    return value

def invoke_command(pid,adapter,export,request,output):
    check_build(pid, {'Import':'add','BatchImport':'add','Folder':'folders','FolderBatch':'folders','TreeMove':'move','TreeLinked':'move','BatchMove':'move','BinPath':'rename','BinAliases':'rename','SourceWindows':'rename','StoreSave':'rename','Remove':'remove','PromoteRoot':'folders'}.get(adapter,'read'))
    prepare_commands()
    return dispatch(pid,ALIASES[adapter],export,request,output,manifest_path=COMMAND_MANIFEST,binaries=COMMAND_BINARIES,staging_root=STAGING,completion_timeout=120 if adapter in ('BatchImport','BatchMove','FolderBatch') else 15)

def prepare_observer():
    manifest={'runtime':'adaptive-v1','productRuntime':True,'binaries':{key:digest(path) for key,path in OBSERVER_BINARIES.items()}}
    if OBSERVER_MANIFEST.exists() and json.loads(OBSERVER_MANIFEST.read_text(encoding='utf8'))!=manifest:raise ValueError('Immutable product observer changed')
    if not OBSERVER_MANIFEST.exists():
        OBSERVER_MANIFEST.parent.mkdir(parents=True,exist_ok=True);atomic(OBSERVER_MANIFEST,manifest)
    return manifest

def check_build(pid, operation='read'):
    context=bind(pid,operation)
    return context['report']

class SymbolSeed(C.Structure):
    _fields_=[('rvas',C.c_uint64*20),('proofs',C.c_uint64*60)]
class EventsRequest(C.Structure):
    _fields_=BaseEventsRequest._fields_+[('symbols',SymbolSeed)]
def seed(report):
    value=SymbolSeed()
    profile=json.loads(PROFILE.read_bytes())
    for index,symbol in enumerate(profile['symbols']):
        key=symbol['key'];value.rvas[index]=report['symbols'].get(key,0)
        for i,proof in enumerate(report['proofs'].get(key,[])[:3]):value.proofs[index*3+i]=proof
    return value

def invoke_observer(pid,key,export,request,output):
    check_build(pid,'connect' if key in ('Events','SessionRelay') else 'read')
    prepare_observer()
    return dispatch(pid,key,export,request,output,manifest_path=OBSERVER_MANIFEST,binaries=OBSERVER_BINARIES,staging_root=STAGING)

def bootstrap(data):
    bridge=data['bridge'];pid=bridge['ProcessId'];report=check_build(pid,'connect')
    output=Path(data['evidence'])/'evidence/bridge-status.json'
    result=invoke_observer(pid,'Events','CapSync_ExplorerEventsThread',EventsRequest(expectedLocation='',pipe=bridge['PipeName'],token=bridge['Token'].encode('ascii'),symbols=seed(report)),output)
    if result['status'] not in ('connecting','connected'):raise ValueError(result.get('reason') or 'AUTOSYNC|connect|bootstrap_failed|'+result['status'])
    result=invoke_observer(pid,'SessionRelay','CapSync_SessionRelayThread',SessionRelay(),output.with_name('session-relay.json'))
    if result.get('status')!='attached':raise ValueError('Product session relay unavailable')
    return {'attached':True,'productRuntime':True,'capabilities':report['capabilities'],'build':report['build']}

def preflight(data,operation):
    import uuid
    from explorer_native_runtime_v3 import Lease
    from adaptive_symbols import CapabilityError
    editor=data['editor'];key=editor['Project']
    lease=Lease(processId=editor['ProcessId'],viewEpoch=editor['ViewEpoch'],location=key['Location'].replace('\\','/'),draftId=key['DraftId'].encode(),token=data['token'].encode())
    class Request(C.Structure):
        _fields_=[('size',C.c_uint32),('version',C.c_uint32),('output',C.c_wchar*1024),('lease',Lease)]
    output=Path(data['statePath']).resolve().parent/'native-preflight'/uuid.uuid4().hex/'evidence/preflight.json'
    receipt=invoke_observer(editor['ProcessId'],'Preflight','CapSync_AdaptivePreflightThread',Request(lease=lease),output)
    if receipt.get('status')!='stable' or receipt.get('projectMutation') is not False:
        reason=receipt.get('reason') or receipt.get('status','unknown')
        code='project_settling' if reason in ('live timeline changed during catalog read','live Draft changed during catalog read','runtime session lease revoked') else 'preflight_failed'
        raise CapabilityError(operation,[reason],code)
