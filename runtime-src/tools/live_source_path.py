"""Queue adapter for accepted PNG/JPEG/MP4/MOV/MP3; general rename stays off.

Only path/name setters are used for timeline sources. Bin-only V14 cannot
reset source properties. Uncertain dispatches are never automatically replayed.
"""
import ctypes as C
from copy import deepcopy
import json
import os
from pathlib import Path
import shutil
import subprocess
import time
from live_add import atomic, canonical, digest, main_pid, rows, parent_edges
from load_native_lab import ROOT, LAB_ID, Loader, validate, modules, snapshot, lab_directory
from qt_meta_inventory import PE
from verify_native_import import load

PROOF=ROOT/'research/evidence/direct-sdk-access/source-path-acceptance'
MATERIAL='e2174fcd-2e42-4b91-82be-85e2084f0164'
SOURCE='0124E20C-03D7-4dce-9F38-D839CEED4793'
CHECKPOINT=ROOT/'artifacts/LiveAddLab/source-path-checkpoint.json'
IDENTITY_FIELDS=('unique_id','category_name','local_material_id','is_copyright','material_name')
AV_PROOF=ROOT/'research/evidence/direct-sdk-access/av-narrow-path-batch'
PNG_PROOF=ROOT/'research/evidence/direct-sdk-access/still-narrow-path-batch'
PNG_MATERIAL='c024b416-3002-4de9-9ab8-7e39d7148523'
JPEG_MATERIAL='92AA99ED-8EF3-45E7-8EEC-AD9EB27C6A53'
JPEG_PROOF=ROOT/'research/evidence/direct-sdk-access/root-jpeg-path'
SCOPES={
    MATERIAL:{'materialId':MATERIAL,'sourceId':SOURCE,'group':'videos','nameField':'material_name',
              'extension':'.mp4','prefix':'metadata-path-control-native-b1e60e43-',
              'module':'CapSync.NativeSourcePathV3.dll'},
    '135fadf2-047d-4a0a-bd8e-5f51556cb7ba':{
        'materialId':'135fadf2-047d-4a0a-bd8e-5f51556cb7ba','sourceId':'87837BA2-B0F6-47ca-A80F-28EA10A92270',
        'group':'videos','nameField':'material_name','extension':'.mov','prefix':'metadata-path-control-',
        'module':'CapSync.NativeSourcePathV2.dll'},
    '79b9b63f-8c4c-403d-9efa-294bb55d0178':{
        'materialId':'79b9b63f-8c4c-403d-9efa-294bb55d0178','sourceId':'71EE1365-9861-443a-9E1F-942FAD246F27',
        'group':'audios','nameField':'name','extension':'.mp3','prefix':'metadata-path-control-',
        'module':'CapSync.NativeSourcePathV2.dll'},
    PNG_MATERIAL:{'materialId':PNG_MATERIAL,'sourceId':'1AAA761D-0CAD-41D3-A0F1-2ED4EE845DC7',
        'group':'videos','nameField':'material_name','extension':'.png','prefix':'metadata-path-control-still-',
        'directory':'ReleaseCheck/Shared','module':'CapSync.NativeSourcePathV4.dll',
        'binModule':'CapSync.NativeBinPath.dll',
        'aliases':[PNG_MATERIAL,'4195482C-1347-423E-8A4A-34771C25E21E']},
    JPEG_MATERIAL:{'materialId':JPEG_MATERIAL,'sourceId':JPEG_MATERIAL,'group':'videos','nameField':'material_name',
        'extension':'.jpg','prefix':'metadata-path-control-root-jpeg-',
        'module':'CapSync.NativeSourcePathV4.dll','binModule':'CapSync.NativeBinRootPathV2.dll','binPreflight':True}}


def accepted_scope(job):
    if job.get('ProjectId')!=LAB_ID:return None
    return SCOPES.get(job.get('MaterialId'))


