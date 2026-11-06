"""Explicit same-folder relocation. Immutable receipts, one batch, no uncertain replay.

Hashing happens off the GUI thread only for this user-requested operation. Normal
sync/import hot paths are unchanged. Windows read leases cover proof and dispatch.
"""
from contextlib import ExitStack
from copy import deepcopy
import ctypes as C
import json
import hashlib
from pathlib import Path
import time
import uuid
from explorer_canonical_cache_v1 import canonical
from explorer_product_scope_v6 import ProductScope, unique, child
from explorer_project_io_v2 import load_project, snapshot_project, read_documents
from explorer_native_runtime_v3 import Lease
from explorer_native_runtime_v4 import STORE_SAVE_EXPORT
from explorer_sdk_contract_v1 import sdk_contract
from explorer_product_bridge_v5 import check_build, STAGING
from explorer_media_lab import invoke
from live_add import atomic, rows, require_folder, parent_edges
from live_update import StableFile
from load_native_lab import ROOT, digest

DLL=ROOT/'artifacts/NativeExplorerObserveBuild/CapSync.AdaptiveRootRelinkV2.dll'
MANIFEST=ROOT/'artifacts/AdaptiveRootRelinkV2/manifest.json'

class Request(C.Structure):
    _fields_=[('size',C.c_uint32),('version',C.c_uint32),('action',C.c_uint32),
              ('manifest',C.c_wchar*1024),('output',C.c_wchar*1024),('lease',Lease)]

def file_hash(path):
    value=hashlib.sha256()
    with Path(path).open('rb') as source:
        for chunk in iter(lambda:source.read(4*1024*1024),b''):value.update(chunk)
    return value.hexdigest()

def relocated_drafts(drafts, files):
    result=deepcopy(drafts)
    paths={canonical(f['old']):f['new'] for f in files}
    for draft in result.values():
        for group in ('videos','audios'):
            for source in draft.get('materials',{}).get(group,[]):
                path=source.get('path')
                if path and canonical(path) in paths:source['path']=paths[canonical(path)]
    return result

def compare(before,after,files,drafts):
    expected=deepcopy(before);paths={canonical(f['old']):f['new'] for f in files}
    for row in rows(expected):
        path=row.get('file_Path')
        if path and canonical(path) in paths:row['file_Path']=paths[canonical(path)]
    expected['timeline']=drafts[before['timeline']['id']]
    for document in (expected,after):document['meta'].pop('tm_draft_modified',None)
    if expected!=after:raise ValueError('Saved project differs beyond verified source/bin paths')

def blocked(state,binding_id):
    for name in ('AddAttempts','UpdateAttempts','DeleteAttempts','RestoreAttempts','TransferAttempts'):
        for attempt in state.get(name,[]):
            job=attempt['Job'].get('Import',attempt['Job'])
            if binding_id in (job.get('BindingId'),job.get('DestinationBindingId')) and attempt['Status'] not in ('Completed','Abandoned'):
                return True
    return any(f['Job']['BindingId']==binding_id and f['Status']!='Completed' for f in state.get('ManagedFolders',[]))

def carry_physical_links(private,project,binding_id,state,proofs,receipt_id):
    """Explicit root proof carries established SDK UUIDs across a volume change."""
    from explorer_project_observations_v1 import read as read_project, write as write_project
    links=read_project(private,project,'source-links.json',[])
    from explorer_source_history_v3 import carry
    links=carry(private,state,project,links,lambda value:write_project(private,project,'source-links.json',value))
    sources={s['Id']:s for s in state['Sources'] if s['BindingId']==binding_id}
    proven={p['Id']:p for p in proofs};updated=deepcopy(links)
    for link in updated:
        if link.get('ProjectId')!=project or link.get('BindingId')!=binding_id or link.get('SourceId') not in proven:continue
        source=sources[link['SourceId']];proof=proven[link['SourceId']]
        if source.get('MaterialId')!=link.get('MaterialId'):continue
        if link.get('FileIdentity')==proof['Identity']:continue
        if link.get('FileIdentity')!=source.get('FileIdentity'):raise ValueError('Proven source link physical identity changed')
        history=link.get('RootRelocationHistory',[])
        if len(history)>=64:raise ValueError('Source link relocation history is full')
        link['RootRelocationHistory']=[*history,{'ReceiptId':receipt_id,'PreviousIdentity':source['FileIdentity'],'Identity':proof['Identity']}]
        link['FileIdentity']=proof['Identity']
    keys=[(l.get('ProjectId'),l.get('BindingId'),l.get('SourceId'),l.get('MaterialId'),l.get('FileIdentity')) for l in updated]
    if len(keys)!=len(set(keys)):raise ValueError('Root repair would merge source link records')
    if updated!=links:write_project(private,project,'source-links.json',updated)

