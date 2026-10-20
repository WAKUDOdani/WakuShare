"""Private read-only SDK/catalog agreement and stock source presence tracking."""
import ctypes as C
import json
import os
from contextlib import ExitStack
from pathlib import Path
import sys
import uuid
from explorer_media_lab import invoke
from explorer_native_compat import require_vendor_imports
from explorer_native_runtime_v2 import Lease
from live_add import atomic,rows
from explorer_canonical_cache_v1 import canonical
from live_update import StableFile
from load_native_lab import ROOT,LAB_ID,digest,lab_directory,snapshot
from explorer_project_io_v2 import load_project as load

DLL=ROOT/'artifacts/NativeExplorerObserveBuild/CapSync.ExplorerCatalogReadV11.dll'
MANIFEST=ROOT/'artifacts/ExplorerCatalogReadV11/manifest.json'
class Request(C.Structure):_fields_=[('size',C.c_uint32),('version',C.c_uint32),('output',C.c_wchar*1024),('lease',Lease)]

def prepare():
    require_vendor_imports(DLL)
    value={'build':'9.6.0.4097','labOnly':True,'binaries':{'Catalog':digest(DLL)}}
    if MANIFEST.exists() and json.loads(MANIFEST.read_text(encoding='utf8'))!=value:raise ValueError('Sealed catalog reader changed')
    MANIFEST.parent.mkdir(parents=True,exist_ok=True)
    if not MANIFEST.exists():atomic(MANIFEST,value)

def read(data,context=None):
    if context is None and os.environ.get('WAKUSHARE_LAB_SOURCE_LINKS')!='1':return read_locked(data,None)
    from explorer_file_stamp_batch_v1 import LockedPaths
    state=context.state if context else json.loads(Path(data['statePath']).read_text(encoding='utf8'));project=data['editor'].get('Project')
    if not project:raise ValueError('Confirmed session required before locking source observations')
    bindings={b['Id']:b for b in state['Bindings'] if b['ProjectId']==project['Value'] and b['Status']=='Ready'}
    owners=[s for s in state['Sources'] if s['BindingId'] in bindings and s.get('MaterialId') and not s.get('MaterialRemoved') and s.get('AppliedPath') and s.get('FileIdentity') and s['Presence']=='Present' and s['RelativePath']==s['AppliedPath']]
    if len(owners)>16384:raise ValueError('Laboratory source observation bound exceeded')
    with LockedPaths() as locks:
        stamps={}
        for source in owners:
            try:
                _,physical=locks.lock(Path(bindings[source['BindingId']]['RootPath'])/source['AppliedPath'])
                if physical['file']['fileIdentity']==source['FileIdentity']:stamps[source['Id']]=physical
            except (OSError,ValueError):continue # No fallback source inference.
        return read_locked(data,stamps,context)


def read_locked(data,stamps,context=None):
    project_directory=context.directory if context else lab_directory()
    if context:
        from explorer_media_view_v1 import refresh
        refresh(data,context)
    manifest_path=MANIFEST
    if context:
        from explorer_product_bridge_v5 import OBSERVER_MANIFEST
        manifest_path=OBSERVER_MANIFEST
    editor=data['editor'];key=editor.get('Project');private=Path(data['statePath']).resolve().parent
    if context is None and (editor.get('Status')!='Project' or not key or key['DraftId']!=LAB_ID.upper() or canonical(key['Location'])!=canonical(project_directory)):raise ValueError('Confirmed laboratory session required')
    state=context.state if context else json.loads(Path(data['statePath']).read_text(encoding='utf8'))
    if any(private.is_relative_to(Path(b['RootPath']).resolve()) for b in state['Bindings']):raise ValueError('Keep private reads outside sources')
    # A cache is valid only for these exact bytes and the same process/token/view.
    # The SDK/metadata preflight in every mutation remains mandatory.
    from explorer_project_io_v2 import settling_read
    from explorer_project_io_v2 import document_hashes
    hashes=lambda:document_hashes(project_directory)
    before=hashes();owner={'projectKey':key['Value'],'pid':editor['ProcessId'],'epoch':editor['ViewEpoch'],'token':data['token'],'binaries':json.loads(manifest_path.read_text(encoding='utf8'))['binaries']}
    cache=private/'catalog-observation.json'
    if stamps is None and cache.exists():
        known=json.loads(cache.read_text(encoding='utf8'))
        if known.get('owner')==owner and known.get('hashes')==before:
            from explorer_bin_labels_v5 import observe
            observe(private,state,key['Value'],known['result']['Materials'],known['result'].get('LiveSourceNames',[]))
            return known['result']
    case=private/'catalog-reads'/uuid.uuid4().hex;case.mkdir(parents=True)
    from explorer_project_io_v2 import snapshot_project
    snapshot_project(project_directory,case/'before')
    lease=Lease(processId=editor['ProcessId'],viewEpoch=editor['ViewEpoch'],location=key['Location'].replace('\\','/'),draftId=key['DraftId'].encode('ascii'),token=data['token'].encode('ascii'))
    if context:
        from explorer_product_bridge_v5 import invoke_observer
        receipt=invoke_observer(editor['ProcessId'],'Catalog','CapSync_CatalogReadThread',Request(lease=lease),case/'evidence/catalog.json')
    else:
        receipt=invoke(editor['ProcessId'],'Catalog','CapSync_CatalogReadThread',Request(lease=lease),case/'evidence/catalog.json',manifest_path=MANIFEST,binaries={'Catalog':DLL})

    after=hashes();snapshot_project(project_directory,case/'after')
    if before!=after or receipt.get('status')!='read' or receipt.get('wholeSdkBinExact') is not True or receipt.get('wholeSdkDraftUnchanged') is not True or receipt.get('projectMutation') is not False or receipt.get('draftId')!=key['DraftId'] or canonical(receipt.get('location',''))!=canonical(key['Location']):
        atomic(case/'comparison.json',{'accepted':False,'projectDocumentsUnchanged':before==after});return {'Verified':False,'Reason':'Catalog is changing or SDK differs; wait for the next editor event'}
    catalog=load(case/'before');materials=rows(catalog)
    if receipt['materials']!=materials:raise ValueError('Native catalog differs from the complete snapshot')
    result={'Verified':True,'ProjectKey':key['Value'],'DraftId':key['DraftId'],'MaterialIds':[row['id'] for row in materials], 'Materials':materials,'LiveSourceNames':receipt['liveSourceNames'],'NativeCommands':0}
    if stamps is not None:
        sidecar=case/'evidence/catalog.json.draft.json'
        if canonical(receipt.get('liveDraftSidecar',''))!=canonical(sidecar) or sidecar.stat().st_size>64*1024*1024:raise ValueError('Complete live SDK sidecar required for source observations')
        draft=json.loads(sidecar.read_bytes())
        ids=[row['id'] for group in ('videos','audios') for row in draft['materials'].get(group,[])]
        from explorer_source_observations_v5 import observe as observe_sources
        learned=observe_sources(private,state,key['Value'],materials,result['LiveSourceNames'],ids,stamps,str(case/'evidence/catalog.json'))
        atomic(case/'source-ownership-observation.json',learned)
    atomic(case/'comparison.json',{'accepted':True,'projectDocumentsUnchanged':True,'projectWrites':0})
    from explorer_bin_labels_v5 import observe
    observe(private,state,key['Value'],materials,result['LiveSourceNames'])
    atomic(cache,{'owner':owner,'hashes':before,'result':result});return result

