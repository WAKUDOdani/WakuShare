"""Fresh format batch: exact owned IDs, no observer or conflicted-job replay.

One import and one relink per source; all detailed receipts stay on disk.
"""
import argparse
from contextlib import ExitStack
from copy import deepcopy
import ctypes as C
import json
import msvcrt
from pathlib import Path
import shutil
import time
import uuid

from compare_lab_timeline import compare
from diagnose_bin_reset import sdk_material
from live_add import atomic, canonical, digest, execute as add, main_pid, rows
from live_relink_lab import command
from live_update import preservation, source_referenced
from load_native_lab import ROOT, LAB_ID, identity, lab_directory, snapshot
from qt_live_read import Reader
from test_secondary_path_control import observer_off
from verify_native_import import load

DLL='CapSync.NativeRelinkR4097V9.dll'
TEMPLATES={'.png':'second.png','.jpg':'image-synced.jpg','.jpeg':'image-synced.jpg',
    '.gif':'animation-synced.gif','.wav':'tone-synced.wav','.mp3':'tone-synced.mp3',
    '.mp4':'video-synced.mp4','.mov':'video-synced.mov'}


def state_locks(stack):
    state=ROOT/'artifacts/LiveAddLab/state.json'
    for suffix in ('.executor.lock','.lock'):
        handle=stack.enter_context(Path(str(state)+suffix).open('a+b'))
        if handle.tell()==0:
            handle.write(b'0');handle.flush()
        handle.seek(0);msvcrt.locking(handle.fileno(),msvcrt.LK_NBLCK,1)
    return state


def batch_compare(before,after,plans,reopened=False,stock_metadata=False):
    baseline=deepcopy(before)
    normalized=deepcopy(after);errors=[]
    stock_changes=[]
    if stock_metadata:
        # Exact behavior observed in a user-performed stock relink in a clean
        # process. This exception is lab-only; all other fields remain strict.
        service='cd484075-d92a-4bc9-b45c-d093d2f9e71b'
        left={r['id']:r for r in rows(baseline)};right={r['id']:r for r in rows(normalized)}
        if (service in left)!=(service in right):
            known=next(r for r in rows(load(ROOT/'research/evidence/sdk-writer-trace-1791981808822115600/afterCrashAudit')) if r['id']==service)
            actual=left.get(service,right.get(service))
            shape=lambda r:{k:v for k,v in r.items() if k not in {'create_time','import_time','import_time_ms'}}
            if shape(actual)!=shape(known) or actual.get('file_Path') or actual.get('metetype')!='none':
                errors.append('Unexpected service record shape')
            else:
                stock_changes.append({'serviceRow':service,'before':left.get(service),'after':right.get(service)})
                for doc in (baseline,normalized):
                    for group in doc['meta']['draft_materials']:
                        group['value']=[r for r in group.get('value',[]) if r['id']!=service]
    current={r['id']:r for r in rows(normalized)}
    original={r['id']:r for r in rows(baseline)}
    for plan in plans:
        row=current.get(plan['materialId']);old=original.get(plan['materialId'])
        if row is None or old is None or canonical(row.get('file_Path',''))!=canonical(plan['new']) or row.get('extra_info')!=Path(plan['new']).name:
            errors.append('Owned path/name absent: '+plan['extension']);continue
        row['file_Path']=old['file_Path'];row['extra_info']=old['extra_info']
        if stock_metadata:
            for key in ('create_time','import_time','import_time_ms'):
                if row.get(key)!=old.get(key):
                    if row.get(key)!=0 or not isinstance(old.get(key),int) or old[key]<0:
                        errors.append('Unexpected stock timestamp change: '+key)
                    else:
                        stock_changes.append({'id':plan['materialId'],'field':key,'before':old[key],'after':0})
                        row[key]=old[key]
    timeline=None;accounting=None
    if reopened:
        timeline=compare(before['timeline'],after['timeline'])
        if not timeline['equivalentExceptAudioHelperIds']:
            errors.extend(timeline['errors'])
        normalized['timeline']=before['timeline']
        key='draft_timeline_materials_size_'
        accounting={k:v['meta'].get(key) for k,v in [('before',before),('after',after)]}
        if not all(isinstance(v,int) and v>=0 for v in accounting.values()):
            errors.append('Unexpected aggregate accounting')
        normalized['meta'][key]=before['meta'][key]
    plan=plans[0]
    check=preservation(baseline,normalized,{'MaterialId':plan['materialId'],'SourcePath':plan['old']},[])
    errors.extend(check['errors'])
    return {'accepted':not errors,'errors':errors,'wholeDocuments':check,'timeline':timeline,'accounting':accounting,'observedStockChanges':stock_changes}