def execute(data):
    context=ProductScope(data);state=context.state
    binding=unique(context.bindings,lambda b:b['Id']==data['bindingId'],'Relocation binding not owned')
    old=Path(binding['RootPath']).resolve();target=Path(data['newRoot']).resolve()
    roots=data['previousRoots']
    if not isinstance(roots,list) or len(roots)>64 or canonical(old) not in [canonical(p) for p in roots]:raise ValueError('Explicit relocation authorization required')
    if not Path(data['newRoot']).is_absolute() or canonical(target)!=canonical(data['newRoot']) or target==old or target.is_relative_to(old) or old.is_relative_to(target):raise ValueError('Relocation roots overlap or are not canonical')
    if target.is_relative_to(context.private) or context.private.is_relative_to(target):raise ValueError('Relocation overlaps private state')
    if any(b['Id']!=binding['Id'] and (target.is_relative_to(Path(b['RootPath']).resolve()) or Path(b['RootPath']).resolve().is_relative_to(target)) and b['Status']!='Suspended' for b in context.bindings):raise ValueError('Relocation overlaps another active binding')
    receipt_id=str(uuid.uuid5(uuid.UUID(binding['Id']),canonical(old)+'\0'+canonical(target)))
    run=context.private/'root-relocations'/receipt_id;marker=run/'journal.json'
    reply=lambda status,reason=None,**extra:{'Status':status,'ReceiptId':receipt_id,'Sources':[], 'Reason':reason,'NativeCommands':0,**extra}
    if not target.is_dir():return reply('Waiting','The relocated folder is unavailable.')
    if blocked(state,binding['Id']):return reply('Waiting','Finish the previous operation before relocating this folder.')
    if marker.exists():
        record=json.loads(marker.read_bytes())
        if record['bindingId']!=binding['Id'] or canonical(record['oldRoot'])!=canonical(old) or canonical(record['newRoot'])!=canonical(target):raise ValueError('Immutable relocation request changed')
        if record['stage'] not in ('Prepared','VerifyingSave','Verified'):
            return reply('Unknown','Root relocation completion is unknown; automatic replay is disabled.')
    else:
        run.mkdir(parents=True,exist_ok=False)
        record={'bindingId':binding['Id'],'projectKey':context.project_key,'oldRoot':str(old),'newRoot':str(target),'stage':'Prepared'}
        atomic(marker,record)
    check_build(data['editor']['ProcessId'])
    manifest={'binaries':{'Root':digest(DLL)}}
    if not MANIFEST.exists():MANIFEST.parent.mkdir(parents=True,exist_ok=True);atomic(MANIFEST,manifest)
    if json.loads(MANIFEST.read_bytes())!=manifest:raise ValueError('Sealed relocation module changed')
    editor=data['editor'];key=editor['Project']
    lease=Lease(processId=editor['ProcessId'],viewEpoch=editor['ViewEpoch'],location=key['Location'].replace('\\','/'),draftId=key['DraftId'].encode(),token=data['token'].encode())
    def call(action,plan_path,name):
        return invoke(editor['ProcessId'],'Root','CapSync_ProductRootRelink',Request(action=action,manifest=str(plan_path),lease=lease),
                      run/'evidence'/name,manifest_path=MANIFEST,binaries={'Root':DLL},staging_root=STAGING,completion_timeout=120)
    dispatched=0
    with ExitStack() as locks:
        if record['stage']=='Prepared':
            before=load_project(context.directory);files=[];proofs=[];source_paths={}
            for source in state['Sources']:
                if source['BindingId']!=binding['Id']:continue
                relative=source.get('AppliedPath') or source['RelativePath']
                if relative!=source['RelativePath'] or source.get('AppliedHash') not in (None,source['Hash']):
                    return reply('Waiting','Finish pending file changes before relocating this folder.')
                new=child(target,target/relative);previous=child(old,old/relative)
                if canonical(new)!=canonical(target/relative) or canonical(previous)!=canonical(old/relative):raise ValueError('Linked source path is not supported')
                # No name/hash-based identity inference: this mapping is explicitly authorized.
                if not new.is_file():return reply('Waiting','A previously synchronized file is absent from the relocated folder.')
                handle=StableFile(new);locks.callback(handle.close)
                identity=handle.identity();size=new.stat().st_size
                if size!=source['Size'] or file_hash(new).upper()!=source['Hash'].upper():
                    return reply('Conflict','The relocated folder contains different files. Use a separate connection for another folder.')
                proofs.append({'Id':source['Id'],'Identity':identity,'LastWriteTicks':new.stat().st_mtime_ns//100+621355968000000000})
                if canonical(previous) in source_paths:raise ValueError('Ambiguous logical source path')
                source_paths[canonical(previous)]=source
                aliases=[r['id'] for r in rows(before) if r.get('file_Path') and canonical(r['file_Path'])==canonical(previous)]
                if source.get('MaterialId') and not source.get('MaterialRemoved') and source['MaterialId'] not in aliases:raise ValueError('Owned material is absent from its original path')
                if aliases:files.append({'old':previous.as_posix(),'new':new.as_posix(),'materialIds':aliases,'identity':identity,'bytes':size,'byteHash':source['Hash']})
            if len(proofs)>16384:raise ValueError('Relocation source bounds exceeded')
            # Foreign aliases with an identical path are handled as one exact native path set.
            # The native callback independently checks the complete set, never by display name.
            exports,_=sdk_contract(media=True)
            plan={'draftId':key['DraftId'],'oldRoot':old.as_posix(),'newRoot':target.as_posix(),'files':files,'exports':exports,'storeSaveExport':__import__('adaptive_context').export(STORE_SAVE_EXPORT['name'])}
            plan_path=run/'plan.json';atomic(plan_path,plan)
            if files:
                preflight_name='preflight-'+uuid.uuid4().hex+'.json'
                preflight=call(0,plan_path,preflight_name)
                if preflight.get('status')!='ready' or preflight.get('mutationDispatched') is not False:
                    return reply('Waiting','CapCut is not ready to restore these source paths. No files were changed.')
                drafts=json.loads((run/'evidence'/(preflight_name+'.drafts-before.json')).read_bytes());plan['drafts']=drafts;atomic(plan_path,plan)
            else:drafts={before['timeline']['id']:before['timeline']};plan['drafts']=drafts;atomic(plan_path,plan)
            expected=relocated_drafts(drafts,files)
            atomic(run/'expected-drafts.json',expected);atomic(run/'sources.json',proofs)
            snapshot_project(context.directory,run/('before-'+uuid.uuid4().hex))
            atomic(run/'before-model.json',before)
            record['stage']='Dispatching';atomic(marker,record)
            if files:
                result=call(1,plan_path,'apply.json')
                dispatched=int(result.get('mutationDispatched') is True)
                if result.get('status')!='submitted' or not all(result.get(k) is True for k in ('mutationDispatched','focusUnchanged','foregroundUnchanged','navigationUnchanged')):
                    return reply('Unknown','Root relocation completion is unknown; automatic replay is disabled.',NativeCommands=int(result.get('mutationDispatched') is True))
            record['stage']='VerifyingSave';atomic(marker,record)
        else:
            plan=json.loads((run/'plan.json').read_bytes());proofs=json.loads((run/'sources.json').read_bytes())
            for item in plan['files']:
                handle=StableFile(Path(item['new']));locks.callback(handle.close)
                if handle.identity()!=item['identity'] or file_hash(Path(item['new'])).upper()!=item['byteHash'].upper():return reply('Conflict','Relocated source changed during verification.')
        before=json.loads((run/'before-model.json').read_bytes());expected=json.loads((run/'expected-drafts.json').read_bytes())
        after_plan=run/'after-plan.json';atomic(after_plan,{'drafts':expected})
        # Read-only recovery is permitted. A dispatched mutation is never submitted again.
        for name,delay in (('immediate',1),('saved',30)):
            time.sleep(delay)
            if plan['files']:
                result=call(2,after_plan,name+'-'+uuid.uuid4().hex+'.json')
                if result.get('status')!='read' or result.get('mutationDispatched') is not False:return reply('Unknown','CapCut has not confirmed the restored source paths yet.')
            current=load_project(context.directory)
            compare(deepcopy(before),current,plan['files'],expected)
            # The active saved template must also reflect the exact SDK source paths.
            template=read_documents(context.directory).get('template-2.tmp')
            from explorer_draft_compare_v1 import same_draft
            if template is not None and not same_draft(json.loads(template),expected[before['timeline']['id']],context.directory):return reply('Unknown','Waiting for CapCut to save the restored paths.')
            atomic(run/(name+'-comparison.json'),{'accepted':True,'allSdkTimelines':len(expected),'nativeMutations':int(bool(plan['files']))})
        carry_physical_links(context.private,context.project_key,binding['Id'],state,proofs,receipt_id)
        result=reply('Verified',Sources=proofs,NativeCommands=dispatched)
        atomic(run/'acceptance.json',{'accepted':True,'bindingId':binding['Id'],'projectKey':context.project_key,'oldRoot':str(old),'newRoot':str(target),'reply':result})
        record['stage']='Verified';atomic(marker,record);return result

def historical_root(binding,root):
    return canonical(root)==canonical(binding['RootPath']) or any(canonical(move['FromRoot'])==canonical(root) for move in binding.get('RootMoves',[]))

def relocated_folder(data,context):
    """Prove existing root-folder continuity without rewriting its original receipt."""
    if data.get('kind')!='folder':return None
    job=data['job'];marker=context.private/'native-journal'/str(uuid.UUID(job['Id']))/'journal.json'
    if not marker.exists():return None
    original=json.loads(marker.read_bytes())
    if original.get('kind')!='folder' or original.get('stage')!='Verified':return None
    old=original['job']
    if canonical(old['RootPath'])==canonical(job['RootPath']):return None
    excluded=('RootPath','SourceDirectory')
    if {k:v for k,v in old.items() if k not in excluded}!={k:v for k,v in job.items() if k not in excluded}:return None
    binding=unique(context.bindings,lambda b:b['MediaFolderId']==job['FolderId'] and canonical(b['RootPath'])==canonical(job['RootPath']),'Root folder is not owned')
    if not historical_root(binding,old['RootPath']):return None
    for move in binding['RootMoves']:
        accepted=json.loads((context.private/'root-relocations'/str(uuid.UUID(move['ReceiptId']))/'acceptance.json').read_bytes())
        if accepted.get('accepted') is not True or accepted['bindingId']!=binding['Id'] or accepted['projectKey']!=context.project_key or canonical(accepted['oldRoot'])!=canonical(move['FromRoot']) or canonical(accepted['newRoot'])!=canonical(move['ToRoot']):raise ValueError('Root relocation receipt differs')
    current=load_project(context.directory);folder=require_folder(current,job['FolderId'])
    if folder.get('display_name')!=job['Name'] or parent_edges(current,job['FolderId'])!=[{'child_id':job['FolderId'],'parent_id':job['ParentFolderId']}]:raise ValueError('Relocated root folder changed independently')
    return {'JobId':job['Id'],'Status':'Verified','MaterialId':job['FolderId'],'NativeCommands':0}
