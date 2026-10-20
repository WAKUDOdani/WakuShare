"""Journaled general PNG/JPEG path updates, restricted to the existing lab.

No mouse/focus, cache work, clip recreation, source-template repair or replay.
An unused card skips timeline commands entirely. Multiple independent source
objects, shared bin aliases and custom display names wait for their adapters.
"""
import argparse
from copy import deepcopy
import json
import msvcrt
import os
from pathlib import Path
import time
from live_add import atomic,canonical,command as move_card,digest,main_pid,parent_edges,rows
from live_relink_lab import command as bin_command
from live_source_path import source_command,acceptance,SCOPES,PNG_MATERIAL
from live_update import StableFile
from load_native_lab import ROOT,LAB_ID,identity,lab_directory,snapshot
from native_png_card_control import verify_sdk_registry
from photo_path_plan import UnsupportedPhotoPlan,plan as make_plan
from test_secondary_path_batch import batch_compare
from verify_native_import import load

def compare(before,after,plan,moved=False,reopened=False):
    return compare_many(before,after,[{**plan,'folderApplied':moved}],reopened)

def compare_many(before,after,plans,reopened=False):
    normalized=deepcopy(after);errors=[];bin_plans=[];alias_clocks=[]
    for plan in plans:
        bin_plans.append(plan)
        for alias in plan.get('linkedAliasRows',[]):
            if parent_edges(normalized,alias['id'])!=plan['linkedAliasEdges'][alias['id']]:errors.append('Linked alias parent differs')
            matching=[r for r in rows(normalized) if r['id']==alias['id']]
            clocks=('create_time','import_time','import_time_ms')
            if len(matching)==1 and all(alias.get(k)==-1 and matching[0].get(k)==0 for k in clocks):
                expected={**alias,'file_Path':matching[0]['file_Path'],'extra_info':plan.get('newBinNames',{}).get(alias['id'],plan['newBinName']),**{k:0 for k in clocks}}
                # Exact stock provisional row -1 -> persisted row 0, observed
                # on the controlled linked source UUID. No other row/field.
                if canonical(matching[0].get('file_Path',''))==canonical(plan['new']) and matching[0]==expected:
                    for k in clocks:matching[0][k]=-1
                    alias_clocks.append({'id':alias['id'],'fields':list(clocks),'before':-1,'after':0})
            bin_plans.append({**plan,'materialId':alias['id']})
        if 'newBinNames' in plan:
            for identifier,label in plan['newBinNames'].items():
                found=[r for r in rows(normalized) if r['id']==identifier]
                if len(found)!=1 or found[0].get('extra_info')!=label:errors.append('Owned custom display label differs')
                else:found[0]['extra_info']=Path(plan['new']).name
        moved=plan.get('folderApplied',plan['moving'])
        expected_parent=plan['destinationFolderId'] if moved else plan['oldFolderId']
        edges=parent_edges(normalized,plan['materialId'])
        if edges!=[{'child_id':plan['materialId'],'parent_id':expected_parent}]:errors.append('Photo parent differs')
        elif moved:edges[0]['parent_id']=plan['oldFolderId']
        if plan['sourceId']:
            group=plan.get('sourceGroup','videos');name=plan.get('nameField','material_name')
            for source_id in plan.get('sourceIds',[plan['sourceId']]):
                old=[v for v in before['timeline']['materials'][group] if v['id']==source_id]
                new=[v for v in normalized['timeline']['materials'][group] if v['id']==source_id]
                desired_name=plan.get('newSourceNames',{}).get(source_id,plan['newSourceName'])
                if len(old)!=1 or len(new)!=1 or canonical(new[0].get('path',''))!=canonical(plan['new']) or new[0].get(name)!=desired_name:
                    errors.append('Owned timeline photo path/name differs')
                else:
                    new[0]['path']=old[0]['path'];new[0][name]=old[0][name]
    result=batch_compare(before,normalized,bin_plans,stock_metadata=True,reopened=reopened)
    result['linkedAliasStockClocks']=alias_clocks
    result['errors']+=errors;result['accepted']=not result['errors'];return result

