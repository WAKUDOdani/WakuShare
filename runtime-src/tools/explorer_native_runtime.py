"""Private development adapter. No CLI navigation, input, polling loop or command replay.

Only the already authorized lab and fixture tree are enabled in this build.
Native callbacks recheck the live observer token/view epoch on the editor thread.
"""
from __future__ import annotations
import ctypes as C
from copy import deepcopy
import json
import os
from pathlib import Path
import shutil
import struct
import sys
import time
import uuid
from load_native_lab import ROOT, LAB_ID, Loader, digest, lab_directory, modules, snapshot, validate
from live_add import atomic, canonical, rows, parent_edges, preservation, require_folder
from live_update import StableFile
from live_folder import Request as FolderBase, preservation as folder_preservation
from live_add import Request as MoveBase
from live_relink_lab import Request as BinBase
from live_source_path import Request as SourceBase, acceptance, SCOPES, PNG_MATERIAL
from check_explorer_native_events import Request as EventsRequest
from explorer_target_drop_lab import Request as DropBase
from photo_path_plan import plan as photo_plan, UnsupportedPhotoPlan
from live_photo_path import compare as photo_compare
from qt_meta_inventory import PE
from verify_native_import import load

BUILD = ROOT / 'artifacts/NativeExplorerObserveBuild'
MANIFEST = ROOT / 'artifacts/ExplorerRuntime/manifest.json'
NATIVE_ROOT = ROOT / 'research/fixtures/AutoAddLab'
STORE_SAVE_EXPORT={'rva':'0x135b110','name':'?saveDraft@StoreWrapper@draft_store@@QEAAXAEBV?$shared_ptr@VDraft@lvve@@@std@@_NV?$function@$$A6AXAEBVWriteDraftJsonResult@draft_store@@@Z@4@@Z'}
USED_PHOTO_PROOF=ROOT/'artifacts/ExplorerRuntime/used-photo-proof.json'

def accepted_used_photo(job,plan):
    """Only a human-accepted fixture and its exact runtime generation may run."""
    try:
        if USED_PHOTO_PROOF.stat().st_size>16384:return False
        proof=json.loads(USED_PHOTO_PROOF.read_text(encoding='utf8'))
        manifest=json.loads(MANIFEST.read_text(encoding='utf8'))
        if not all(proof.get(k) is True for k in ('accepted','userAccepted','fullSupervisorStageAccepted','backgroundSaveAccepted')):return False
        if proof.get('build')!='9.6.0.4097' or proof.get('binaries')!=manifest['binaries'] or plan.get('extension')!='.png':return False
        if plan.get('moving') and proof.get('folderMovesAccepted') is not True:return False
        if any(proof.get(k)!=job.get(k) for k in ('ProjectId','BindingId','SourceId','MaterialId')):return False
        if proof.get('fileIdentity')!=plan.get('fileIdentity') or proof.get('timelineSourceId')!=plan.get('sourceId'):return False
        evidence=Path(proof['evidence']).resolve()
        if not any(evidence.is_relative_to((ROOT/'artifacts'/name).resolve()) for name in ('ExplorerUsedPhotoFinalLab','ExplorerUsedPhotoMoveLab')):return False
        return digest(evidence)==proof.get('evidenceSha256')
    except (OSError,ValueError,KeyError,TypeError):return False

def save_payload(identifier,expected,sdk_id=LAB_ID):
    _,manifest=acceptance(SCOPES[PNG_MATERIAL]);exports=json.loads(manifest.read_text(encoding='utf8'))['exports']
    model=json.loads((ROOT/'artifacts/SdkModelProbe/1792059078966742900/model-report.json').read_text(encoding='utf8'))
    return {'id':identifier,'projectId':sdk_id,'expectedTimeline':expected,'draftVtableRva':model['draftVtableRva'],'exports':exports,'storeSaveExport':STORE_SAVE_EXPORT}

def photo_timeline(before,plan):
    expected=deepcopy(before)
    for original in plan['timelineSources']:
        found=[v for v in expected['materials'][plan.get('sourceGroup','videos')] if v.get('id')==original['id']]
        if len(found)!=1 or found[0]!=original:raise ValueError('Owned source properties changed before timeline save')
        found[0].update(path=plan['new'].replace('\\','/'))
        found[0][plan.get('nameField','material_name')]=plan.get('newSourceNames',{}).get(original['id'],plan['newSourceName'])
    return expected

def lab_plan_state(state,project_key,sdk_id=LAB_ID):
    """Translate the confirmed ProjectKey consistently for the lab-only planner."""
    pure=deepcopy(state)
    owned=set()
    for binding in pure['Bindings']:
        if binding['ProjectId']==project_key:
            owned.add(binding['Id']);binding['ProjectId']=sdk_id
    for folder in pure.get('ManagedFolders',[]):
        job=folder['Job']
        if job['ProjectId']==project_key and job['BindingId'] in owned:job['ProjectId']=sdk_id
    return pure

def template_exact(original,current,before_timeline,expected_timeline=None):
    left,right=original/'template-2.tmp',current/'template-2.tmp'
    if expected_timeline is None:
        return left.exists()==right.exists() and (not left.exists() or left.read_bytes()==right.read_bytes())
    try:
        if left.stat().st_size>4*1024*1024 or right.stat().st_size>4*1024*1024:return False
        # StoreWrapper writes the SDK timeline and its JSON template together.
        # Require the COMPLETE original template and the COMPLETE expected copy.
        return json.loads(left.read_bytes())==before_timeline and json.loads(right.read_bytes())==expected_timeline
    except (OSError,ValueError):return False