def presence(data,context=None):
    project_directory=context.directory if context else lab_directory()
    job=data['job'];reply=lambda status,reason=None:{'JobId':job['Id'],'Status':status,'MaterialId':job['MaterialId'] if status=='Verified' else None,'Reason':reason,'NativeCommands':0}
    if job['Flags'] not in ('Missing','Restore') or job['ProjectId']!=data['editor']['Project']['Value']:return reply('Conflict','Presence job differs from the current project')
    root=Path(job['RootPath']).resolve();source=Path(job['SourcePath']).resolve()
    if not root.is_dir() or (context is None and not root.is_relative_to((ROOT/'research/fixtures/AutoAddLab').resolve())) or not source.is_relative_to(root):return reply('Waiting','Source root is unavailable or outside laboratory')
    if canonical(root/job['PreviousPath'])!=canonical(source) or canonical(root/job['RelativePath'])!=canonical(source):return reply('Conflict','Presence cannot relocate a source')
    observed=read(data,context)
    if not observed['Verified']:return reply('Waiting',observed.get('Reason'))
    owned=[r for r in observed['Materials'] if r['id']==job['MaterialId']]
    if len(owned)!=1 or canonical(owned[0].get('file_Path',''))!=canonical(source):return reply('Conflict','Owned card is absent or manually relinked')
    if job['Flags']=='Missing':
        if source.exists():return reply('Waiting','Source returned before missing observation')
        catalog=load(project_directory);ids={item['id'] for group in ('videos','audios') for item in catalog['timeline']['materials'].get(group,[]) if item.get('path') and canonical(item['path'])==canonical(source)}
        if not any(segment.get('material_id') in ids for track in catalog['timeline']['tracks'] for segment in track['segments']):return reply('Unused','Unused card removal needs its separate stock adapter')
    else:
        if not source.is_file():return reply('Waiting','Source has not returned')
        stable=StableFile(source)
        try:
            if source.stat().st_size!=job['Size'] or digest(source).casefold()!=job['Hash'].casefold() or stable.identity()!=data.get('fileIdentity'):return reply('Waiting','Returned physical identity or bytes differ')
        finally:stable.close()
    return reply('Verified','Stock presence observed; no editor mutation')

def main():
    data=json.loads(sys.stdin.read(65537));prepare()
    if data['action']=='catalog':result=read(data)
    elif data['action']=='presence':result=presence(data)
    elif data['action']=='delete':
        from explorer_remove_runtime_v2 import execute
        result=execute(data,Path(data['statePath']).resolve().parent/'native-removals'/str(uuid.UUID(data['job']['Id'])))
    else:raise ValueError('Unknown catalog action')
    # Complete rows stay in private evidence. The worker needs only owned UUIDs.
    result.pop('Materials',None);result.pop('LiveSourceNames',None);print(json.dumps(result,ensure_ascii=True))
if __name__=='__main__':main()