def acceptance(scope):
    """Reuse completed acceptance and exports; never run another live probe."""
    if scope['materialId']==MATERIAL:
        proof=json.loads((PROOF/'journal.json').read_text(encoding='utf8'))
        if proof['stage']!='controlAcceptedAfterRestart' or not proof.get('visualPlaybackConfirmed'):
            raise ValueError('Source-path control acceptance is incomplete')
        manifest=ROOT/'artifacts/SdkModelProbe/1792059399474714300/manifest.json'
        return proof['plan']['hash'],manifest
    if scope['materialId']==JPEG_MATERIAL:
        proof=json.loads((JPEG_PROOF/'journal.json').read_text(encoding='utf8'))
        if proof['stage']!='rootJpegAccepted' or proof['plan']['sourceId']!=JPEG_MATERIAL:
            raise ValueError('Root JPEG acceptance is incomplete')
        original=json.loads((PNG_PROOF/'journal.json').read_text(encoding='utf8'))
        return proof['plan']['hash'],Path(original['manifest'])
    directory=PNG_PROOF if scope['materialId']==PNG_MATERIAL else AV_PROOF
    proof=json.loads((directory/'journal.json').read_text(encoding='utf8'))
    stage='pngControlAccepted' if scope['materialId']==PNG_MATERIAL else 'avControlsAccepted'
    if proof['stage']!=stage:raise ValueError('Source path control acceptance is incomplete')
    plans=[p for p in proof['plans'] if p['materialId']==scope['materialId'] and p['sourceId']==scope['sourceId']]
    if len(plans)!=1:raise ValueError('Accepted source identity is ambiguous')
    return plans[0]['hash'],Path(proof['manifest'])


def accepted_baseline(scope):
    if scope['materialId']==PNG_MATERIAL:return load(PNG_PROOF/'pngReopened')
    if scope['materialId']==JPEG_MATERIAL:return load(JPEG_PROOF/'reopened')
    return load(AV_PROOF/'reopened')


def remember_source(properties,path,byte_hash,evidence):
    if properties['id']!=SOURCE or canonical(properties['path'])!=canonical(path):raise ValueError('Checkpoint source differs')
    atomic(CHECKPOINT,{'ProjectId':LAB_ID,'MaterialId':MATERIAL,'sourceId':SOURCE,'appliedPath':str(path),
                      'byteHash':byte_hash,'properties':properties,'evidence':str(evidence)})


def source_preimage(current,old,byte_hash):
    """Restore only the exact observed stock missing-source identity reset.

    All edit/AI properties remain the current SDK properties. No match by name
    or hash can select another material; bin/source UUIDs are pinned first.
    """
    if current.get('id')!=SOURCE or canonical(current.get('path',''))!=canonical(old):
        raise ValueError('Source preimage identity/path differs')
    result=deepcopy(current)
    if not CHECKPOINT.exists():return result,[]
    saved=json.loads(CHECKPOINT.read_text(encoding='utf8'))
    if saved['MaterialId']!=MATERIAL or saved['sourceId']!=SOURCE or saved['ProjectId']!=LAB_ID or \
       canonical(saved['appliedPath'])!=canonical(old) or saved['byteHash'].casefold()!=byte_hash.casefold():
        raise ValueError('Source checkpoint does not match this owned revision')
    previous=saved['properties']
    changed=[k for k in IDENTITY_FIELDS if current.get(k)!=previous.get(k)]
    if not changed:return result,[]
    reset={'unique_id':'','category_name':'','local_material_id':'','is_copyright':True}
    if any(current.get(k)!=v for k,v in reset.items()) or current.get('material_name') not in ('',Path(current['path']).name) or previous.get('local_material_id')!=MATERIAL:
        raise ValueError('Source identity differs beyond the observed stock reset; no automatic overwrite')
    for key in IDENTITY_FIELDS:result[key]=deepcopy(previous[key])
    return result,changed


class Request(C.Structure):
    _fields_=[('size',C.c_uint32),('version',C.c_uint32),('input',C.c_wchar*1024),('output',C.c_wchar*1024)]


def applies(job):
    return os.environ.get('CAPSYNC_LAB_SOURCE_PATH')=='1' and accepted_scope(job) is not None