def normalize_stock_service(before,after):
    """Only the previously accepted empty stock row may refresh these clocks."""
    result=deepcopy(after);identifier='cd484075-d92a-4bc9-b45c-d093d2f9e71b'
    old=[r for r in rows(before) if r['id']==identifier];new=[r for r in rows(result) if r['id']==identifier]
    template=next(r for r in rows(load(ROOT/'research/evidence/native-stock-capture-1791880114470205300/after')) if r['id']==identifier)
    clocks={'create_time','import_time','import_time_ms'}
    stable=lambda row:{key:value for key,value in row.items() if key not in clocks}
    if len(old)==len(new)==1 and not template.get('file_Path') and template.get('metetype')=='none' and stable(old[0])==stable(new[0])==stable(template):
        new[0].clear();new[0].update(deepcopy(old[0]))
    return result

def compare_folder(before,after,job):
    left=deepcopy(before);right=normalize_stock_service(before,after)
    # A fresh stock session may recreate this one known empty service row on
    # its first write. Never admit another ID, a media path or altered payload.
    service='cd484075-d92a-4bc9-b45c-d093d2f9e71b';added=None
    old=[r for r in rows(left) if r['id']==service];new=[r for r in rows(right) if r['id']==service]
    if not old and len(new)==1:
        template=next(r for r in rows(load(ROOT/'research/evidence/native-stock-capture-1791880114470205300/after')) if r['id']==service)
        clocks={'create_time','import_time','import_time_ms'};stable=lambda row:{k:v for k,v in row.items() if k not in clocks}
        if not new[0].get('file_Path') and new[0].get('metetype')=='none' and stable(new[0])==stable(template) and all(isinstance(new[0].get(k),int) and new[0][k]>=0 for k in clocks):
            added={'id':service,'stockClocks':{k:new[0][k] for k in clocks}}
            for group in right['meta']['draft_materials']:group['value']=[r for r in group['value'] if r['id']!=service]
    # Registry serialization order is not an identity. Keep every full row and
    # multiplicity; only compare the arrays in a deterministic order.
    for document in (left,right):
        for group in document['meta']['draft_materials']:
            group['value'].sort(key=lambda row:json.dumps(row,sort_keys=True,ensure_ascii=False))
    result=folder_preservation(left,right,{**job,'RelativePath':job['Name']})
    result['allowedStockServiceAddition']=added
    return result


def pending_import_folder_save(before,after,job,identifier,origin):
    """Only the exact imported-card edge may still be at its known stock origin.

    This is a read-wait predicate, never an acceptance comparator. The final
    destination and every complete document must pass the ordinary comparison.
    """
    if origin==job['MediaFolderId'] or parent_edges(after,identifier)!=[{'child_id':identifier,'parent_id':origin}]:return False
    if not preservation(before,after,{**job,'MediaFolderId':origin},identifier)['accepted']:return False
    metadata=lambda doc:{k:v for k,v in doc['meta'].items() if k not in ('draft_materials','tm_draft_modified')}
    return metadata(before)==metadata(after)

class Lease(C.Structure):
    _fields_ = [('processId', C.c_uint32), ('reserved', C.c_uint32), ('viewEpoch', C.c_uint64),
               ('location', C.c_wchar * 1024), ('draftId', C.c_char * 37), ('token', C.c_char * 65)]
class Folder(C.Structure):
    _fields_ = FolderBase._fields_ + [('name', C.c_wchar * 81), ('lease', Lease)]
class Move(C.Structure):
    _fields_ = MoveBase._fields_ + [('lease', Lease)]
class LinkedMove(C.Structure):
    _fields_ = MoveBase._fields_ + [('aliasesJson',C.c_char*1024),('lease',Lease)]
class Bin(C.Structure):
    _fields_ = BinBase._fields_ + [('lease', Lease)]
class BinWithTitles(C.Structure):
    _fields_ = Bin._fields_ + [('desiredLabelsJson',C.c_char*16384)]
class Source(C.Structure):
    _fields_ = SourceBase._fields_ + [('lease', Lease)]
class Drop(C.Structure):
    _fields_ = DropBase._fields_ + [('root', C.c_wchar * 1024), ('jobId', C.c_char * 37), ('lease', Lease)]
class SessionRelay(C.Structure):
    _fields_=[('size',C.c_uint32),('version',C.c_uint32),('output',C.c_wchar*1024)]

