"""One-shot lab source relink; no input control or project JSON writes."""
import argparse
import ctypes as C
import json
from pathlib import Path
import shutil
import time
import uuid
from load_native_lab import ROOT,Loader,validate,modules,digest,lab_directory,snapshot
from qt_meta_inventory import PE
from live_add import atomic,main_pid,canonical,rows
from verify_native_import import load


class Request(C.Structure):
    _fields_=[('size',C.c_uint32),('version',C.c_uint32),('action',C.c_uint32),
        ('oldPath',C.c_wchar*1024),('newPath',C.c_wchar*1024),('root',C.c_wchar*1024),
        ('meta',C.c_wchar*1024),('output',C.c_wchar*1024),('jobId',C.c_char*37),
        ('materialId',C.c_char*37),('sha256',C.c_char*65),('aliasesJson',C.c_char*1024)]


def command(job,run,action,dll_name='CapSync.NativeRelinkR4097V7.dll',check_identity=True):
    # The native entry rejects before queueing if its receipt directory is absent.
    (run/'evidence').mkdir(parents=True,exist_ok=True)
    # V9 verifies the active SDK draft ID and exact lab tree on the UI thread
    # before mutation. Only this isolated version may test omission of CLI IPC.
    if not check_identity and dll_name!='CapSync.NativeRelinkR4097V9.dll':
        raise ValueError('IPC-free identity experiment requires pinned V9 lab bridge')
    pid=main_pid();loaded=validate(pid,build='9.6.0.4097',check_identity=check_identity)
    sdk=[m for m in loaded if m['name'].lower()=='videoeditor.dll']
    if len(sdk)!=1 or digest(sdk[0]['path'])!='47e341ce930074bd7d11ef418ea5c893fc6330aa73b2f2203c5098f302d63e9f':
        raise ValueError('Unverified draft-store SDK')
    bin_modules={'CapSync.NativePhotoBinPath.dll','CapSync.NativeBinMoveSinglePng.dll','CapSync.NativeBinMovePng.dll','CapSync.NativeBinRefreshJpeg.dll',
                 'CapSync.NativeBinMoveJpeg.dll','CapSync.NativeBinRootPathV2.dll','CapSync.NativeBinRootPath.dll','CapSync.NativeBinPath.dll'}
    if dll_name not in bin_modules|{'CapSync.NativeRelinkR4097V7.dll','CapSync.NativeRelinkR4097V8.dll','CapSync.NativeRelinkR4097V9.dll','CapSync.NativeRelinkR4097V10.dll','CapSync.NativeRelinkR4097V11.dll','CapSync.NativeRelinkR4097V12.dll','CapSync.NativeRelinkR4097V13.dll','CapSync.NativeRelinkR4097V14.dll','CapSync.NativeRelinkR4097V15.dll'}:
        raise ValueError('Unknown lab module version')
    if dll_name in ('CapSync.NativePhotoBinPath.dll','CapSync.NativeBinMoveSinglePng.dll','CapSync.NativeBinMovePng.dll','CapSync.NativeBinPath.dll','CapSync.NativeBinRefreshJpeg.dll') and action!=3:raise ValueError('Bin-only adapter requires action 3')
    if dll_name in ('CapSync.NativeBinRootPath.dll','CapSync.NativeBinRootPathV2.dll','CapSync.NativeBinMoveJpeg.dll') and action not in (0,3):raise ValueError('Root bin adapter permits preflight/bin-only actions')
    dll=ROOT/'artifacts'/('NativeRootReadBuild' if dll_name in bin_modules else 'NativeRelinkBuild')/dll_name;sha=digest(dll)
    staged=ROOT/'artifacts/NativeRelink'/sha[:16]/dll.name;staged.parent.mkdir(parents=True,exist_ok=True)
    if not staged.exists():shutil.copyfile(dll,staged)
    if digest(staged)!=sha:raise ValueError('Changed staged module')
    present=[m for m in loaded if m['name'].lower()==dll.name.lower()]
    if present and (len(present)!=1 or Path(present[0]['path']).resolve()!=staged.resolve()):raise ValueError('Loaded module differs')
    loader=Loader(pid)
    try:
        if not present:loader.call(loader.library_entry(),(str(staged)+'\0').encode('utf-16le'))
        module=next(m for m in modules(pid) if Path(m['path']).resolve()==staged.resolve())
        pe=PE(staged);rva=int(next(e['rva'] for e in pe.exports() if e['name']=='CapSync_RelinkCommandThread'),16)
        if not any(n=='.text' and s<=rva<s+length for n,s,_,length,_ in pe.sections):raise ValueError('Export not code')
        output=run/'evidence'/f'native-relink-{action}-{uuid.uuid4().hex}.json'
        aliases=json.dumps(job.get('relatedMaterialIds',[job['materialId']]),separators=(',',':')).encode('ascii')
        if len(aliases)>=1024:raise ValueError('Alias scope too large')
        request=Request(size=C.sizeof(Request),version=2,action=action,oldPath=job['oldPath'],newPath=job['newPath'],
            root=str(ROOT/'research/fixtures/AutoAddLab'),meta=str(lab_directory()/'draft_meta_info.json'),
            output=str(output),jobId=job['id'].encode('ascii'),materialId=job['materialId'].encode('ascii'),sha256=job['hash'].encode('ascii'),aliasesJson=aliases)
        code=loader.call(module['base']+rva,bytes(request))
        if code!=1:return {'status':'rejected','reason':f'entry {C.c_int32(code).value}'}
        until=time.monotonic()+5
        while not output.exists() and time.monotonic()<until:time.sleep(.05)
        if not output.exists():return {'status':'unknown','reason':'completion unknown; not repeating'}
        result=json.loads(output.read_text(encoding='utf8'))
        if result.get('jobId')!=job['id']:raise ValueError('Wrong result identity')
        return result
    finally:loader.close()


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('action',choices=['preview','rename']);args=parser.parse_args()
    run=ROOT/'research/evidence/relink-lab-4097';(run/'evidence').mkdir(exist_ok=True)
    old=ROOT/'research/fixtures/AutoAddLab/ReleaseCheck/Shared/release-probe.png'
    new=old.with_name('release-probe-renamed.png')
    owned=json.loads((run/'clip-owned.json').read_text(encoding='utf8'))
    state=json.loads((ROOT/'artifacts/LiveAddLab/state.json').read_text(encoding='utf8'))
    source=next(s for s in state['Sources'] if s['Id']==owned['sourceId'])
    assert source['MaterialId']==owned['binId'] and source['RelativePath']=='ReleaseCheck/Shared/release-probe.png'
    assert old.is_file() and digest(old).casefold()==source['AppliedHash'].casefold()
    catalog=load(lab_directory());record=next(v for v in rows(catalog) if v['id']==source['MaterialId'])
    assert canonical(record['file_Path'])==canonical(old)
    if args.action=='preview':
        before=catalog
        job={'id':str(uuid.uuid4()),'oldPath':str(old),'newPath':str(old),'materialId':source['MaterialId'],'hash':digest(old)}
        result=command(job,run,0);atomic(run/'native-preview.json',result)
        after=load(lab_directory())
        assert before['timeline']==after['timeline'] and before['store']==after['store'] and before['meta']['draft_materials']==after['meta']['draft_materials']
        print(json.dumps(result));return
    path=run/'rename-journal.json'
    if path.exists():raise ValueError('Rename already dispatched/planned; reconcile instead of repeating')
    assert not new.exists() and old.resolve().is_relative_to(ROOT.resolve()) and new.resolve().is_relative_to(ROOT.resolve())
    for entry in [old,*old.parents]:
        if entry.is_relative_to(ROOT/'research/fixtures/AutoAddLab') and entry.lstat().st_file_attributes&0x400:
            raise ValueError('Linked source refused')
    job={'id':str(uuid.uuid4()),'oldPath':str(old),'newPath':str(new),'materialId':source['MaterialId'],'hash':digest(old)}
    before=run/('rename-before-'+uuid.uuid4().hex);snapshot(lab_directory(),before)
    journal={'job':job,'before':before.name,'stage':'prepared'};atomic(path,journal)
    old.rename(new);journal['stage']='fileRenamed';atomic(path,journal)
    journal['stage']='dispatching';atomic(path,journal)
    result=command(job,run,1);journal['native']=result;journal['stage']='awaitingPersistence';atomic(path,journal)
    until=time.monotonic()+6
    while time.monotonic()<until:
        current=load(lab_directory());selected=next(v for v in rows(current) if v['id']==job['materialId'])
        if canonical(selected['file_Path'])==canonical(new):break
        time.sleep(.2)
    after=run/('rename-after-'+uuid.uuid4().hex);snapshot(lab_directory(),after);journal['after']=after.name;atomic(path,journal)
    print(json.dumps({'native':result,'registryPath':selected['file_Path'],'registryName':selected['extra_info'],
                      'pathPersisted':canonical(selected['file_Path'])==canonical(new)},ensure_ascii=True))


if __name__=='__main__':main()