def source_checks(plans):
    reader=Reader(main_pid())
    results=[]
    try:
        creator=next(m for m in reader.modules if m['name'].lower()=='vecreator.dll')
        for plan in plans:
            new=Path(plan['new'])
            if not new.is_file() or digest(new)!=plan['hash']:
                raise ValueError('Applied source bytes missing or changed: '+plan['extension'])
            sdk=sdk_material(reader,creator,plan['materialId'])
            if canonical(sdk['material']['path'])!=canonical(new):
                raise ValueError('SDK path differs: '+plan['extension'])
            results.append({'extension':plan['extension'],'sdk':sdk,'hash':plan['hash']})
    finally:
        reader.close()
    return results


def reserve_old_paths(run,journal):
    """One move attempt for each strictly unreferenced old fixture, no loop."""
    catalog=load(lab_directory())
    for plan in journal['plans']:
        old,new=Path(plan['old']),Path(plan['new'])
        if not old.exists():
            continue
        if any(r.get('file_Path') and canonical(r['file_Path'])==canonical(old) for r in rows(catalog)) or source_referenced(catalog['timeline'],old):
            raise ValueError('Old path still referenced; never remove it')
        if digest(old)!=plan['hash'] or digest(new)!=plan['hash']:
            raise ValueError('Fixture bytes changed before reserve')
        reserve=run/('reserved-old'+plan['extension'])
        if reserve.exists():
            raise ValueError('Reserve already occupied')
        plan['reserve']=str(reserve);plan['reserveStage']='dispatchingMove'
        atomic(run/'journal.json',journal)
        try:
            old.rename(reserve)
            plan['reserveStage']='moved'
        except OSError as error:
            if error.winerror!=32:
                raise
            plan['reserveStage']='fileLockedRetained'
        atomic(run/'journal.json',journal)
    return [p['extension'] for p in journal['plans'] if Path(p['old']).exists()]


def recover_sources(journal):
    root=(ROOT/'research/fixtures/AutoAddLab').resolve()
    for plan in journal['plans']:
        old,new=Path(plan['old']),Path(plan['new'])
        if not all(p.resolve().is_relative_to(root) for p in (old,new)):
            raise ValueError('Recovery escaped fixture root')
        if not old.exists() and new.is_file():
            shutil.copyfile(new,old)
            plan['recovery']='oldCopySuppliedNewKept'


def accept(run,stack):
    run=run.resolve()
    if not run.is_relative_to((ROOT/'research/evidence').resolve()):
        raise ValueError('Owned evidence required')
    journal=json.loads((run/'journal.json').read_text(encoding='utf8'))
    if journal['stage']!='boundedPassedAwaitingReopen':
        raise ValueError('Only one ready batch may be accepted; never replay')
    identity();observer_off();state=state_locks(stack);state_before=state.read_bytes()
    snapshot(lab_directory(),run/'reopened')
    before,after=load(run/'beforeRename'),load(run/'reopened')
    check=batch_compare(before,after,journal['plans'],True,journal.get('stockModelRoute',False))
    if check['accepted']:
        try:
            atomic(run/'sources-reopened.json',source_checks(journal['plans']))
        except Exception as error:
            check['accepted']=False;check['errors'].append(str(error))
    if state.read_bytes()!=state_before:
        check['accepted']=False;check['errors'].append('Observer state changed')
    atomic(run/'reopen-comparison.json',check)
    if not check['accepted']:
        recover_sources(journal);journal['stage']='reopenFailedRecovered'
    else:
        # If a decoder held an old path before reopening, reserve that old
        # copy now. The successful reopen is recorded with its actual scope.
        previously_retained=journal['retainedOldPaths']
        retained=reserve_old_paths(run,journal)
        journal.update(stage='reopenAccepted',retainedOldPaths=retained,
            reopenTestedWithoutOldPaths=not previously_retained)
    atomic(run/'journal.json',journal)
    print(json.dumps({'acceptedAfterReopen':check['accepted'],'errors':check['errors'],
        'formats':len(journal['plans']),'oldPathsStillRetained':journal.get('retainedOldPaths'),
        'reopenTestedWithoutOldPaths':journal.get('reopenTestedWithoutOldPaths'),
        'evidence':str(run)},ensure_ascii=True))