def verified_material(current, job, record):
    """Read a completed receipt without replaying it or adopting another card."""
    identifier=record['materialId']
    found=[r for r in rows(current) if r['id']==identifier]
    if len(found)!=1 or identifier!=job.get('MaterialId',identifier) or canonical(found[0].get('file_Path',''))!=canonical(job['SourcePath']):
        return 'Verified material changed independently'
    plan=record.get('photoPlan')
    parent=plan['destinationFolderId'] if plan else job['MediaFolderId']
    try:require_folder(current,parent)
    except ValueError:return 'Verified material folder is absent or ambiguous'
    if parent_edges(current,identifier)!=[{'child_id':identifier,'parent_id':parent}]:
        return 'Verified material folder changed independently'
    if plan:
        for alias in plan.get('linkedAliasRows',[]):
            linked=[r for r in rows(current) if r['id']==alias['id']]
            if len(linked)!=1 or canonical(linked[0].get('file_Path',''))!=canonical(plan['new']) or parent_edges(current,alias['id'])!=plan['linkedAliasEdges'][alias['id']]:return 'Verified linked alias changed independently'
        # Labels may legitimately be edited by the user after completion. Paths
        # and source UUIDs remain mandatory, including every existing segment.
        for original in plan['timelineSources']:
            sources=[v for v in current['timeline']['materials'][plan.get('sourceGroup','videos')] if v.get('id')==original['id']]
            if len(sources)!=1 or sources[0].get('type')!=original.get('type') or canonical(sources[0].get('path',''))!=canonical(plan['new']):
                return 'Verified timeline source changed independently'
    return None

def prepare():
    """Offline preflight, before any new DLL is loaded. Never rebuild pinned targets."""
    base = Path.home() / 'AppData/Local/CapCut/Apps/9.6.0.4097'
    missing = []; binaries = {}
    previous=json.loads(MANIFEST.read_text(encoding='utf8')) if MANIFEST.exists() else None
    if previous:
        for adapter,sha in previous['binaries'].items():
            suffix='V2' if previous.get('runtimeVersion')==2 and adapter!='InputState' else ''
            if digest(BUILD/f'CapSync.ExplorerRuntime{adapter}{suffix}.dll')!=sha:
                raise ValueError('A previously prepared runtime binary changed')
    for adapter in ('Events', 'Import', 'Folder', 'TreeMove', 'BinPath', 'SourcePath', 'InputState', 'StoreSave', 'SessionRelay', 'BinAliases', 'SourceWindows', 'TreeLinked'):
        suffix='' if adapter=='InputState' else 'V2'
        dll = BUILD / f'CapSync.ExplorerRuntime{adapter}{suffix}.dll'
        pe = PE(dll)
        nt=pe.u32(0x3c);pos=pe.offset(pe.base+pe.u32(nt+24+120))
        while any(pe.raw[pos:pos+20]):
            name=pe.cstring(pe.offset(pe.base+pe.u32(pos+12)));thunk=pe.u32(pos) or pe.u32(pos+16);pos+=20
            if not name.lower().startswith('qt6'):continue
            exports={e['name'] for e in PE(base/name).exports()};offset=pe.offset(pe.base+thunk)
            while True:
                value=struct.unpack_from('<Q',pe.raw,offset)[0];offset+=8
                if not value:break
                if value>>63:continue
                function=pe.cstring(pe.offset(pe.base+value)+2)
                if function not in exports:missing.append([adapter,name,function])
        binaries[adapter] = digest(dll)
    if missing: raise ValueError('Missing vendor imports: ' + repr(missing))
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    if previous and previous.get('runtimeVersion')!=2:
        archive=MANIFEST.with_name('manifest-v1.json')
        if archive.exists() and json.loads(archive.read_text(encoding='utf8'))!=previous:raise ValueError('V1 archive differs')
        if not archive.exists():atomic(archive,previous)
    atomic(MANIFEST, {'build': '9.6.0.4097', 'runtimeVersion':2, 'binaries': binaries, 'missing': [], 'labOnly': True})
    return {'prepared': True, 'adapters': len(binaries), 'liveCalls': 0}

def invoke(pid, adapter, export, request, output):
    manifest = json.loads(MANIFEST.read_text(encoding='utf8'))
    suffix='V2' if manifest.get('runtimeVersion')==2 and adapter!='InputState' else ''
    dll = BUILD / f'CapSync.ExplorerRuntime{adapter}{suffix}.dll'
    sha = manifest['binaries'][adapter]
    if digest(dll) != sha: raise ValueError('Runtime binary changed; do not replace loaded modules')
    staged = ROOT / 'artifacts/ExplorerRuntime' / sha[:16] / dll.name
    staged.parent.mkdir(parents=True, exist_ok=True)
    if not staged.exists(): shutil.copyfile(dll, staged)
    if digest(staged) != sha: raise ValueError('Staged adapter changed')
    loaded = modules(pid)
    present = [m for m in loaded if m['name'].casefold() == dll.name.casefold()]
    if present and (len(present) != 1 or canonical(present[0]['path']) != canonical(staged)):
        raise ValueError('A different runtime adapter is already loaded')
    if output.exists(): raise ValueError('Native output already exists; no replay')
    output.parent.mkdir(parents=True, exist_ok=True)
    request.size = C.sizeof(type(request)); request.version = 1 if adapter not in ('BinPath','BinAliases') else 2
    request.output = str(output)
    pe = PE(staged); rva = int(next(e['rva'] for e in pe.exports() if e['name'] == export), 16)
    if not any(n == '.text' and a <= rva < a+s for n,a,_,s,_ in pe.sections): raise ValueError('Runtime entry is not code')
    loader = Loader(pid)
    try:
        if not present and not loader.call(loader.library_entry(), (str(staged)+'\0').encode('utf-16le')):
            raise ValueError('Runtime LoadLibrary failed before callback')
        module = next(m for m in modules(pid) if canonical(m['path']) == canonical(staged))
        entry_result=loader.call(module['base']+rva, bytes(request))
        if entry_result != 1:
            atomic(output.with_name('entry-rejection-'+adapter+'.json'),{'adapter':adapter,'entryResult':entry_result,'requestSize':request.size,'requestVersion':request.version,'projectMutation':False if adapter in ('Events','SessionRelay','InputState') else None})
            raise ValueError('Runtime entry rejected; inspect entry rejection receipt, no replay')
    finally: loader.close()
    until = time.monotonic()+12
    while not output.exists() and time.monotonic() < until: time.sleep(.05)
    if not output.exists(): raise ValueError('Native completion unknown; no replay')
    return json.loads(output.read_text(encoding='utf8'))