def completed(job,run,record):
    current=load(lab_directory());p=record['plan']
    owned=[v for v in rows(current) if v['id']==job['MaterialId']]
    expected=[{'child_id':job['MaterialId'],'parent_id':p['destinationFolderId']}]
    if len(owned)!=1 or canonical(owned[0].get('file_Path',''))!=canonical(p['new']) or owned[0].get('extra_info')!=p['newBinName'] or parent_edges(current,job['MaterialId'])!=expected:
        raise ValueError('Completed photo path changed independently')
    if p['sourceId']:
        found=[v for v in current['timeline']['materials']['videos'] if v['id']==p['sourceId']]
        if len(found)!=1 or canonical(found[0].get('path',''))!=canonical(p['new']):
            raise ValueError('Completed photo source changed independently')
    verify_sdk_registry(current,run/'sdk-completed-readback.json')

def execute(job,run,file_identity):
    def reply(status,reason=None):return {'JobId':job['Id'],'Status':status,
        'MaterialId':job['MaterialId'] if status=='Verified' else None,'Reason':reason}
    if os.environ.get('CAPSYNC_LAB_PHOTO_PATHS')!='1':return reply('Waiting','General photo paths are opt-in until accepted')
    native_root=ROOT/'research/fixtures/AutoAddLab'
    transfer=job.get('DestinationBindingId') is not None
    if transfer and os.environ.get('CAPSYNC_LAB_CROSS_BINDING')!='1':return reply('Waiting','Cross-binding photo transfers are opt-in')
    permitted_roots=(Path(job['RootPath']).resolve().is_relative_to(native_root.resolve()) and
                     Path(job['DestinationRootPath']).resolve().is_relative_to(native_root.resolve())) if transfer else canonical(job['RootPath'])==canonical(native_root)
    if job.get('ProjectId')!=LAB_ID or canonical(job['ProjectDirectory'])!=canonical(lab_directory()) or \
       not permitted_roots:
        return reply('Conflict','Outside isolated lab photo scope')
    run.mkdir(parents=True,exist_ok=True);marker=run/'photo-path.json'
    record=json.loads(marker.read_text(encoding='utf8')) if marker.exists() else {'job':job,'stage':'planned'}
    if record['job']!=job:return reply('Conflict','Durable photo path job changed')
    if record['stage']=='completed':
        completed(job,run,record);return reply('Verified')
    if record['stage']!='planned':return reply('Unknown','Prior photo path dispatch is never repeated; inspect receipts')
    identity();before=load(lab_directory())
    state_path=run.parent.parent/'state.json';state=json.loads(state_path.read_text(encoding='utf8'))
    links_path=state_path.with_name('source-links.json')
    links=json.loads(links_path.read_text(encoding='utf8')) if links_path.exists() else []
    try:p=make_plan(job,state,before,file_identity,links)
    except UnsupportedPhotoPlan as error:return reply('Waiting',str(error))
    except ValueError as error:return reply('Conflict',str(error))
    new=Path(p['new'])
    if not new.is_file() or new.stat().st_size!=job['Size'] or digest(new).casefold()!=job['Hash'].casefold():
        return reply('Superseded','Photo bytes changed before dispatch')
    if any(path.lstat().st_file_attributes&0x400 for path in (new,*new.parents) if path.is_relative_to(native_root)):
        return reply('Conflict','Linked photo path refused')
    snapshot(lab_directory(),run/'before')
    if load(run/'before')!=before:return reply('Conflict','Project changed during photo preflight')
    verify_sdk_registry(before,run/'sdk-before.json')
    record.update(plan=p,dispatchedAt=time.time());atomic(marker,record)
    if p['sourceId']:
        _,manifest=acceptance(SCOPES[PNG_MATERIAL]);exports=json.loads(manifest.read_text(encoding='utf8'))['exports']
        native=json.loads((ROOT/'artifacts/SdkModelProbe/1792059078966742900/model-report.json').read_text(encoding='utf8'))
        payload={'id':job['Id'],'projectId':LAB_ID,'materialId':job['MaterialId'],'sourceId':p['sourceId'],
            'rootPath':str(native_root),'metaPath':str(lab_directory()/'draft_meta_info.json'),
            'baselineTimeline':before['timeline'],'restoreProperties':p['timelineSources'][0],
            'newPath':p['new'].replace('\\','/'),'newName':p['newSourceName'],
            'exports':exports,'draftVtableRva':native['draftVtableRva']}
        record['stage']='dispatchingSource';atomic(marker,record)
        receipt=source_command(payload,run,'CapSync.NativePhotoSourcePath.dll')
        if receipt.get('jobId')!=job['Id'] or receipt.get('status')!='changed' or receipt.get('wholeSdkDraftExact') is not True or receipt.get('sourceRepairSkipped') is not True:
            return reply('Unknown','General photo source update not confirmed; no replay')
        # A source setter may not yet be on disk. Permit exactly the old saved
        # timeline or the intended path/name, with every other property equal.
        current=load(lab_directory());expected=deepcopy(before['timeline'])
        own=next(v for v in expected['materials']['videos'] if v['id']==p['sourceId'])
        own['path']=payload['newPath'];own['material_name']=payload['newName']
        if current['timeline'] not in (before['timeline'],expected):return reply('Conflict','Photo source changed unrelated timeline data')
        normalized=deepcopy(current);normalized['timeline']=before['timeline']
        check=batch_compare(before,normalized,[{**p,'new':p['old']}],stock_metadata=True)
        atomic(run/'source-before-bin-comparison.json',check)
        if not check['accepted']:return reply('Conflict','Unrelated change before bin update')
    record['stage']='dispatchingBin';atomic(marker,record)
    receipt=bin_command({'id':job['Id'],'materialId':job['MaterialId'],'oldPath':p['old'],'newPath':p['new'],
        'hash':job['Hash'],'relatedMaterialIds':[job['MaterialId']]},run,3,'CapSync.NativePhotoBinPath.dll')
    atomic(run/'bin-receipt.json',receipt)
    if receipt.get('jobId')!=job['Id'] or receipt.get('status')!='changed':return reply('Unknown','Photo bin update not confirmed; no replay')
    time.sleep(2)
    check=compare(before,load(lab_directory()),p);atomic(run/'bin-comparison.json',check)
    if not check['accepted']:return reply('Conflict','Photo bin preservation comparison differs')
    verify_sdk_registry(load(lab_directory()),run/'sdk-after-bin.json')
    if p['moving']:
        record['stage']='dispatchingFolder';atomic(marker,record)
        receipt=move_card(main_pid(),{**job,'RootPath':str(native_root),'MediaFolderId':p['destinationFolderId']},run,2,job['MaterialId'],'CapSync.NativePhotoTreeMove.dll')
        atomic(run/'folder-receipt.json',receipt)
        if receipt.get('jobId')!=job['Id'] or receipt.get('status')!='moved' or any(receipt.get(k) is not True for k in
            ('idPreserved','parentUpdated','fullSdkBinPreserved','focusUnchanged','navigationUnchanged','foregroundUnchanged','cursorUnchanged')):
            return reply('Unknown','General photo folder move not confirmed; no replay')
    snapshot(lab_directory(),run/'immediate');check=compare(before,load(run/'immediate'),p,p['moving'])
    atomic(run/'immediate-comparison.json',check)
    if not check['accepted']:return reply('Conflict','Immediate photo preservation comparison differs')
    record['stage']='verifyingSave';atomic(marker,record)
    time.sleep(max(0,min(30,30-(time.time()-record['dispatchedAt']))))
    snapshot(lab_directory(),run/'saved');check=compare(before,load(run/'saved'),p,p['moving'])
    atomic(run/'saved-comparison.json',check)
    if not check['accepted']:return reply('Conflict','Saved photo preservation comparison differs')
    verify_sdk_registry(load(run/'saved'),run/'sdk-saved.json')
    record['stage']='completed';atomic(marker,record);return reply('Verified')

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--request',type=Path,required=True);parser.add_argument('--journal',type=Path,required=True)
    args=parser.parse_args();request=args.request.resolve();journal=args.journal.resolve()
    if not journal.is_relative_to(ROOT/'artifacts') or request.parent!=journal:raise ValueError('Owned photo journal required')
    job=json.loads(request.read_text(encoding='utf8'))
    if request.name!=job['Id']+'.request.json':raise ValueError('Photo request identity differs')
    with (journal/'executor.lock').open('a+b') as handle:
        if not handle.tell():handle.write(b'0');handle.flush()
        handle.seek(0);msvcrt.locking(handle.fileno(),msvcrt.LK_NBLCK,1)
        try:
            try:source=StableFile(Path(job['SourcePath']))
            except OSError:result={'JobId':job['Id'],'Status':'Waiting','MaterialId':None,'Reason':'Photo source is busy'}
            else:
                try:
                    try:file_identity=source.identity()
                    except ValueError as error:
                        result={'JobId':job['Id'],'Status':'Conflict','MaterialId':None,'Reason':str(error)}
                    else:result=execute(job,journal/job['Id'],file_identity)
                finally:source.close()
        finally:handle.seek(0);msvcrt.locking(handle.fileno(),msvcrt.LK_UNLCK,1)
    print(json.dumps(result))

if __name__=='__main__':main()