def source_command(payload,run,dll_name='CapSync.NativeSourcePath.dll'):
    """Caller must persist its dispatch stage first. This function never retries."""
    output=run/'source-receipt.json'
    if output.exists():raise ValueError('Source command already has a receipt')
    pid=main_pid();loaded=validate(pid,build='9.6.0.4097')
    sdk=next(m for m in loaded if m['name'].lower()=='videoeditor.dll')
    if digest(sdk['path'])!='47e341ce930074bd7d11ef418ea5c893fc6330aa73b2f2203c5098f302d63e9f':raise ValueError('SDK changed')
    atomic(run/'source-request.json',payload)
    allowed=(
        'CapSync.NativeFolderView.dll',
        'CapSync.NativeFolderViewV2.dll',
        'CapSync.NativePhotoSourcePath.dll',
        'CapSync.NativeSourcePath.dll','CapSync.NativeSourcePathV2.dll','CapSync.NativeSourcePathV3.dll','CapSync.NativeSourcePathV4.dll',
        'CapSync.NativeSourceMoveSinglePng.dll','CapSync.NativeSourceMoveJpeg.dll','CapSync.NativeSourceMovePng.dll','CapSync.NativeThumbRefresh.dll','CapSync.NativeThumbRefreshV2.dll',
        'CapSync.NativeThumbInspect.dll','CapSync.NativeThumbVisualTree.dll','CapSync.NativeThumbFramesRead.dll',
        'CapSync.NativeThumbTileRead.dll','CapSync.NativeThumbTileRefresh.dll','CapSync.NativeThumbTileEvict.dll',
        'CapSync.NativeThumbFrameReload.dll','CapSync.NativeThumbFrameReloadV2.dll','CapSync.NativeJpegContent.dll',
        'CapSync.NativeJpegContentV2.dll','CapSync.NativeJpegContentV3.dll','CapSync.NativePngContent.dll','CapSync.NativePngContentV2.dll',
        'CapSync.NativePlayerRefresh.dll','CapSync.NativePlayerDecoderRefresh.dll','CapSync.NativePlayerMaterialRefresh.dll',
        'CapSync.NativePlayerSegmentRefresh.dll',
        'CapSync.NativePlayerForceDecode.dll',
          'CapSync.NativePlayerSeekDecode.dll',
          'CapSync.NativePlayerEngineDecode.dll',
        'CapSync.NativeSourceRollback.dll','CapSync.NativeSourceFlush.dll','CapSync.NativeRemoveUnused.dll')
    if dll_name not in allowed:raise ValueError('Unknown source module')
    dll=ROOT/'artifacts/NativeRootReadBuild'/dll_name
    staged=ROOT/'artifacts/NativeSourcePath'/digest(dll)[:16]/dll.name
    staged.parent.mkdir(parents=True,exist_ok=True)
    if not staged.exists():shutil.copyfile(dll,staged)
    if digest(staged)!=digest(dll):raise ValueError('Staged source adapter changed')
    present=[m for m in loaded if m['name'].lower()==dll.name.lower()]
    if present and (len(present)!=1 or Path(present[0]['path']).resolve()!=staged.resolve()):raise ValueError('Another source adapter is loaded')
    loader=Loader(pid)
    try:
        if not present:loader.call(loader.library_entry(),(str(staged)+'\0').encode('utf-16le'))
        module=next(m for m in modules(pid) if Path(m['path']).resolve()==staged.resolve())
        exported=next(e for e in PE(staged).exports() if e['name']=='CapSync_SourcePath')
        request=Request(size=C.sizeof(Request),version=1,input=str(run/'source-request.json'),output=str(output))
        code=loader.call(module['base']+int(exported['rva'],16),bytes(request))
        until=time.monotonic()+5
        while not output.exists() and time.monotonic()<until:time.sleep(.05)
        if code!=1 or not output.exists():return {'status':'unknown','reason':'Completion unknown; no retry'}
        result=json.loads(output.read_text(encoding='utf8'))
        if result.get('jobId')!=payload['id']:raise ValueError('Source receipt identity differs')
        return result
    finally:loader.close()


def check(before,after,plan,scope=None):
    # Existing full-document comparator; only the owned path/name may differ.
    from test_secondary_path_batch import batch_compare
    scope=scope or SCOPES[MATERIAL]
    expected=deepcopy(before['timeline'])
    found=[]
    for item in expected['materials'][scope['group']]:
        if item['id']==scope['sourceId']:
            if plan.get('restoreIdentityFrom'):
                for key in IDENTITY_FIELDS:item[key]=plan['restoreIdentityFrom'][key]
            item['path']=str(Path(plan['new'])).replace('\\','/')
            item[scope['nameField']]=plan.get('newSourceName',Path(plan['new']).name);found.append(item)
    normalized=deepcopy(after);normalized['timeline']=before['timeline']
    bin_plans=[{**plan,'materialId':alias} for alias in scope.get('aliases',[scope['materialId']])]
    result=batch_compare(before,normalized,bin_plans,stock_metadata=True)
    if len(found)!=1 or after['timeline']!=expected:result['errors'].append('Timeline differs beyond the exact source path/name')
    result['accepted']=not result['errors']
    return result