def bootstrap(data):
    bridge = data['bridge']; pid = bridge['ProcessId']
    loaded = validate(pid, build='9.6.0.4097', check_identity=False)
    sdk = next(m for m in loaded if m['name'].casefold() == 'videoeditor.dll')
    if digest(sdk['path']) != '47e341ce930074bd7d11ef418ea5c893fc6330aa73b2f2203c5098f302d63e9f': raise ValueError('SDK changed')
    output = Path(data['evidence']) / 'evidence/bridge-status.json'
    request = EventsRequest(expectedLocation=str(lab_directory()), pipe=bridge['PipeName'], token=bridge['Token'].encode('ascii'))
    result = invoke(pid, 'Events', 'CapSync_ExplorerEventsThread', request, output)
    if result['status'] not in ('connecting', 'connected'): raise ValueError('Runtime observer rejected')
    relay=invoke(pid,'SessionRelay','CapSync_SessionRelayThread',SessionRelay(),output.with_name('session-relay.json'))
    if relay.get('status')!='attached':raise ValueError('Session readiness relay rejected')
    return {'attached': True, 'labOnly': True}

def execute(data,context=None):
    # Only reads may wait for CapCut's short save lock. Dispatch never retries.
    from explorer_project_io import load_project,snapshot_project
    project_load=load_project if context else load
    project_snapshot=snapshot_project if context else snapshot
    job = data['job']; kind = data['kind']; editor = data['editor']; pid = editor['ProcessId']
    project_directory=context.directory if context else lab_directory()
    sdk_id=context.sdk_id if context else LAB_ID
    native_root=context.destination_root if context else NATIVE_ROOT
    previous_root=context.previous_root if context else NATIVE_ROOT
    media=context is not None or data.get('mediaAdapters') is True
    preserve_labels=False
    if media:
        from explorer_media_runtime import LABELS_PRESERVED
        preserve_labels=LABELS_PRESERVED
    key = editor['Project']; private = Path(data['statePath']).resolve().parent
    if context is None:
        if not key or key['Value'] != job['ProjectId'] or key['DraftId'].upper() != LAB_ID.upper() or canonical(key['Location']) != canonical(project_directory):
            raise ValueError('Job is outside the confirmed authorized lab')
        if not Path(job['RootPath']).resolve().is_relative_to(NATIVE_ROOT.resolve()):
            return {'JobId':job['Id'], 'Status':'Waiting', 'Reason':'This development adapter supports only the laboratory source tree'}
        if kind=='transfer' and (not Path(job['DestinationRootPath']).resolve().is_relative_to(NATIVE_ROOT.resolve()) or private.is_relative_to(Path(job['DestinationRootPath']).resolve())):
            return {'JobId':job['Id'],'Status':'Waiting','Reason':'Transfer destination must remain in the laboratory and outside private state'}
        if private.is_relative_to(Path(job['RootPath']).resolve()): raise ValueError('Private state is inside the source')
    run = private / 'native-journal' / str(uuid.UUID(job['Id']))
    run.mkdir(parents=True, exist_ok=True); marker = run/'journal.json'
    record = json.loads(marker.read_text(encoding='utf8')) if marker.exists() else {'job':job, 'kind':kind, 'stage':'Prepared'}
    comparable=lambda value:{k:v for k,v in value.items() if not (context and getattr(context,'virtual_container',False) and k in ('RootPath','SourceDirectory'))}
    if comparable(record['job']) != comparable(job) or record['kind'] != kind: raise ValueError('Durable request changed')
    dispatched=0
    def reply(status, identifier=None, reason=None):
        return {'JobId':job['Id'], 'Status':status, 'MaterialId':identifier, 'Reason':reason, 'NativeCommands':dispatched}
    if record['stage']=='RejectedFormat':return reply('RejectedFormat',reason='UnsupportedMediaFile')
    if record['stage'] == 'Verified':
        current = project_load(project_directory); identifier = record['materialId']
        if kind == 'folder':
            folder=require_folder(current, identifier)
            if folder.get('display_name')!=job['Name'] or parent_edges(current,identifier)!=[{'child_id':identifier,'parent_id':job['ParentFolderId']}]:
                return reply('Conflict',reason='Verified folder was moved or renamed independently')
        else:
            reason=verified_material(current,job,record)
            if reason:return reply('Conflict',reason=reason)
        return reply('Verified', identifier)
    deferred=record['stage']=='WaitingForUserDrag'
    if deferred:
        record['stage']='Prepared';record['deferredAttempt']=record.get('deferredAttempt',0)+1
        run=run/f'deferred-{record["deferredAttempt"]}'
        if run.exists():return reply('Unknown',reason='A deferred delivery already has evidence')
        run.mkdir()
    if record['stage'] != 'Prepared': return reply('Unknown', reason='Prior dispatch is never repeated; inspect the durable receipt')
    if not deferred and (run/'before').exists():
        # Only an explicit read-only recovery may return the marker to Prepared.
        if not record.get('rejectedBeforeDispatchRecovered'):return reply('Unknown',reason='A prior preimage already exists; no replay')
        attempt=record.get('recoveryAttempt',1)
        run=run/('recovered-attempt' if attempt==1 else f'recovered-attempt-{attempt}')
        if run.exists():return reply('Unknown',reason='The recovered attempt was already used')
        run.mkdir()
    lease = Lease(processId=pid, viewEpoch=editor['ViewEpoch'], location=key['Location'].replace('\\','/'), draftId=key['DraftId'].encode('ascii'), token=data['token'].encode('ascii'))
    before = project_load(project_directory)
    if kind=='restore':
        state=json.loads(Path(data['statePath']).read_text(encoding='utf8'))
        owned=[s for s in state['Sources'] if s['Id']==job['SourceId'] and s['BindingId']==job['BindingId']]
        if len(owned)!=1 or owned[0].get('MaterialRemoved') is not True or owned[0].get('MaterialId')!=data.get('retiredMaterialId') or \
           owned[0]['Version']!=job['SourceVersion'] or owned[0]['FileIdentity']!=job.get('FileIdentity') or \
           any(r['id']==data.get('retiredMaterialId') for r in rows(before)):
            return reply('Conflict',reason='Removed card ownership changed before restoration')
    atomic(marker, record)
    def issue(adapter, export, request, output):
        nonlocal dispatched
        if not (run/'before').exists():project_snapshot(project_directory,run/'before')
        record['stage'] = 'Dispatching'; atomic(marker, record)
        dispatched+=1
        if context:return context.invoke(pid,adapter,export,request,output)
        if media and adapter in ('Import','TreeMove','TreeLinked','BinPath','BinAliases','SourceWindows'):
            from explorer_media_runtime import invoke as media_invoke
            return media_invoke(pid,adapter,export,request,output)
        return invoke(pid, adapter, export, request, output)
    started = time.monotonic()
    stable = None
    try:
        if kind == 'folder':
            if any(r['id'] == job['FolderId'] for g in before['store']['draft_virtual_store'] for r in g['value'] if 'id' in r):
                return reply('Conflict', reason='Proposed folder ID already exists without a receipt')
            source = Path(job['SourceDirectory'])
            request = Folder(action=1, source=str(source), root=str(native_root), meta=str(project_directory/'draft_meta_info.json'),
                jobId=job['Id'].encode(), folderId=job['FolderId'].encode(), parentId=job['ParentFolderId'].encode(), name=job['Name'], lease=lease)
            native = issue('Folder','CapSync_FolderCommandThread',request,run/'evidence/folder.json')
            identifier = job['FolderId']
            def compare(current):
                # The existing comparator reads the desired name from RelativePath.
                return compare_folder(before,current,job)
        else:
            source = Path(job['SourcePath']); stable = StableFile(source)
            expected_identity = job.get('FileIdentity') or data['fileIdentity']
            if stable.identity() != expected_identity or digest(source).casefold() != job['Hash'].casefold() or source.stat().st_size != job['Size']:
                return reply('Superseded', reason='Source revision changed before dispatch')
            if kind in ('add','restore'):
                if any(r.get('file_Path') and canonical(r['file_Path']) == canonical(source) for r in rows(before)):
                    return reply('Conflict', reason='An existing independent material already uses this path')
                require_folder(before,job['MediaFolderId'])
                request=Drop(hiddenRequired=2,source=str(source),meta=str(project_directory/'draft_meta_info.json'),sha256=job['Hash'].encode(),root=job['RootPath'],jobId=job['Id'].encode(),lease=lease)
                native=issue('Import','CapSync_ExplorerTargetDropThread',request,run/'evidence/target-drop.json')
                for retry in range(2):
                    if native.get('status')!='rejected' or native.get('dispatched') is not False or native.get('reason')!='user drag in progress':break
                    # At most two one-shot deadlines for this exact pending job.
                    # No event was sent; never retry delivered/unknown imports.
                    time.sleep(.75)
                    native=issue('Import','CapSync_ExplorerTargetDropThread',request,run/f'drag-retry-{retry+1}/evidence/target-drop.json')
                atomic(run/'evidence/import-receipt.json',native)
                if media and kind=='add' and native.get('status')=='rejected' and native.get('dispatched') is False and native.get('decoderRejected') is True and native.get('reason')=='unsupported media bytes':
                    from folder_view_repair import compare as unchanged_graph
                    project_snapshot(project_directory,run/'rejected-read-only');checked=unchanged_graph(before,load(run/'rejected-read-only'))
                    atomic(run/'rejected-read-only-comparison.json',checked)
                    if not checked['accepted'] or not template_exact(run/'before',run/'rejected-read-only',before['timeline'],before['timeline']):
                        return reply('Conflict',reason='Project changed during decoder preflight; no import was dispatched')
                    record.update(stage='RejectedFormat',editorMutations=0,decoderRejected=True);atomic(marker,record)
                    return reply('RejectedFormat',reason='UnsupportedMediaFile')
                if native.get('status')=='rejected' and native.get('dispatched') is False and native.get('reason')=='user drag in progress':
                    record['stage']='WaitingForUserDrag';atomic(marker,record)
                    return reply('Waiting',reason='Import is paused while dragging. A folder change or Check now will try again.')
                if native.get('status') != 'dispatched-unconfirmed' or not all(native.get(k) for k in ('enterAccepted','moveAccepted','dropAccepted','focusUnchanged','foregroundUnchanged','navigationUnchanged')):
                    return reply('Unknown',reason='Addressed import was not confirmed; no replay')
                until=time.monotonic()+12; matches=[]
                while time.monotonic()<until:
                    current=project_load(project_directory);matches=[r for r in rows(current) if r.get('file_Path') and canonical(r['file_Path'])==canonical(source)]
                    if len(matches)==1:break
                    time.sleep(.1)
                if len(matches)!=1:return reply('Unknown',reason='Imported material ownership is unknown')
                identifier=matches[0]['id']
                checked=preservation(before,current,{**job,'MediaFolderId':native['folderId']},identifier)
                atomic(run/'import-comparison.json',checked)
                if not checked['accepted']:return reply('Conflict',reason='Unrelated data changed during import')
                if native['folderId'] != job['MediaFolderId']:
                    record['stage']='MovingImportedCard';atomic(marker,record)
                    request_type=LinkedMove if media else Move
                    extra={'aliasesJson':json.dumps([identifier]).encode()} if media else {}
                    request=request_type(action=2,source=str(source),root=str(native_root),meta=str(project_directory/'draft_meta_info.json'),
                        jobId=job['Id'].encode(),targetId=job['MediaFolderId'].encode(),materialId=identifier.encode(),sha256=job['Hash'].encode(),lease=lease,**extra)
                    native=issue('TreeMove','CapSync_AddCommandThread',request,run/'evidence/move.json')
                def compare(current):return preservation(before,current,job,identifier)
            elif kind in ('update','transfer'):
                state=json.loads(Path(data['statePath']).read_text(encoding='utf8'))
                pure=lab_plan_state(state,job['ProjectId'],sdk_id)
                links_file=Path(data['statePath']).with_name('source-links.json')
                links=[]
                if links_file.exists():
                    if links_file.stat().st_size>128*1024:raise ValueError('Private source links exceed their bound')
                    links=json.loads(links_file.read_text(encoding='utf8'))
                    if not isinstance(links,list) or len(links)>64:raise ValueError('Invalid private source links')
                    for link in links:
                        if link['ProjectId']==job['ProjectId']:
                            if link.get('SourceId')==job['SourceId'] and link.get('FileIdentity')!=stable.identity():
                                raise ValueError('Explicit source link physical identity changed')
                            link['ProjectId']=sdk_id
                planner_extra={'media':True,'preserve_labels':preserve_labels} if media else {}
                if media and (context or os.environ.get('WAKUSHARE_LAB_SOURCE_LINKS')=='1'):planner_extra['batch_sources']=True
                p=photo_plan({**job,'ProjectId':sdk_id},pure,before,stable.identity(),links,linked_aliases=True,linked_alias_moves=True,**planner_extra)
                bin_request=Bin;bin_extra={}
                if media:
                    from explorer_media_runtime import EXPLICIT_LABELS
                    if EXPLICIT_LABELS:
                        from explorer_bin_labels import apply as apply_observed_labels
                        apply_observed_labels(private,job,p,before)
                        names=json.dumps(p['newBinNames'],ensure_ascii=False).encode('utf8')
                        if len(names)>=16384:return reply('Waiting',reason='Owned display names exceed the native request bound; no mutation')
                        bin_request=BinWithTitles;bin_extra={'desiredLabelsJson':names}
                        if context:
                            from explorer_product_bridge import ProductBin
                            bin_request=ProductBin;bin_extra['previousRoot']=str(previous_root)
                if p['moving'] and not media and os.environ.get('WAKUSHARE_PHOTO_MOVE_LAB')!='1' and not accepted_used_photo(job,p):
                    return reply('Waiting',reason='Photo folder moves need explicit laboratory acceptance')
                exact_paths={r['file_Path'].replace('\\','/') for r in rows(before) if r['id'] in p['relatedMaterialIds']}
                if len(exact_paths)!=1 and not preserve_labels:return reply('Waiting',reason='Linked cards use different path spelling; a grouped exact-path adapter is required before any source dispatch')
                if p['sourceId'] and not media and os.environ.get('WAKUSHARE_USED_PHOTO_LAB')!='1' and not accepted_used_photo(job,p):
                    return reply('Waiting',reason='Used photo paths are disabled until background timeline saving is accepted')
                expected_timeline=photo_timeline(before['timeline'],p)
                if p['sourceId'] and not template_exact(project_directory,project_directory,before['timeline'],before['timeline']):
                    return reply('Waiting',reason='SDK template differs from the complete saved timeline; no source dispatch')
                record['photoPlan']=p;atomic(marker,record)
                if media:
                    from explorer_media_runtime import BIN_PREFLIGHT
                    if BIN_PREFLIGHT:
                        preview=bin_request(action=0,oldPath=p['old'],newPath=p['new'],root=str(native_root),meta=str(project_directory/'draft_meta_info.json'),
                            jobId=job['Id'].encode(),materialId=job['MaterialId'].encode(),sha256=job['Hash'].encode(),aliasesJson=json.dumps(p['relatedMaterialIds']).encode(),lease=lease,**bin_extra)
                        preflight=issue('BinPath','CapSync_RelinkCommandThread',preview,run/'evidence/bin-preflight.json')
                        if preflight.get('status')!='ready' or preflight.get('wholeSdkBinExact') is not True:
                            return reply('Conflict',reason='Owned stock view-model preflight differs; no source/bin setters were sent')
                        from folder_view_repair import compare as unchanged_graph
                        current=project_load(project_directory);checked=unchanged_graph(before,current)
                        metadata=lambda doc:{k:v for k,v in doc['meta'].items() if k not in ('draft_materials','tm_draft_modified')}
                        if metadata(before)!=metadata(current):checked['errors'].append('Complete metadata changed during stock-model preflight')
                        if not template_exact(run/'before',project_directory,before['timeline']):checked['errors'].append('Template changed during stock-model preflight')
                        checked['accepted']=not checked['errors'];atomic(run/'preflight-comparison.json',checked)
                        if not checked['accepted']:return reply('Conflict',reason='Project changed during read-only stock-model preflight; no source/bin setters')
                if p['sourceId']:
                    _,manifest=acceptance(SCOPES[PNG_MATERIAL]);exports=json.loads(manifest.read_text(encoding='utf8'))['exports']
                    if media:
                        av=json.loads((ROOT/'research/evidence/direct-sdk-access/av-narrow-path-batch/journal.json').read_text(encoding='utf8'))
                        exports.update(json.loads(Path(av['manifest']).read_text(encoding='utf8'))['exports'])
                    model=json.loads((ROOT/'artifacts/SdkModelProbe/1792059078966742900/model-report.json').read_text(encoding='utf8'))
                    working=deepcopy(before['timeline'])
                    for index,original in enumerate(p['timelineSources']):
                        suffix='' if index==0 else '-'+str(index+1)
                        identifier=original['id'];desired_name=p.get('newSourceNames',{}).get(identifier,p['newSourceName'])
                        payload={'id':job['Id'],'projectId':sdk_id,'materialId':job['MaterialId'],'sourceId':identifier,'rootPath':str(previous_root),
                            'metaPath':str(project_directory/'draft_meta_info.json'),'baselineTimeline':working,'restoreProperties':original,
                            'newPath':p['new'].replace('\\','/'),'newName':desired_name,'exports':exports,'draftVtableRva':model['draftVtableRva']}
                        if media:payload['mediaGroup']=p['sourceGroup']
                        if context:payload['destinationRootPath']=str(native_root)
                        if p.get('ownedRetiredMaterialIds'):payload['ownedRetiredMaterialIds']=p['ownedRetiredMaterialIds']
                        input_path=run/('source-input'+suffix+'.json');atomic(input_path,payload)
                        native=issue('SourceWindows','CapSync_SourcePath',Source(input=str(input_path),lease=lease),run/('evidence/source'+suffix+'.json'))
                        atomic(run/('source-receipt'+suffix+'.json'),native)
                        if native.get('status')!='changed' or not native.get('wholeSdkDraftExact'):return reply('Unknown',reason='Timeline source path update is unconfirmed; no remaining source/bin/save dispatch')
                        updated=next(v for v in working['materials'][p.get('sourceGroup','videos')] if v['id']==identifier)
                        updated.update(path=p['new'].replace('\\','/'));updated[p.get('nameField','material_name')]=desired_name
                    if working!=expected_timeline:raise ValueError('Complete batch source timeline differs; no bin/save dispatch')
                request=bin_request(action=3,oldPath=p['old'],newPath=p['new'],root=str(native_root),meta=str(project_directory/'draft_meta_info.json'),
                    jobId=job['Id'].encode(),materialId=job['MaterialId'].encode(),sha256=job['Hash'].encode(),aliasesJson=json.dumps(p['relatedMaterialIds']).encode(),lease=lease,**bin_extra)
                native=issue('BinAliases' if p.get('linkedAliasRows') else 'BinPath','CapSync_RelinkCommandThread',request,run/'evidence/bin.json');identifier=job['MaterialId']
                if native.get('status')!='changed' or not all(native.get(k) for k in ('focusUnchanged','foregroundUnchanged','navigationUnchanged')):
                    return reply('Unknown',reason='Bin update is unconfirmed; no move/save or replay')
                if set(native.get('updatedAliasIds',[]))!=set(p['relatedMaterialIds']):return reply('Unknown',reason='Not every explicitly owned alias was confirmed; no move/save or replay')
                if p['moving']:
                    current=project_load(project_directory)
                    if current['timeline'] not in (before['timeline'],expected_timeline):return reply('Conflict',reason='Unrelated timeline change before folder relocation')
                    # SourcePath has already verified the whole live SDK Draft.
                    # Disk may still hold its old timeline until StoreSave.
                    normalized=deepcopy(current);normalized['timeline']=expected_timeline
                    checked=photo_compare(before,normalize_stock_service(before,normalized),p,moved=False)
                    atomic(run/'before-move-comparison.json',checked)
                    if not checked['accepted']:return reply('Conflict',reason='Full bin/graph comparison differs before folder relocation')
                    request=LinkedMove(action=2,source=str(source),root=str(native_root),meta=str(project_directory/'draft_meta_info.json'),
                        jobId=job['Id'].encode(),targetId=p['destinationFolderId'].encode(),materialId=job['MaterialId'].encode(),sha256=job['Hash'].encode(),aliasesJson=json.dumps(p['relatedMaterialIds']).encode(),lease=lease)
                    native=issue('TreeLinked','CapSync_AddCommandThread',request,run/'evidence/folder-move.json')
                    if native.get('status')!='moved' or not all(native.get(k) is True for k in ('idPreserved','parentUpdated','fullSdkBinPreserved','focusUnchanged','foregroundUnchanged','navigationUnchanged')):
                        return reply('Unknown',reason='Owned card folder move is unconfirmed; no save or replay')
                    current=project_load(project_directory)
                    if current['timeline'] not in (before['timeline'],expected_timeline):return reply('Conflict',reason='Unrelated timeline change after folder relocation')
                    normalized=deepcopy(current);normalized['timeline']=expected_timeline
                    checked=photo_compare(before,normalize_stock_service(before,normalized),p,moved=True)
                    atomic(run/'after-move-comparison.json',checked)
                    if not checked['accepted']:return reply('Conflict',reason='Full bin/graph comparison differs after folder relocation; no timeline save')
                if p['sourceId']:
                    atomic(run/'save-input.json',save_payload(job['Id'],expected_timeline,sdk_id) if context else save_payload(job['Id'],expected_timeline))
                    native=issue('StoreSave','CapSync_StoreSaveThread',Source(input=str(run/'save-input.json'),lease=lease),run/'evidence/timeline-save.json')
                    if native.get('status')!='submitted' or native.get('wholeSdkDraftExact') is not True:
                        return reply('Unknown',reason='Timeline save is unconfirmed; never repeat source/bin/save')
                def compare(current):return photo_compare(before,normalize_stock_service(before,current),p,moved=p['moving'])
            else: raise ValueError('Unknown adapter operation')
        atomic(run/'native-receipt.json',native)
        confirmed_import=kind in ('add','restore') and native.get('status')=='dispatched-unconfirmed' and all(native.get(k) is True for k in ('enterAccepted','moveAccepted','dropAccepted'))
        if (native.get('status') not in ('created','moved','changed','submitted') and not confirmed_import) or not all(native.get(k) is True for k in ('focusUnchanged','foregroundUnchanged','navigationUnchanged')):
            return reply('Unknown',reason='Native receipt is inconclusive; no replay')
        def full_compare(folder):
            after=load(folder);checked=compare(after)
            left,right=deepcopy(before['meta']),deepcopy(after['meta'])
            for document in (left,right):
                document.pop('draft_materials',None);document.pop('tm_draft_modified',None)
            if left!=right:checked['errors'].append('Other metadata changed')
            intended=expected_timeline if kind in ('update','transfer') and p['sourceId'] else None
            if not template_exact(run/'before',folder,before['timeline'],intended):checked['errors'].append('Template differs from the complete expected timeline')
            checked['accepted']=not checked['errors'];return checked
        project_snapshot(project_directory,run/'immediate');checked=full_compare(run/'immediate');atomic(run/'immediate-comparison.json',checked)
        if context and not checked['accepted'] and kind in ('add','restore') and native.get('status')=='moved':
            origin=json.loads((run/'evidence/import-receipt.json').read_text(encoding='utf8'))['folderId']
            for index,delay in enumerate((.1,.3,.9)):
                current=project_load(run/'immediate' if index==0 else run/f'folder-save-settling-{index}')
                if not pending_import_folder_save(before,current,job,identifier,origin) or not template_exact(run/'before',run/'immediate' if index==0 else run/f'folder-save-settling-{index}',before['timeline']):break
                time.sleep(delay);folder=run/f'folder-save-settling-{index+1}'
                project_snapshot(project_directory,folder);checked=full_compare(folder);atomic(run/f'folder-save-settling-{index+1}-comparison.json',checked)
                if checked['accepted']:
                    record['folderSaveSettledAt']=folder.name;atomic(marker,record);break
        if not checked['accepted']:return reply('Conflict',reason='Immediate full comparison differs')
        record['stage']='VerifyingSave';atomic(marker,record)
        time.sleep(max(0,30-(time.monotonic()-started)))
        project_snapshot(project_directory,run/'saved');checked=full_compare(run/'saved');atomic(run/'saved-comparison.json',checked)
        if not checked['accepted']:return reply('Conflict',reason='Saved full comparison differs')
        record.update(stage='Verified',materialId=identifier);atomic(marker,record)
        return reply('Verified',identifier)
    except UnsupportedPhotoPlan as error:return reply('Waiting',reason=str(error))
    finally:
        if stable:stable.close()

def main():
    data=json.loads(sys.stdin.read(131073).lstrip('\ufeff'))
    if data['action']=='prepare':result=prepare()
    elif data['action']=='bootstrap':result=bootstrap(data)
    elif data['action']=='execute':result=execute(data)
    else:raise ValueError('Unknown action')
    print(json.dumps(result))
if __name__=='__main__':
    try:main()
    except Exception as error:
        # Private tokens never appear in diagnostics or tracebacks.
        import re
        MANIFEST.parent.mkdir(parents=True,exist_ok=True)
        atomic(MANIFEST.parent/'last-error.json',{'type':type(error).__name__,'reason':re.sub(r'[a-fA-F0-9]{64}','<redacted>',str(error))})
        print(json.dumps({'error':'Native adapter stopped; inspect private journal, never replay an uncertain command'}))
        sys.exit(1)
