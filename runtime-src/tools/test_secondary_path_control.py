"""One fresh WAV control for the second native path hypothesis; observer stays off."""
import argparse
from copy import deepcopy
import json
from pathlib import Path
import shutil
import subprocess
import time
import uuid

from compare_lab_timeline import compare
from diagnose_bin_reset import sdk_material
from live_add import atomic, canonical, digest, execute as add, main_pid, rows
from live_relink_lab import command
from live_update import preservation, source_referenced
from load_native_lab import ROOT, LAB_ID, identity, lab_directory, snapshot
from qt_live_read import Reader
from verify_native_import import load

DLL = 'CapSync.NativeRelinkR4097V8.dll'


def observer_off():
    status = subprocess.run(['powershell', '-NoProfile', '-NonInteractive', '-Command',
        '@(Get-Process CapSync.Observer -ErrorAction SilentlyContinue).Count'],
        check=True, capture_output=True, text=True, timeout=5,
        creationflags=subprocess.CREATE_NO_WINDOW)
    if status.stdout.strip() != '0':
        raise ValueError('Observer must stay off')


def accept(run):
    run=run.resolve()
    if not run.resolve().is_relative_to((ROOT/'research/evidence').resolve()):
        raise ValueError('Owned evidence only')
    journal = json.loads((run/'journal.json').read_text(encoding='utf8'))
    no_alias=journal['stage']=='oldAliasRemovedAwaitingReopen'
    if journal['stage'] != 'boundedPassedAwaitingReopen' and not no_alias:
        raise ValueError('Completed bounded control required; never replay')
    identity(); observer_off()
    snapshot_name='reopenedWithoutOldAlias' if no_alias else 'reopened'
    baseline='afterOldAliasRemoval' if no_alias else 'after'
    snapshot(lab_directory(), run/snapshot_name)
    before, after = load(run/baseline), load(run/snapshot_name)
    normalized = deepcopy(after)
    timeline = compare(before['timeline'], after['timeline'])
    normalized['timeline'] = before['timeline']
    accounting = 'draft_timeline_materials_size_'
    delta = {k:v['meta'].get(accounting) for k,v in [('before',before),('after',after)]}
    if not all(isinstance(v,int) and v >= 0 for v in delta.values()):
        raise ValueError('Unexpected accounting field')
    normalized['meta'][accounting] = before['meta'][accounting]
    check = preservation(before, normalized, {'MaterialId':journal['materialId'],
        'SourcePath':journal['new']}, [])
    root=(ROOT/'research/fixtures/AutoAddLab').resolve()
    source=Path(journal['new'])
    if not source.resolve().is_relative_to(root) or not source.is_file() or digest(source)!=journal['request']['hash']:
        check['accepted']=False;check['errors'].append('Applied source missing or bytes changed')
    reader=Reader(main_pid())
    try:
        creator=next(m for m in reader.modules if m['name'].lower()=='vecreator.dll')
        sdk=sdk_material(reader,creator,journal['materialId'])
        if canonical(sdk['material']['path'])!=canonical(source):
            check['accepted']=False;check['errors'].append('Reopened SDK path differs')
    finally:
        reader.close()
    result = {'acceptedAfterReopen':check['accepted'] and timeline['equivalentExceptAudioHelperIds'],
              'otherData':check, 'timeline':timeline, 'accounting':delta, 'sdk':sdk,
              'appliedSourceHash':digest(source) if source.is_file() else None}
    atomic(run/('reopen-without-alias-comparison.json' if no_alias else 'reopen-comparison.json'), result)
    if not result['acceptedAfterReopen']:
        # Supply the old path only when CapCut restored it. Keep the new path.
        row = next(r for r in rows(after) if r['id']==journal['materialId'])
        old, new = Path(journal['old']), Path(journal['new'])
        root = (ROOT/'research/fixtures/AutoAddLab').resolve()
        if not all(p.resolve().is_relative_to(root) for p in (old,new)):
            raise ValueError('Recovery outside fixtures refused')
        if canonical(row['file_Path'])==canonical(old) and not old.exists():
            shutil.copyfile(new, old)
            journal['recovery']='oldPathCopiedNewKept'
        journal['stage']='reopenFailed'
    else:
        journal['stage']='reopenAcceptedWithoutOldAlias' if no_alias else 'reopenAcceptedSingleControl'
    atomic(run/'journal.json',journal)
    print(json.dumps(result,ensure_ascii=True))


