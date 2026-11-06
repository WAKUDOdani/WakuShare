"""Lab-only journaled creation of explicitly owned folder UUIDs."""
import argparse
import ctypes as C
import json
import msvcrt
import shutil
import time
import uuid
from pathlib import Path
from load_native_lab import ROOT,LAB_ID,Loader,validate,modules,digest,identity,lab_directory,snapshot
from qt_meta_inventory import PE
from live_add import atomic,main_pid
from verify_native_import import load
from store_equivalence import normalized_store


class Request(C.Structure):
    _fields_=[('size',C.c_uint32),('version',C.c_uint32),('action',C.c_uint32),
        ('source',C.c_wchar*1024),('root',C.c_wchar*1024),('meta',C.c_wchar*1024),('output',C.c_wchar*1024),
        ('jobId',C.c_char*37),('folderId',C.c_char*37),('parentId',C.c_char*37)]


def command(pid,job,run,action):
    loaded=validate(pid,build='9.6.0.4097')
    dll=ROOT/'artifacts/NativeFolderBuild/CapSync.NativeFolderR4097V2.dll';sha=digest(dll)
    staged=ROOT/'artifacts/NativeFolder'/sha[:16]/dll.name;staged.parent.mkdir(parents=True,exist_ok=True)
    if not staged.exists():shutil.copyfile(dll,staged)
    if digest(staged)!=sha:raise RuntimeError('Folder bridge differs')
    present=[m for m in loaded if m['name'].lower()==dll.name.lower()]
    if present and (len(present)!=1 or Path(present[0]['path']).resolve()!=staged.resolve()):raise RuntimeError('Loaded folder bridge differs')
    loader=Loader(pid)
    try:
        if not present:loader.call(loader.library_entry(),(str(staged)+'\0').encode('utf-16le'))
        module=next(m for m in modules(pid) if Path(m['path']).resolve()==staged.resolve());pe=PE(staged)
        rva=int(next(e['rva'] for e in pe.exports() if e['name']=='CapSync_FolderCommandThread'),16)
        if not any(n=='.text' and a<=rva<a+s for n,a,_,s,_ in pe.sections):raise RuntimeError('Entry not code')
        output=run/'evidence'/f'native-folder-{action}-{uuid.uuid4().hex}.json'
        request=Request(size=C.sizeof(Request),version=1,action=action,
            source=str(Path(job['RootPath'])/job['RelativePath']),root=job['RootPath'],
            meta=str(lab_directory()/'draft_meta_info.json'),output=str(output),jobId=job['Id'].encode('ascii'),
            folderId=job['FolderId'].encode('ascii'),parentId=job['ParentFolderId'].encode('ascii'))
        code=loader.call(module['base']+rva,bytes(request))
        if code!=1:return {'status':'rejected','reason':f'Entry refused {C.c_int32(code).value}'}
        deadline=time.monotonic()+5
        while not output.exists() and time.monotonic()<deadline:time.sleep(.05)
        if not output.exists():return {'status':'unknown','reason':'Native completion unknown'}
        reply=json.loads(output.read_text(encoding='utf8'))
        if reply.get('jobId')!=job['Id']:raise RuntimeError('Wrong folder receipt')
        return reply
    finally:loader.close()


def folder_rows(catalog):return [v for g in catalog['store']['draft_virtual_store'] if g['type']==0 for v in g.get('value',[])]


def preservation(before,after,job):
    from copy import deepcopy
    errors=[];desired=job['FolderId'];normalized=deepcopy(after['store']);found=[];edges=[]
    for group in normalized['draft_virtual_store']:
        if group['type']==0:
            found.extend(v for v in group['value'] if v['id']==desired);group['value']=[v for v in group['value'] if v['id']!=desired]
        if group['type']==1:
            edges.extend(v for v in group['value'] if v['child_id']==desired);group['value']=[v for v in group['value'] if v['child_id']!=desired]
    if len(found)!=1 or found[0].get('display_name')!=Path(job['RelativePath']).name:errors.append('Folder ID/name unverified')
    if edges!=[{'child_id':desired,'parent_id':job['ParentFolderId']}]:errors.append('Folder parent unverified')
    if normalized_store(normalized)!=normalized_store(before['store']):errors.append('Other folder data changed')
    if before['meta']['draft_materials']!=after['meta']['draft_materials']:errors.append('Media registry changed')
    if before['timeline']!=after['timeline']:errors.append('Timeline changed')
    return {'accepted':not errors,'errors':errors,'folderId':desired}