def start(stack,copy_only=False,no_identity_between_relinks=False):
    identity();observer_off();state=state_locks(stack);state_before=state.read_bytes()
    root=ROOT/'research/fixtures/AutoAddLab';project=lab_directory()
    token=uuid.uuid4().hex[:8]
    run=ROOT/'research/evidence'/f'secondary-path-batch-{time.time_ns()}'
    (run/'evidence').mkdir(parents=True)
    journal={'stage':'prepared','plans':[],'dll':DLL,'copyOnlyControl':copy_only,
             'omitRootHelpBetweenRelinks':no_identity_between_relinks}
    atomic(run/'journal.json',journal);snapshot(project,run/'beforeImport')
    imports=ROOT/'artifacts/SecondaryPathBatch'/token;imports.mkdir(parents=True)
    try:
        templates={k:v for k,v in TEMPLATES.items() if k in {'.png','.jpg'}} if copy_only else TEMPLATES
        for extension,template in templates.items():
            source=root/template;old=root/f'metadata-path-control-{token}{extension}'
            new=root/f'metadata-path-control-{token}-renamed{extension}'
            if not source.is_file() or old.exists() or new.exists():
                raise ValueError('Fresh format fixture unavailable')
            shutil.copyfile(source,old)
            job={'Id':str(uuid.uuid4()),'BindingId':str(uuid.uuid4()),'ProjectId':LAB_ID,
                'ProjectDirectory':str(project),'RootPath':str(root),'SourcePath':str(old),
                'RelativePath':old.name,'SourceVersion':1,'Hash':digest(old),'Size':old.stat().st_size,
                'MediaFolderId':'f3fd343f-a805-42f7-9109-49e1dc8da258'}
            journal.update(stage='importingOnce',current=extension);atomic(run/'journal.json',journal)
            reply=add(job,imports);atomic(run/('import'+extension+'.json'),reply)
            if reply['Status']!='Verified':
                raise ValueError('Import unconfirmed: '+extension+' '+str(reply.get('Reason')))
            plan={'extension':extension,'old':str(old),'new':str(new),'hash':job['Hash'],
                'materialId':reply['MaterialId'],'id':str(uuid.uuid4()),'physicalIdBefore':old.stat().st_ino}
            journal['plans'].append(plan);atomic(run/'journal.json',journal)
        # The previous rapid batch showed SDK resets while UI paths survived.
        # Let the stock import completion callbacks settle before this new,
        # independent batch; never repeat a reverted command from that batch.
        journal['stage']='waitingForStockImportCompletion';atomic(run/'journal.json',journal)
        time.sleep(30)
        before=load(project);snapshot(project,run/'beforeRename')
        if any(source_referenced(before['timeline'],Path(p['old'])) for p in journal['plans']):
            raise ValueError('Fresh batch must be unused')
        applied=[]
        for plan in journal['plans']:
            old,new=Path(plan['old']),Path(plan['new'])
            journal.update(stage='preparingSource',current=plan['extension']);atomic(run/'journal.json',journal)
            if copy_only:
                shutil.copyfile(old,new);plan['physicalMode']='copyForMissingPathControl'
            else:
                try:
                    old.rename(new);plan['physicalMode']='rename'
                except OSError as error:
                    if error.winerror!=32:
                        raise
                    shutil.copyfile(old,new);plan['physicalMode']='copyBecauseFileLocked'
            request={'id':plan['id'],'oldPath':str(old),'newPath':str(new),
                'materialId':plan['materialId'],'relatedMaterialIds':[plan['materialId']],'hash':plan['hash']}
            preflight=command(request,run,0,DLL,check_identity=not no_identity_between_relinks);atomic(run/('preflight'+plan['extension']+'.json'),preflight)
            if preflight.get('status')!='ready':
                raise ValueError('Preflight rejected: '+plan['extension']+' '+str(preflight.get('reason')))
            plan['dispatchStage']='dispatchingOnce';journal['stage']='relinkingOnce';atomic(run/'journal.json',journal)
            reply=command(request,run,1,DLL,check_identity=not no_identity_between_relinks);atomic(run/('native'+plan['extension']+'.json'),reply)
            if reply.get('status')!='changed' or reply.get('secondaryPathAssigned') is not True:
                raise ValueError('Native write unconfirmed: '+plan['extension'])
            plan['dispatchStage']='confirmed';atomic(run/'journal.json',journal)
            applied.append(plan)
            time.sleep(2)
            current_check=batch_compare(before,load(project),applied)
            atomic(run/('comparison'+plan['extension']+'.json'),current_check)
            atomic(run/('sdk'+plan['extension']+'.json'),source_checks(applied))
            if not current_check['accepted']:
                raise ValueError('Whole-document comparison failed after '+plan['extension'])
        immediate=batch_compare(before,load(project),journal['plans'])
        atomic(run/'immediate-comparison.json',immediate)
        if not immediate['accepted']:
            raise ValueError('Immediate whole-document comparison failed')
        journal['stage']='observing';atomic(run/'journal.json',journal)
        time.sleep(30)
        atomic(run/'sources-after.json',source_checks(journal['plans']))
        retained=[p['extension'] for p in journal['plans']] if copy_only else reserve_old_paths(run,journal)
        snapshot(project,run/'after');check=batch_compare(before,load(run/'after'),journal['plans'])
        if state.read_bytes()!=state_before:
            check['accepted']=False;check['errors'].append('Observer state changed')
        atomic(run/'comparison.json',check)
        if not check['accepted']:
            raise ValueError('; '.join(check['errors']))
        journal.update(stage='boundedPassedAwaitingReopen',retainedOldPaths=retained)
    except Exception as error:
        journal.update(stage='stopped',reason=str(error));recover_sources(journal)
    atomic(run/'journal.json',journal)
    print(json.dumps({'stage':journal['stage'],'formats':len(journal['plans']),
        'physicalModes':{p['extension']:p.get('physicalMode') for p in journal['plans']},
        'retainedOldPaths':journal.get('retainedOldPaths'),'reason':journal.get('reason'),
        'evidence':str(run)},ensure_ascii=True))