def remove_old_alias(run):
    """Move only the now-unreferenced control fixture to its evidence reserve."""
    run=run.resolve()
    if not run.is_relative_to((ROOT/'research/evidence').resolve()):
        raise ValueError('Owned evidence required')
    journal=json.loads((run/'journal.json').read_text(encoding='utf8'))
    if journal['stage']!='reopenAcceptedSingleControl':
        raise ValueError('Accepted reopening required; do not repeat')
    identity();observer_off()
    old,new=Path(journal['old']),Path(journal['new'])
    root=(ROOT/'research/fixtures/AutoAddLab').resolve()
    if not all(p.resolve().is_relative_to(root) for p in (old,new)) or not old.is_file() or not new.is_file():
        raise ValueError('Owned control fixtures required')
    if digest(old)!=journal['request']['hash'] or digest(new)!=journal['request']['hash']:
        raise ValueError('Control bytes changed')
    before=load(lab_directory())
    if any(r.get('file_Path') and canonical(r['file_Path'])==canonical(old) for r in rows(before)) or source_referenced(before['timeline'],old):
        raise ValueError('Old path still referenced; retain it')
    backup=run/'reserved-old-fixture.wav'
    if backup.exists():
        raise ValueError('Reserve already used')
    snapshot(lab_directory(),run/'beforeOldAliasRemoval')
    journal.update(stage='movingUnreferencedOldAlias',oldAliasReserve=str(backup))
    atomic(run/'journal.json',journal)
    old.rename(backup)
    time.sleep(30)
    snapshot(lab_directory(),run/'afterOldAliasRemoval')
    after=load(run/'afterOldAliasRemoval')
    check=preservation(before,after,{'MaterialId':journal['materialId'],'SourcePath':str(new)},[])
    atomic(run/'old-alias-removal-comparison.json',check)
    if not check['accepted']:
        if not old.exists():
            shutil.copyfile(backup,old)
        journal['stage']='oldAliasRemovalFailedRecovered'
    else:
        journal['stage']='oldAliasRemovedAwaitingReopen'
    atomic(run/'journal.json',journal)
    print(json.dumps({'oldAliasAbsent':not old.exists(),'fullComparisonPassed':check['accepted'],
        'errors':check['errors'],'stage':journal['stage'],'evidence':str(run)},ensure_ascii=True))