def execute(job,run):
    def reply(status,reason=None):
        return {'JobId':job['Id'],'Status':status,'MaterialId':job['MaterialId'] if status=='Verified' else None,'Reason':reason}
    if not applies(job):return reply('Waiting','Source-path lab route is not selected')
    scope=accepted_scope(job);material=scope['materialId'];source_id=scope['sourceId'];group=scope['group']
    try:accepted_hash,manifest_path=acceptance(scope)
    except (OSError,ValueError,KeyError) as error:return reply('Waiting',str(error))
    root=ROOT/'research/fixtures/AutoAddLab';new=Path(job['SourcePath']);old=root/job['PreviousPath']
    directory=root/scope.get('directory','');expected_aliases=sorted(scope.get('aliases',[material]))
    if job.get('Flags')!='Path' or Path(job['RootPath']).resolve()!=root.resolve() or Path(job['ProjectDirectory']).resolve()!=lab_directory().resolve() or \
       new.resolve()!=(root/job['RelativePath']).resolve() or old.parent.resolve()!=directory.resolve() or new.parent.resolve()!=directory.resolve() or \
       not new.resolve().is_relative_to(root.resolve()) or \
       old.suffix!=new.suffix or old.suffix.lower()!=scope['extension'] or not new.name.startswith(scope['prefix']):
        return reply('Waiting','Accepted adapter supports only isolated same-directory, same-format path controls')
    if any(p.lstat().st_file_attributes&0x400 for p in [new,*new.parents] if p.is_relative_to(root)):
        return reply('Conflict','Linked source refused')
    if canonical(old)==canonical(new):return reply('Conflict','No path change')
    if not new.is_file() or new.stat().st_size!=job['Size'] or digest(new).casefold()!=job['Hash'].casefold():
        return reply('Waiting','Source revision is not stable')
    if job['Hash'].casefold()!=accepted_hash.casefold():return reply('Waiting','Content replacement is not part of this path-only route')
    record_path=run/'source-path-journal.json'
    record=json.loads(record_path.read_text(encoding='utf8')) if record_path.exists() else {'stage':'planned','job':job}
    if record['job']!=job:return reply('Conflict','Queue job changed')
    def save():atomic(record_path,record)
    if record['stage']=='conflict':return reply('Conflict',record['reason'])
    if record['stage']=='completed':
        current=load(lab_directory());owned=[v for v in rows(current) if v['id'] in expected_aliases]
        sources=[v for v in current['timeline']['materials'][group] if v['id']==source_id]
        if sorted(v['id'] for v in owned)!=expected_aliases or len(sources)!=1 or \
           any(canonical(v['file_Path'])!=canonical(new) for v in owned) or canonical(sources[0]['path'])!=canonical(new):
            return reply('Conflict','Completed source ownership changed')
        return reply('Verified')
    if record['stage']=='planned':
        try:validate(main_pid(),build='9.6.0.4097')
        except (RuntimeError,OSError,ValueError,subprocess.SubprocessError):
            return reply('Waiting','Open the isolated lab project before applying this queued path change')
        before=load(lab_directory());aliases=[v for v in rows(before) if canonical(v.get('file_Path',''))==canonical(old)]
        sources=[v for values in before['timeline']['materials'].values() if isinstance(values,list) for v in values
                 if isinstance(v,dict) and canonical(v.get('path',''))==canonical(old)]
        if sorted(v['id'] for v in aliases)!=expected_aliases or len(sources)!=1 or sources[0]['id']!=source_id or \
           not any(v['id']==source_id for v in before['timeline']['materials'][group]):
            return reply('Conflict','Exact bin/source identity differs from the accepted scope')
        if any(v.get('extra_info')!=old.name for v in aliases):return reply('Waiting','Custom bin labels require a separate name policy')
        if material!=MATERIAL:
            baseline=accepted_baseline(scope)
            if any(parent_edges(before,alias)!=parent_edges(baseline,alias) for alias in expected_aliases):
                return reply('Conflict','Owned bin folder changed since acceptance')
        elif parent_edges(before,material)!=[{'child_id':material,'parent_id':'f3fd343f-a805-42f7-9109-49e1dc8da258'}]:
            return reply('Conflict','Owned bin is outside the accepted ManagedB folder')
        if any(canonical(v.get('file_Path',''))==canonical(new) for v in rows(before)):
            return reply('Conflict','Destination already belongs to another material')
        original_manifest=json.loads(manifest_path.read_text(encoding='utf8'))
        native_proof=json.loads((ROOT/'artifacts/SdkModelProbe/1792059078966742900/model-report.json').read_text(encoding='utf8'))
        try:
            if material==MATERIAL:preimage,restored_fields=source_preimage(sources[0],old,job['Hash'])
            else:
                # The MP4 missing-load reset has not been proven for audio/MOV.
                # Use current edit properties; refuse identity loss rather than
                # restoring audio/AI properties from a historical snapshot.
                accepted=baseline
                previous=next(v for v in accepted['timeline']['materials'][group] if v['id']==source_id)
                for key in ('unique_id','category_name','local_material_id','is_copyright'):
                    if sources[0].get(key)!=previous.get(key):raise ValueError('Source identity changed; automatic repair is not proven for this scope')
                preimage,restored_fields=deepcopy(sources[0]),[]
        except ValueError as error:return reply('Conflict',str(error))
        if scope.get('binPreflight'):
            from live_relink_lab import command
            preflight=command({'id':job['Id'],'materialId':material,'oldPath':str(old),'newPath':str(new),
                               'hash':job['Hash'],'relatedMaterialIds':expected_aliases},run,0,scope['binModule'])
            atomic(run/'source-bin-preflight.json',preflight)
            if preflight.get('status')!='ready':return reply('Conflict',preflight.get('reason','Bin preflight not confirmed'))
        snapshot(lab_directory(),run/'source-before')
        payload={'id':job['Id'],'projectId':LAB_ID,'sourceId':source_id,'metaPath':str(lab_directory()/'draft_meta_info.json'),
                 'baselineTimeline':before['timeline'],'restoreProperties':preimage,
                 'newName':new.name if preimage.get(scope['nameField'])==old.name else preimage.get(scope['nameField'],''),
                 'newPath':str(new).replace('\\','/'),'exports':original_manifest['exports'],'draftVtableRva':native_proof['draftVtableRva']}
        record.update(stage='dispatchingSource',dispatchedAt=time.time(),plan={'id':job['Id'],'materialId':material,
            'old':str(old),'new':str(new),'extension':scope['extension'],'hash':job['Hash'],
            'newSourceName':payload['newName'],'relatedMaterialIds':expected_aliases});save()
        if restored_fields:
            record['plan']['restoreIdentityFrom']=preimage
            record['restoredStockIdentityFields']=restored_fields;save()
        source_command(payload,run,scope['module'])
    if record['stage']=='dispatchingSource':
        path=run/'source-receipt.json'
        if not path.exists():return reply('Unknown','No source receipt; command will not be repeated')
        receipt=json.loads(path.read_text(encoding='utf8'))
        if receipt.get('jobId')!=job['Id']:return reply('Conflict','Source receipt belongs to another job')
        if receipt.get('status')!='changed' or not receipt.get('wholeSdkDraftExact'):
            return reply('Unknown',receipt.get('reason','Source result not confirmed'))
        record['stage']='dispatchingBin';save()
        from live_relink_lab import command
        native={'id':job['Id'],'materialId':material,'oldPath':str(old),'newPath':str(new),'hash':job['Hash'],
                'relatedMaterialIds':expected_aliases}
        result=command(native,run,3,scope.get('binModule','CapSync.NativeRelinkR4097V14.dll'))
        atomic(run/'source-bin-receipt.json',result)
    if record['stage']=='dispatchingBin':
        path=run/'source-bin-receipt.json'
        if not path.exists():
            saved=[json.loads(p.read_text(encoding='utf8')) for p in (run/'evidence').glob('native-relink-3-*.json')]
            matching=[r for r in saved if r.get('jobId')==job['Id'] and r.get('status')=='changed']
            if len(matching)==1:atomic(path,matching[0])
            else:return reply('Unknown','No unique bin receipt; command will not be repeated')
        receipt=json.loads(path.read_text(encoding='utf8'))
        if receipt.get('jobId')!=job['Id']:return reply('Conflict','Bin receipt belongs to another job')
        if receipt.get('status')!='changed':return reply('Unknown',receipt.get('reason','Bin result not confirmed'))
        time.sleep(3)
        if not (run/'source-after').exists():snapshot(lab_directory(),run/'source-after')
        result=check(load(run/'source-before'),load(run/'source-after'),record['plan'],scope)
        atomic(run/'source-immediate-check.json',result)
        if not result['accepted']:
            record.update(stage='conflict',reason='; '.join(result['errors']));save();return reply('Conflict',record['reason'])
        record['stage']='verifyingSave';save()
    if record['stage']=='verifyingSave':
        time.sleep(max(0,30-(time.time()-record['dispatchedAt'])))
        if not (run/'source-after-save').exists():snapshot(lab_directory(),run/'source-after-save')
        result=check(load(run/'source-before'),load(run/'source-after-save'),record['plan'],scope)
        atomic(run/'source-saved-check.json',result)
        record.update(stage='completed' if result['accepted'] else 'conflict',reason=None if result['accepted'] else '; '.join(result['errors']));save()
        if result['accepted'] and material==MATERIAL:
            properties=next(v for v in load(run/'source-after-save')['timeline']['materials']['videos'] if v['id']==SOURCE)
            remember_source(properties,new,job['Hash'],run/'source-after-save')
        return reply('Verified' if result['accepted'] else 'Conflict',record['reason'])
    return reply('Unknown','Unrecognized source-path journal stage')
