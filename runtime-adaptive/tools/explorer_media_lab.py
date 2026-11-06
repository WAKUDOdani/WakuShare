"""Guarded media path acceptance in the one authorized lab; no UI input/replay.

Each source has a fresh durable preimage, one Windows move, exact native
receipts, a complete immediate comparison and a second comparison after save.
Uncertain or conflicting work stops the whole run. Production stays gated.
"""
from copy import deepcopy
import argparse
import ctypes as C
import json
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import time
import uuid
from check_explorer_worker_protocol import Worker
from explorer_format_acceptance import RUN,FIXTURES
from explorer_native_runtime import Lease,Bin,Source,bootstrap,invoke as v2_invoke,photo_timeline,save_payload,template_exact,normalize_stock_service
from live_add import atomic,canonical,main_pid,rows,parent_edges
from live_photo_path import compare
from live_source_path import acceptance,SCOPES,PNG_MATERIAL
from live_update import StableFile
from load_native_lab import ROOT,LAB_ID,Loader,digest,identity,lab_directory,modules,snapshot,validate
from photo_path_plan import plan,MEDIA_FORMATS
from qt_meta_inventory import PE
from verify_native_import import load
from explorer_native_compat import require_vendor_imports

BUILD=ROOT/'artifacts/NativeExplorerObserveBuild'
BINARIES={key:BUILD/f'CapSync.ExplorerRuntime{key}V3.dll' for key in ('BinMedia','SourceMedia','TreeMedia')}
SEALED=ROOT/'artifacts/ExplorerMediaV3/manifest.json'

def prepare():
    proof=json.loads((RUN/'stock-import/journal.json').read_text(encoding='utf8'))
    controls=json.loads((RUN/'planner-controls.json').read_text(encoding='utf8'))
    if not proof['accepted'] or not controls['accepted']:raise ValueError('Accepted imports and negative controls required')
    base=Path.home()/'AppData/Local/CapCut/Apps/9.6.0.4097';missing=[]
    for key,dll in BINARIES.items():
        pe=PE(dll);nt=pe.u32(0x3c);pos=pe.offset(pe.base+pe.u32(nt+24+120))
        while any(pe.raw[pos:pos+20]):
            name=pe.cstring(pe.offset(pe.base+pe.u32(pos+12)));thunk=pe.u32(pos) or pe.u32(pos+16);pos+=20
            if not name.lower().startswith('qt6'):continue
            exports={entry['name'] for entry in PE(base/name).exports()};offset=pe.offset(pe.base+thunk)
            while True:
                value=struct.unpack_from('<Q',pe.raw,offset)[0];offset+=8
                if not value:break
                if value>>63:continue
                function=pe.cstring(pe.offset(pe.base+value)+2)
                if function not in exports:missing.append([key,name,function])
    if missing:raise ValueError('Vendor import mismatch: '+repr(missing))
    document={'build':'9.6.0.4097','runtimeVersion':3,'labOnly':True,'formats':MEDIA_FORMATS,'binaries':{key:digest(path) for key,path in BINARIES.items()},'missing':missing}
    if SEALED.exists() and json.loads(SEALED.read_text(encoding='utf8'))!=document:raise ValueError('Sealed V3 module changed; do not rebuild a loaded target')
    SEALED.parent.mkdir(parents=True,exist_ok=True)
    if not SEALED.exists():atomic(SEALED,document)
    return document