def copy_control(run):
    """Continue only a filesystem-blocked control with zero native dispatches.

    Keeping both physical paths makes this a persistence control, not evidence
    of a successful filesystem rename or watcher integration.
    """
    run=run.resolve()
    if not run.is_relative_to((ROOT/'research/evidence').resolve()):
        raise ValueError('Owned evidence required')
    journal=json.loads((run/'journal.json').read_text(encoding='utf8'))
    filesystem_blocked=journal['stage']=='stopped' and '[WinError 32]' in journal.get('reason','')
    # Entry -2 returns synchronously before enqueueing perform(): only the
    # read-only preflight was rejected for a relative output path.
    entry_rejected=journal['stage']=='copyPreflightRejected' and journal.get('reason')=='entry -2'
    if not (filesystem_blocked or entry_rejected) or list((run/'evidence').glob('native-relink-*.json')):
        raise ValueError('Only an undispatched filesystem-blocked control may continue')
    identity();observer_off()
    old,new=Path(journal['old']),Path(journal['new'])
    root=(ROOT/'research/fixtures/AutoAddLab').resolve()
    if not all(p.resolve().is_relative_to(root) for p in (old,new)) or not old.is_file() or (new.exists() and not entry_rejected):
        raise ValueError('Fresh control paths changed')
    request=journal['request'];material=journal['materialId']
    before=load(lab_directory())
    row=next(r for r in rows(before) if r['id']==material)
    if canonical(row['file_Path'])!=canonical(old) or digest(old)!=request['hash'] or source_referenced(before['timeline'],old):
        raise ValueError('Control ownership/bytes changed')
    state_path=ROOT/'artifacts/LiveAddLab/state.json';state_before=state_path.read_bytes()
    before_name='beforeCopyControl-'+uuid.uuid4().hex
    snapshot(lab_directory(),run/before_name)
    journal['beforeCopyControlSnapshot']=before_name
    if entry_rejected:
        if digest(new)!=request['hash']:
            raise ValueError('Prepared copy bytes changed')
        atomic(run/'rejected-preflight-before-enqueue.json',json.loads((run/'preflight.json').read_text(encoding='utf8')))
    else:
        shutil.copyfile(old,new)
    journal.update(stage='copyControlPrepared',oldPhysicalPathRetained=True)
    atomic(run/'journal.json',journal)
    preflight=command(request,run,0,DLL);atomic(run/'preflight.json',preflight)
    if preflight.get('status')!='ready':
        journal.update(stage='copyPreflightRejected',reason=preflight.get('reason'))
        atomic(run/'journal.json',journal);raise ValueError('Preflight rejected; no repeat')
    journal['stage']='dispatchingOnce';atomic(run/'journal.json',journal)
    result=command(request,run,1,DLL);atomic(run/'native-result.json',result)
    if result.get('status')!='changed' or result.get('secondaryPathAssigned') is not True:
        journal.update(stage='nativeUnconfirmed',reason=result.get('reason'))
        atomic(run/'journal.json',journal);raise ValueError('Native result unconfirmed; no repeat')
    journal['stage']='observing';atomic(run/'journal.json',journal)
    time.sleep(30)
    snapshot(lab_directory(),run/'after');after=load(run/'after')
    check=preservation(before,after,{'MaterialId':material,'SourcePath':str(new)},[])
    reader=Reader(main_pid())
    try:
        creator=next(m for m in reader.modules if m['name'].lower()=='vecreator.dll')
        sdk=sdk_material(reader,creator,material)
        if canonical(sdk['material']['path'])!=canonical(new):
            check['accepted']=False;check['errors'].append('SDK reverted')
    finally:
        reader.close()
    if state_before!=state_path.read_bytes() or digest(old)!=request['hash'] or digest(new)!=request['hash']:
        check['accepted']=False;check['errors'].append('Fixture bytes or observer state changed')
    atomic(run/'comparison.json',check);atomic(run/'sdk-after.json',sdk)
    journal['stage']='boundedPassedAwaitingReopen' if check['accepted'] else 'copyControlFailed'
    atomic(run/'journal.json',journal)
    print(json.dumps({'boundedPassed':check['accepted'],'type':'bothPhysicalPathsRetained',
        'errors':check['errors'],'file':new.name,'evidence':str(run)},ensure_ascii=True))


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--accept',type=Path)
    parser.add_argument('--copy-control',type=Path)
    parser.add_argument('--remove-old-alias',type=Path)
    args=parser.parse_args()
    if args.accept:
        return accept(args.accept)
    if args.copy_control:
        return copy_control(args.copy_control)
    if args.remove_old_alias:
        return remove_old_alias(args.remove_old_alias)
    identity(); observer_off()
    state_path=ROOT/'artifacts/LiveAddLab/state.json'
    state_before=state_path.read_bytes()
    root=ROOT/'research/fixtures/AutoAddLab'; project=lab_directory()
    token=uuid.uuid4().hex[:8]
    old=root/f'metadata-path-control-{token}.wav'
    new=root/f'metadata-path-control-{token}-renamed.wav'
    run=ROOT/'research/evidence'/f'secondary-path-control-{time.time_ns()}'
    (run/'evidence').mkdir(parents=True)
    journal={'stage':'prepared','old':str(old),'new':str(new),'hypothesis':'secondNativePathStale'}
    atomic(run/'journal.json',journal)
    snapshot(project,run/'beforeImport')
    source=root/'tone-synced.wav'
    if not source.is_file() or old.exists() or new.exists():
        raise ValueError('Fresh fixture precondition failed')
    shutil.copyfile(source,old)
    job={'Id':str(uuid.uuid4()),'BindingId':str(uuid.uuid4()),'ProjectId':LAB_ID,
        'ProjectDirectory':str(project),'RootPath':str(root),'SourcePath':str(old),
        'RelativePath':old.name,'SourceVersion':1,'Hash':digest(old),'Size':old.stat().st_size,
        'MediaFolderId':'f3fd343f-a805-42f7-9109-49e1dc8da258'}
    import_journal=ROOT/'artifacts/SecondaryPathControl'/token
    import_journal.mkdir(parents=True)
    outcome=add(job,import_journal)
    atomic(run/'import-result.json',outcome)
    if outcome['Status']!='Verified':
        journal.update(stage='importStopped',reason=outcome.get('Reason'))
        atomic(run/'journal.json',journal)
        raise ValueError('Fresh control import unconfirmed; not repeating')
    material=outcome['MaterialId'];journal['materialId']=material
    before=load(project)
    if source_referenced(before['timeline'],old):
        raise ValueError('Control must be unused')
    snapshot(project,run/'beforeRename')
    request={'id':str(uuid.uuid4()),'materialId':material,'relatedMaterialIds':[material],
             'oldPath':str(old),'newPath':str(new),'hash':digest(old)}
    journal.update(stage='movingFreshFixture',request=request)
    atomic(run/'journal.json',journal)
    passed=False
    try:
        old.rename(new)
        preflight=command(request,run,0,DLL);atomic(run/'preflight.json',preflight)
        if preflight.get('status')!='ready':
            raise ValueError('Fresh control preflight rejected')
        journal['stage']='dispatchingOnce';atomic(run/'journal.json',journal)
        result=command(request,run,1,DLL);atomic(run/'native-result.json',result)
        if result.get('status')!='changed' or result.get('secondaryPathAssigned') is not True:
            raise ValueError('Second path write unconfirmed')
        journal['stage']='observing';atomic(run/'journal.json',journal)
        reader=Reader(main_pid())
        try:
            creator=next(m for m in reader.modules if m['name'].lower()=='vecreator.dll')
            deadline=time.monotonic()+30
            while True:
                check=preservation(before,load(project),{'MaterialId':material,'SourcePath':str(new)},[])
                sdk=sdk_material(reader,creator,material)
                if canonical(sdk['material']['path'])!=canonical(new):
                    check['accepted']=False;check['errors'].append('SDK path reverted')
                if not check['accepted'] or time.monotonic()>=deadline:
                    break
                time.sleep(min(1,deadline-time.monotonic()))
        finally:
            reader.close()
        snapshot(project,run/'after');atomic(run/'comparison.json',check)
        if not check['accepted']:
            raise ValueError('; '.join(check['errors']))
        if state_before!=state_path.read_bytes() or digest(new)!=request['hash']:
            raise ValueError('Observer state or fixture bytes changed')
        passed=True;journal['stage']='boundedPassedAwaitingReopen'
    except Exception as error:
        journal.update(stage='stopped',reason=str(error))
    finally:
        if not passed and new.is_file() and not old.exists():
            shutil.copyfile(new,old)
            journal['recovery']='oldPathCopiedNewKept'
        atomic(run/'journal.json',journal)
    print(json.dumps({'boundedPassed':passed,'stage':journal['stage'],
        'file':new.name,'reason':journal.get('reason'),'evidence':str(run)},ensure_ascii=True))


if __name__=='__main__':
    main()
