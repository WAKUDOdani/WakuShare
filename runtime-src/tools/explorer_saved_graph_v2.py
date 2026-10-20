"""Read-only SDK/bin/tree/Draft agreement under the current product lease."""
import ctypes as C
import json
from explorer_native_runtime_v3 import Lease
from explorer_project_io_v2 import document_hashes,load_project
from explorer_product_bridge_v4 import check_build,STAGING
from explorer_media_lab import invoke
from live_add import atomic,canonical
from load_native_lab import ROOT,digest

class Request(C.Structure):
    _fields_=[('size',C.c_uint32),('version',C.c_uint32),('output',C.c_wchar*1024),('lease',Lease)]

def read(data,context,case):
    dll=ROOT/'artifacts/NativeExplorerObserveBuild/CapSync.ExplorerProductSavedReadV2.dll'
    manifest=ROOT/'artifacts/ExplorerSavedReadV2/manifest.json'
    value={'binaries':{'Read':digest(dll)}}
    manifest.parent.mkdir(exist_ok=True)
    if manifest.exists():
        if json.loads(manifest.read_bytes())!=value:raise ValueError('Sealed read-only module changed')
    else:atomic(manifest,value)
    editor=data['editor'];key=editor['Project'];pid=editor['ProcessId'];check_build(pid)
    lease=Lease(processId=pid,viewEpoch=editor['ViewEpoch'],location=key['Location'].replace('\\','/'),draftId=key['DraftId'].encode(),token=data['token'].encode())
    before=document_hashes(context.directory)
    result=invoke(pid,'Read','CapSync_ProductSavedRead',Request(lease=lease),case/'evidence/sdk.json',manifest_path=manifest,binaries={'Read':dll},staging_root=STAGING)
    if before!=document_hashes(context.directory) or result.get('status')!='read' or result.get('projectMutation') is not False:raise ValueError('Read-only graph not stable')
    if result.get('draftId')!=key['DraftId'] or canonical(result.get('location',''))!=canonical(context.directory):raise ValueError('Read-only project identity changed')
    if not all(result.get(k) is True for k in ('completeSdkBinEqualsSaved','wholeSdkDraftEqualsSaved','wholeSdkDraftUnchanged','focusUnchanged','foregroundUnchanged')):raise ValueError('Complete SDK graph differs from saved documents')
    current=load_project(context.directory)
    edges=[r for g in current['store']['draft_virtual_store'] if g['type']==1 for r in g['value']]
    order=lambda r:json.dumps(r,sort_keys=True)
    if sorted(edges,key=order)!=sorted(result['nativeEdges'],key=order):raise ValueError('Complete native tree edges differ')
    if json.loads((case/'evidence/sdk.json.draft.json').read_bytes())!=current['timeline']:raise ValueError('Complete SDK Draft sidecar differs')
    return result