def order_control(stack,remaining=False,full_map=False,stock_model=False):
    """Previously untouched lab leaves; no new import or observer scan."""
    identity();observer_off();state=state_locks(stack);state_before=state.read_bytes()
    run=ROOT/'research/evidence'/f'relink-order-{time.time_ns()}'
    (run/'evidence').mkdir(parents=True)
    project=lab_directory();before=load(project);snapshot(project,run/('beforeImport' if full_map or stock_model else 'beforeRename'))
    ids=('4722e5c3-ecdd-48a4-af5a-61c98b5cd71b','ab2b1092-b252-44c8-8a8d-341010b394bb')
    if remaining:
        previous=json.loads((ROOT/'research/evidence/secondary-path-batch-1791980051824606700/journal.json').read_text(encoding='utf8'))
        ids=tuple(p['materialId'] for p in previous['plans'] if p['extension'] in {'.wav','.mp3','.mp4','.mov'})
        if len(ids)!=4:raise ValueError('Incomplete existing control identities')
    dll='CapSync.NativeRelinkR4097V12.dll' if stock_model else ('CapSync.NativeRelinkR4097V11.dll' if full_map else 'CapSync.NativeRelinkR4097V10.dll')
    plans=[];journal={'stage':'prepared','plans':plans,'dll':dll,'fullMapRoute':full_map,'stockModelRoute':stock_model}
    atomic(run/'journal.json',journal)
    try:
        if full_map or stock_model:
            root=ROOT/'research/fixtures/AutoAddLab'
            selected=[];token=uuid.uuid4().hex[:8]
            templates=[('.mp3','tone-synced.mp3'),('.mov','video-synced.mov')] if stock_model else [('.mp3','tone-synced.mp3')]
            for suffix,template in templates:
                fresh=root/('metadata-path-control-'+token+suffix)
                shutil.copyfile(root/template,fresh)
                add_job={'Id':str(uuid.uuid4()),'BindingId':str(uuid.uuid4()),'ProjectId':LAB_ID,
                    'ProjectDirectory':str(project),'RootPath':str(root),'SourcePath':str(fresh),
                    'RelativePath':fresh.name,'SourceVersion':1,'Hash':digest(fresh),'Size':fresh.stat().st_size,
                    'MediaFolderId':'f3fd343f-a805-42f7-9109-49e1dc8da258'}
                imports=ROOT/'artifacts/FullMapControl'/uuid.uuid4().hex;imports.mkdir(parents=True)
                journal.update(stage='importingFreshControl',importJob=add_job);atomic(run/'journal.json',journal)
                reply=add(add_job,imports);atomic(run/('import'+suffix+'.json'),reply)
                if reply['Status']!='Verified':raise ValueError('Fresh import unconfirmed: '+str(reply))
                selected.append(reply['MaterialId'])
            ids=tuple(selected) if stock_model else (selected[0],'b0753f8d-f4e5-438f-b4a9-e5f48ea52d18')
            journal['stage']='waitingForStockImportSave';atomic(run/'journal.json',journal)
            time.sleep(30)
            before=load(project);snapshot(project,run/'beforeRename')
        for material_id in ids:
            row=next(r for r in rows(before) if r['id']==material_id)
            old=Path(row['file_Path']);new=old.with_name(old.stem+('-bin-v12' if stock_model else ('-map-v11' if full_map else '-order-v10'))+old.suffix)
            if not old.is_file() or new.exists() or source_referenced(before['timeline'],old):
                raise ValueError('Control unavailable, already attempted, or used on timeline')
            plan={'extension':old.suffix,'old':str(old),'new':str(new),'hash':digest(old),
                  'materialId':material_id,'id':str(uuid.uuid4())}
            plans.append(plan);atomic(run/'journal.json',journal)
        for index,plan in enumerate(plans):
            shutil.copyfile(plan['old'],plan['new'])
            request={'id':plan['id'],'oldPath':plan['old'],'newPath':plan['new'],
                     'materialId':plan['materialId'],'hash':plan['hash']}
            preflight=command(request,run,0,journal['dll']);atomic(run/f'preflight-{index}.json',preflight)
            if preflight.get('status')!='ready':raise ValueError(str(preflight))
            journal['stage']='dispatchingOnce';plan['dispatchStage']='dispatchingOnce';atomic(run/'journal.json',journal)
            reply=command(request,run,1,journal['dll']);atomic(run/f'native-{index}.json',reply)
            plan['dispatchStage']='confirmed' if reply.get('status')=='changed' else 'unconfirmed'
            atomic(run/'journal.json',journal)
            if reply.get('status')!='changed':raise ValueError(str(reply))
            time.sleep(2)
            check=batch_compare(before,load(project),plans[:index+1],stock_metadata=stock_model);atomic(run/f'comparison-{index}.json',check)
            atomic(run/f'sdk-{index}.json',source_checks(plans[:index+1]))
            if not check['accepted']:raise ValueError('; '.join(check['errors']))
        journal['stage']='waitingForStockSave';atomic(run/'journal.json',journal)
        time.sleep(30)
        snapshot(project,run/'after');check=batch_compare(before,load(run/'after'),plans,stock_metadata=stock_model)
        atomic(run/'comparison.json',check);atomic(run/'sdk-after.json',source_checks(plans))
        if not check['accepted'] or state.read_bytes()!=state_before:raise ValueError('Persistence or observer state changed')
        retained=reserve_old_paths(run,journal)
        snapshot(project,run/'withoutOldPaths')
        check=batch_compare(before,load(run/'withoutOldPaths'),plans,stock_metadata=stock_model)
        atomic(run/'without-old-comparison.json',check);atomic(run/'without-old-sdk.json',source_checks(plans))
        if not check['accepted']:raise ValueError('Source reserve conflict')
        journal.update(stage='boundedPassedAwaitingReopen',retainedOldPaths=retained)
    except Exception as error:
        journal.update(stage='stopped',reason=str(error))
    atomic(run/'journal.json',journal)
    print(json.dumps({'stage':journal['stage'],'reason':journal.get('reason'),'evidence':str(run)}))