def execute(job,journal):
    def reply(status,reason=None):return {'JobId':job['Id'],'Status':status,'MaterialId':job['FolderId'] if status=='Verified' else None,'Reason':reason}
    root=ROOT/'research/fixtures/AutoAddLab';source=Path(job['RootPath'])/job['RelativePath'];project=lab_directory()
    if job['ProjectId']!=LAB_ID or Path(job['ProjectDirectory']).resolve()!=project.resolve() or Path(job['RootPath']).resolve()!=root.resolve() \
        or not job['RelativePath'] or Path(job['RelativePath']).is_absolute() or '..' in job['RelativePath'].replace('\\','/').split('/') \
        or not source.resolve().is_relative_to(root.resolve()):return reply('Conflict','Folder outside lab scope')
    for key in ('Id','FolderId','ParentFolderId'):uuid.UUID(job[key])
    run=journal/job['Id'];(run/'evidence').mkdir(parents=True,exist_ok=True);path=run/'journal.json'
    record=json.loads(path.read_text(encoding='utf8')) if path.exists() else {'job':job,'stage':'planned'}
    if record['job']!=job:return reply('Conflict','Folder job changed')
    def save():atomic(path,record)
    if record['stage']=='conflict':return reply('Conflict',record['reason'])
    current=load(project);matches=[v for v in folder_rows(current) if v['id']==job['FolderId']]
    if record['stage']=='completed':
        edges=[v for g in current['store']['draft_virtual_store'] if g['type']==1 for v in g['value'] if v['child_id']==job['FolderId']]
        return reply('Verified') if len(matches)==1 and edges==[{'child_id':job['FolderId'],'parent_id':job['ParentFolderId']}] else reply('Conflict','Owned folder changed')
    try:identity();pid=main_pid()
    except Exception:return reply('Waiting','Open the lab project')
    if record['stage']=='planned':
        if matches:return reply('Conflict','Proposed folder ID already exists without this journal')
        if not source.is_dir():return reply('Waiting','Source directory unavailable')
        if any(p.lstat().st_file_attributes&0x400 for p in [source,*source.parents] if p.is_relative_to(root)):
            return reply('Conflict','Linked directory excluded')
        before=run/('before-'+uuid.uuid4().hex);snapshot(project,before);record['before']=before.name
        record['stage']='dispatching';save()
        result=command(pid,job,run,1);record['nativeReceipt']=result;save()
        if result['status']=='rejected':record['stage']='planned';save();return reply('Waiting',result.get('reason'))
    deadline=time.monotonic()+10
    while True:
        current=load(project);matches=[v for v in folder_rows(current) if v['id']==job['FolderId']]
        if len(matches)==1:break
        if time.monotonic()>=deadline:return reply('Unknown','Folder creation unverified; not repeating')
        time.sleep(.2)
    if not record.get('nativeReceipt'):
        receipts=[json.loads(p.read_text(encoding='utf8')) for p in (run/'evidence').glob('native-folder-1-*.json')]
        matches=[v for v in receipts if v.get('jobId')==job['Id'] and v.get('status')=='created' and v.get('folderId')==job['FolderId']]
        if len(matches)==1:record['nativeReceipt']=matches[0];save()
    after=run/('after-'+uuid.uuid4().hex);snapshot(project,after);record['after']=after.name
    check=preservation(load(run/record['before']),load(after),job);atomic(run/'acceptance.json',check)
    if not check['accepted']:record['stage']='conflict';record['reason']='; '.join(check['errors']);save();return reply('Conflict',record['reason'])
    native=record.get('nativeReceipt',{})
    if any(native.get(key) is not True for key in ['navigationUnchanged','foregroundUnchanged','cursorUnchanged','focusUnchanged']):
        return reply('Unknown','Folder interaction checks inconclusive')
    record['stage']='completed';save();return reply('Verified')


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--request',type=Path,required=True);parser.add_argument('--journal',type=Path,required=True)
    args=parser.parse_args();request=args.request.resolve();journal=args.journal.resolve()
    if not journal.is_relative_to(ROOT/'artifacts') or request.parent!=journal:raise ValueError('Owned journal required')
    job=json.loads(request.read_text(encoding='utf8'))
    if request.name!=job['Id']+'.request.json':raise ValueError('Wrong request identity')
    with (journal/'executor.lock').open('a+b') as lock:
        if lock.tell()==0:lock.write(b'0');lock.flush()
        lock.seek(0);msvcrt.locking(lock.fileno(),msvcrt.LK_NBLCK,1)
        try:result=execute(job,journal)
        finally:lock.seek(0);msvcrt.locking(lock.fileno(),msvcrt.LK_UNLCK,1)
    print(json.dumps(result))


if __name__=='__main__':main()