def invoke(pid,key,export,request,output,manifest_path=SEALED,binaries=BINARIES,staging_root=None,completion_timeout=15):
    import os
    from explorer_module_location_v1 import select_loaded
    manifest=json.loads(manifest_path.read_text(encoding='utf8'));dll=binaries[key];sha=manifest['binaries'][key]
    require_vendor_imports(dll)
    if digest(dll)!=sha:raise ValueError('Sealed binary changed')
    origin=staging_root or manifest_path.parent
    cache=os.environ.get('WAKUSHARE_NATIVE_CACHE')
    if cache:
        if not Path(cache).is_absolute():raise ValueError('Absolute private native cache required')
        origin=Path(cache)/origin.name
    staged=origin/sha[:16]/dll.name;staged.parent.mkdir(parents=True,exist_ok=True)
    if not staged.exists():shutil.copyfile(dll,staged)
    if digest(staged)!=sha:raise ValueError('Staged binary changed')
    loaded=modules(pid);present=[m for m in loaded if m['name'].casefold()==dll.name.casefold()]
    staged=select_loaded(staged,loaded,sha,digest,canonical,relocated=bool(cache))
    if output.exists():raise ValueError('No replay: native output already exists')
    output.parent.mkdir(parents=True,exist_ok=True);request.size=C.sizeof(type(request));request.version=(3 if hasattr(request,'desiredLabelsJson') else 2) if key=='BinMedia' else 1;request.output=str(output)
    pe=PE(staged);rva=int(next(e['rva'] for e in pe.exports() if e['name']==export),16)
    if not any(n=='.text' and a<=rva<a+s for n,a,_,s,_ in pe.sections):raise ValueError('Native export is not code')
    loader=Loader(pid)
    try:
        if not present and not loader.call(loader.library_entry(),(str(staged)+'\0').encode('utf-16le')):raise ValueError('V3 load failed')
        module=next(m for m in modules(pid) if canonical(m['path'])==canonical(staged))
        if loader.call(module['base']+rva,bytes(request))!=1:raise ValueError('V3 entry rejected; no replay')
    finally:loader.close()
    if not 0<completion_timeout<=120:raise ValueError('Invalid bounded command completion deadline')
    deadline=time.monotonic()+completion_timeout
    while not output.exists() and time.monotonic()<deadline:time.sleep(.05)
    if not output.exists():raise ValueError('V3 completion unknown; no replay')
    return json.loads(output.read_text(encoding='utf8'))

def lease(worker,token):
    reply,_=worker.request('status');editor=reply['result']['editor'];key=editor['Project']
    if editor['Status']!='Project' or not key or key['DraftId']!=LAB_ID.upper() or canonical(key['Location'])!=canonical(lab_directory()):raise ValueError('Lab session unavailable')
    return Lease(processId=editor['ProcessId'],viewEpoch=editor['ViewEpoch'],location=key['Location'].replace('\\','/'),draftId=key['DraftId'].encode('ascii'),token=token.encode('ascii'))