def reserve_on_close(run):
    """One old-fixture reserve after the current editor exits; never edit drafts."""
    run=run.resolve()
    if not run.is_relative_to(ROOT/'research/evidence'):raise ValueError('Owned case required')
    journal=json.loads((run/'journal.json').read_text(encoding='utf8'))
    if journal['stage']!='boundedPassedAwaitingReopen' or not journal.get('stockModelRoute'):
        raise ValueError('Only the confirmed V12 case may await its first reopen')
    identity();observer_off();pid=main_pid()
    k=C.WinDLL('kernel32',use_last_error=True)
    k.OpenProcess.argtypes=[C.c_uint32,C.c_int,C.c_uint32];k.OpenProcess.restype=C.c_void_p
    k.WaitForSingleObject.argtypes=[C.c_void_p,C.c_uint32];k.WaitForSingleObject.restype=C.c_uint32
    k.CloseHandle.argtypes=[C.c_void_p];k.CloseHandle.restype=C.c_int
    handle=k.OpenProcess(0x100000,False,pid)
    if not handle:raise C.WinError(C.get_last_error())
    atomic(run/'close-reserve.json',{'stage':'waitingForEditorExit','pid':pid})
    print(json.dumps({'stage':'waitingForEditorExit','pid':pid}),flush=True)
    try:
        deadline=time.monotonic()+180
        while k.WaitForSingleObject(handle,1000)==258:
            if time.monotonic()>=deadline:raise TimeoutError('No editor exit; no fixture moved')
    finally:k.CloseHandle(handle)
    snapshot(lab_directory(),run/'closedBeforeReserve')
    check=batch_compare(load(run/'beforeRename'),load(run/'closedBeforeReserve'),journal['plans'],stock_metadata=True)
    atomic(run/'closed-comparison.json',check)
    if not check['accepted']:raise ValueError('Close-time conflict; no fixture moved')
    retained=reserve_old_paths(run,journal)
    journal['retainedOldPaths']=retained;atomic(run/'journal.json',journal)
    atomic(run/'close-reserve.json',{'stage':'reserved' if not retained else 'oldFixtureStillLocked','pid':pid,'retainedOldPaths':retained})
    print(json.dumps({'closedComparisonAccepted':True,'retainedOldPaths':retained}),flush=True)


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--accept',type=Path)
    parser.add_argument('--reserve-on-close',type=Path,help='Reserve the locked old fixture during the requested editor restart')
    parser.add_argument('--copy-only-control',action='store_true',help='Two files, retain old paths to isolate file-loss callbacks')
    parser.add_argument('--order-control',action='store_true',help='V10 ordering on two unused existing controls; no imports')
    parser.add_argument('--remaining-order-control',action='store_true',help='V10 ordering on the four untouched audio/video controls')
    parser.add_argument('--full-map-control',action='store_true',help='V11 full-list transaction on one fresh MP3 and the untouched MOV')
    parser.add_argument('--stock-model-control',action='store_true',help='V12 stock bin-model route on two fresh MP3/MOV controls')
    parser.add_argument('--no-identity-between-relinks',action='store_true',help='Pinned V9 validates the active project natively; test omission of root-help IPC')
    args=parser.parse_args()
    with ExitStack() as stack:
        if args.reserve_on_close:
            reserve_on_close(args.reserve_on_close)
        elif args.order_control or args.remaining_order_control or args.full_map_control or args.stock_model_control:
            order_control(stack,args.remaining_order_control,args.full_map_control,args.stock_model_control)
        elif args.accept:
            accept(args.accept,stack)
        else:
            start(stack,args.copy_only_control,args.no_identity_between_relinks)


if __name__=='__main__':
    main()