def run_one(case,worker,token,row,source_id=None,source_group=None,source_proof=None,source_boundary=None):
    if case.exists():raise ValueError('This media case already exists; no automatic replay')
    old=Path(row['file_Path']);new=old.with_stem('explorer-media-renamed-'+old.stem)
    if new.exists() or not old.is_file():raise ValueError('Media fixture was moved or target exists')
    stable=StableFile(old)
    try:physical=stable.identity();sha=digest(old);size=old.stat().st_size
    finally:stable.close()
    before=load(lab_directory());actual=[r for r in rows(before) if r['id']==row['id']]
    if actual!=[row] or any(r.get('file_Path') and canonical(r['file_Path'])==canonical(new) for r in rows(before)):raise ValueError('Prepared material changed')
    parent=parent_edges(before,row['id'])
    if len(parent)!=1:raise ValueError('Card parent ambiguous')
    root=old.parent;binding=str(uuid.uuid4());source=str(uuid.uuid4())
    state={'Bindings':[{'Id':binding,'ProjectId':LAB_ID,'RootPath':str(root),'MediaFolderId':parent[0]['parent_id']}],
        'Sources':[{'Id':source,'BindingId':binding,'FileIdentity':physical,'MaterialId':row['id'],'Version':2,'RelativePath':new.name,'AppliedPath':old.name,'Hash':sha,'AppliedHash':sha,'Size':size,'Presence':'Present'}]}
    job={'Id':str(uuid.uuid4()),'ProjectId':LAB_ID,'BindingId':binding,'SourceId':source,'MaterialId':row['id'],'Flags':'Path','RootPath':str(root),'MediaFolderId':parent[0]['parent_id'],
        'PreviousPath':old.name,'RelativePath':new.name,'SourcePath':str(new),'SourceVersion':2,'Hash':sha,'Size':size,'DestinationFolderId':None}
    links=[{k:job[k] for k in ('ProjectId','BindingId','SourceId','MaterialId')}] if source_id else []
    if links:links[0].update(TimelineSourceIds=[source_id],FileIdentity=physical)
    p=plan(job,state,before,physical,links,linked_aliases=True,linked_alias_moves=True,media=True)
    if bool(p['sourceId'])!=bool(source_id) or (source_id and (p['sourceId']!=source_id or p['sourceGroup']!=source_group)):raise ValueError('Controlled source linkage differs')
    case.mkdir();snapshot(lab_directory(),case/'before');record={'stage':'movingFixture','job':job,'plan':p,'fileIdentity':physical,'sourceProof':source_proof};atomic(case/'journal.json',record)
    try:old.rename(new)
    except OSError as error:
        record.update(stage='waitingForWindowsUnlock',nativeCommands=0,reason=str(error));atomic(case/'journal.json',record)
        snapshot(lab_directory(),case/'not-dispatched');assert load(case/'not-dispatched')==before
        return {'accepted':False,'waitingForWindowsUnlock':True,'extension':old.suffix,'nativeCommands':0}
    record['stage']='fixtureMoved';atomic(case/'journal.json',record)
    stable=StableFile(new)
    try:
        if stable.identity()!=physical or digest(new)!=sha:raise ValueError('Physical identity/bytes changed during Windows move')
        expected=photo_timeline(before['timeline'],p)
        if p['sourceId']:
            _,manifest=acceptance(SCOPES[PNG_MATERIAL]);exports=json.loads(manifest.read_text(encoding='utf8'))['exports']
            av=json.loads((ROOT/'research/evidence/direct-sdk-access/av-narrow-path-batch/journal.json').read_text(encoding='utf8'))
            exports.update(json.loads(Path(av['manifest']).read_text(encoding='utf8'))['exports'])
            model=json.loads((ROOT/'artifacts/SdkModelProbe/1792059078966742900/model-report.json').read_text(encoding='utf8'))
            payload={'id':job['Id'],'projectId':LAB_ID,'materialId':job['MaterialId'],'sourceId':p['sourceId'],'rootPath':str(ROOT/'research/fixtures/AutoAddLab'),
                'metaPath':str(lab_directory()/'draft_meta_info.json'),'baselineTimeline':before['timeline'],'restoreProperties':p['timelineSources'][0],
                'newPath':str(new).replace('\\','/'),'newName':p['newSourceName'],'exports':exports,'draftVtableRva':model['draftVtableRva'],'mediaGroup':p['sourceGroup']}
            atomic(case/'source-input.json',payload);record['stage']='dispatchingSource';atomic(case/'journal.json',record)
            receipt=(source_boundary or invoke)(main_pid(),'SourceMedia','CapSync_SourcePath',Source(input=str(case/'source-input.json'),lease=lease(worker,token)),case/'evidence/source.json')
            if receipt.get('status')!='changed' or receipt.get('wholeSdkDraftExact') is not True:raise ValueError('Source update unconfirmed; no bin/save/replay')
        record['stage']='dispatchingBin';atomic(case/'journal.json',record)
        request=Bin(action=3,oldPath=str(old),newPath=str(new),root=str(ROOT/'research/fixtures/AutoAddLab'),meta=str(lab_directory()/'draft_meta_info.json'),
            jobId=job['Id'].encode(),materialId=row['id'].encode(),sha256=sha.encode(),aliasesJson=json.dumps(p['relatedMaterialIds']).encode(),lease=lease(worker,token))
        receipt=invoke(main_pid(),'BinMedia','CapSync_RelinkCommandThread',request,case/'evidence/bin.json')
        if receipt.get('status')!='changed' or set(receipt.get('updatedAliasIds',[]))!=set(p['relatedMaterialIds']) or not all(receipt.get(k) is True for k in ('focusUnchanged','foregroundUnchanged','navigationUnchanged')):raise ValueError('Bin update unconfirmed; no save/replay')
        if p['sourceId']:
            current=load(lab_directory());normalized=deepcopy(current);normalized['timeline']=expected
            if current['timeline'] not in (before['timeline'],expected) or not compare(before,normalize_stock_service(before,normalized),p)['accepted']:raise ValueError('Pre-save complete graph mismatch')
            atomic(case/'save-input.json',save_payload(job['Id'],expected));record['stage']='dispatchingSave';atomic(case/'journal.json',record)
            receipt=v2_invoke(main_pid(),'StoreSave','CapSync_StoreSaveThread',Source(input=str(case/'save-input.json'),lease=lease(worker,token)),case/'evidence/timeline-save.json')
            if receipt.get('status')!='submitted' or receipt.get('wholeSdkDraftExact') is not True:raise ValueError('Save unconfirmed; never replay')
        def full(folder):
            after=load(folder);result=compare(before,normalize_stock_service(before,after),p)
            meta=lambda x:{k:v for k,v in x['meta'].items() if k not in ('draft_materials','tm_draft_modified')}
            if meta(before)!=meta(after):result['errors'].append('Other metadata changed')
            template=template_exact(case/'before',folder,before['timeline'],expected if p['sourceId'] else None)
            if not template:result['errors'].append('Complete template differs')
            result['accepted']=not result['errors'];return result
        snapshot(lab_directory(),case/'immediate');checked=full(case/'immediate');atomic(case/'immediate-comparison.json',checked)
        if not checked['accepted']:raise ValueError('Immediate complete comparison failed; no replay')
        record['stage']='verifyingSave';atomic(case/'journal.json',record);time.sleep(30)
        snapshot(lab_directory(),case/'saved');checked=full(case/'saved');atomic(case/'saved-comparison.json',checked)
        if not checked['accepted']:raise ValueError('Saved complete comparison failed; no replay')
        record.update(stage='savedVerified',accepted=True,nativeCommands=3 if p['sourceId'] else 1);atomic(case/'journal.json',record)
        return {'accepted':True,'extension':old.suffix,'used':bool(p['sourceId']),'nativeCommands':record['nativeCommands'],'allNineClipsPreserved':True}
    except Exception as error:
        record.update(stage='conflict',reason=str(error));atomic(case/'journal.json',record);raise
    finally:stable.close()

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('action',choices=('prepare','unused-renames','used-av'));args=parser.parse_args()
    manifest=prepare()
    if args.action=='prepare':print(json.dumps({'prepared':True,'binaries':len(manifest['binaries']),'missingVendorImports':0,'nativeCalls':0}));return
    stage=RUN/args.action
    if stage.exists():raise ValueError('Media stage already exists; no automatic replay')
    config=ROOT/'artifacts/ExplorerPreviewProfiles/WakuSharePreview-1.2.0-explorer.1/explorer/configuration.json'
    if json.loads(config.read_text(encoding='utf8'))['enabled']:raise ValueError('Another Explorer is enabled')
    identity();pid=main_pid();validate(pid,build='9.6.0.4097')
    backup=subprocess.run([sys.executable,str(ROOT/'tools/backup_lab.py')],capture_output=True,text=True,timeout=40,creationflags=subprocess.CREATE_NO_WINDOW)
    if backup.returncode or not json.loads(backup.stdout)['complete']:raise ValueError('Full backup required')
    stage.mkdir();atomic(stage/'backup.json',json.loads(backup.stdout));atomic(stage/'observer-state.json',{'SchemaVersion':9,'Bindings':[],'Sources':[],'Pending':[]})
    catalog=load(lab_directory());cases=[]
    if args.action=='unused-renames':
        for path in json.loads((RUN/'stock-import/journal.json').read_text(encoding='utf8'))['paths']:
            row=next(r for r in rows(catalog) if r.get('file_Path') and canonical(r['file_Path'])==canonical(path));cases.append((Path(path).suffix[1:],row,None,None,None))
    else:
        av=json.loads((ROOT/'research/evidence/direct-sdk-access/av-narrow-path-batch/journal.json').read_text(encoding='utf8'))
        if av['stage']!='avControlsAccepted':raise ValueError('Original controlled AV association is unaccepted')
        for source in av['plans']:
            row=next(r for r in rows(catalog) if r['id']==source['materialId'])
            if canonical(row['file_Path'])!=canonical(source['new']) or digest(source['new'])!=source['hash']:raise ValueError('Controlled AV fixture differs')
            cases.append((source['type'],row,source['sourceId'],source['group'],str(ROOT/'research/evidence/direct-sdk-access/av-narrow-path-batch/journal.json')))
    atomic(stage/'journal.json',{'stage':'prepared','cases':[name for name,*_ in cases],'accepted':False})
    worker=Worker(stage/'observer-state.json',pid);results=[]
    try:
        ready=worker.event('ready');bridge=ready['bridge'];bootstrap({'bridge':bridge,'evidence':str(stage/'connection')})
        event=worker.event('editorChanged');assert event['state']['editor']['Status']=='Project';lease(worker,bridge['Token'])
        for name,row,source,group,proof in cases:
            result=run_one(stage/name,worker,bridge['Token'],row,source,group,proof);results.append(result)
            atomic(stage/'progress.json',{'completed':len(results),'total':len(cases),'results':results})
            print(json.dumps({'case':name,**result}),flush=True)
            if not result['accepted']:break
        reply,_=worker.request('stop');assert reply['ok'];worker.event('stopped');worker.exited(0)
        atomic(stage/'journal.json',{'stage':'savedVerified' if len(results)==len(cases) and all(r['accepted'] for r in results) else 'waiting','accepted':len(results)==len(cases) and all(r['accepted'] for r in results),'results':results,'projectReopenVerified':False,'productionEnabled':False})
    finally:worker.close()

if __name__=='__main__':main()
