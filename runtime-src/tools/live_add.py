"""Journaled live media additions in the isolated CapSync lab only.

No project JSON edits or OS input. An uncertain dispatch is reconciled from
the catalog; it is never automatically repeated, including after a restart.
"""
import argparse
import ctypes as C
from copy import deepcopy
import json
import msvcrt
import os
import shutil
import subprocess
import sys
import time
import uuid
from pathlib import Path
from load_native_lab import ROOT, LAB_ID, Loader, validate, modules, digest, identity, lab_directory, snapshot
from qt_meta_inventory import PE
from verify_native_import import load
from store_equivalence import normalized_store


class Request(C.Structure):
    _fields_=[('size',C.c_uint32),('version',C.c_uint32),('action',C.c_uint32),
              ('source',C.c_wchar*1024),('root',C.c_wchar*1024),('meta',C.c_wchar*1024),('output',C.c_wchar*1024),
              ('jobId',C.c_char*37),('targetId',C.c_char*37),('materialId',C.c_char*37),('sha256',C.c_char*65)]


FORMATS={'.png','.jpg','.jpeg','.gif','.wav','.mp3','.mp4','.mov'}
def inspect_media(source):
    """Probe the actual content, not only its filename extension."""
    probe=shutil.which('ffprobe')
    if not probe: raise OSError('ffprobe is required for media preflight')
    result=subprocess.run([probe,'-v','error','-show_entries',
        'format=format_name,duration:stream=codec_type,codec_name,width,height,sample_rate,nb_frames,duration',
        '-of','json',str(source)],capture_output=True,text=True,encoding='utf8',timeout=10,
        creationflags=subprocess.CREATE_NO_WINDOW)
    if result.returncode: raise ValueError('Media parser could not read this file')
    info=json.loads(result.stdout); streams=info.get('streams',[])
    names=set(info.get('format',{}).get('format_name','').split(','))
    video=[s for s in streams if s.get('codec_type')=='video' and s.get('width',0)>0 and s.get('height',0)>0]
    audio=[s for s in streams if s.get('codec_type')=='audio' and int(s.get('sample_rate','0'))>0]
    suffix=source.suffix.casefold()
    if suffix in {'.png','.jpg','.jpeg','.gif'}:
        codec={'.png':'png','.gif':'gif'}.get(suffix,'mjpeg')
        valid=bool(video) and video[0].get('codec_name')==codec
        kind='animation' if suffix=='.gif' else 'image'
    elif suffix in {'.wav','.mp3'}:
        valid=bool(audio) and ('wav' if suffix=='.wav' else 'mp3') in names
        kind='audio'
    else:
        valid=bool(video) and bool(names & {'mov','mp4'})
        kind='video'
    if not valid: raise ValueError('Media content does not match a supported format')
    return {'kind':kind,'probe':info}


def atomic(path,value):
    temporary=path.with_suffix('.'+uuid.uuid4().hex+'.tmp')
    try:
        with temporary.open('x',encoding='utf8') as file:
            json.dump(value,file,ensure_ascii=False,indent=2); file.flush(); os.fsync(file.fileno())
        os.replace(temporary,path)
    finally:
        if temporary.exists(): temporary.unlink()


def canonical(value): return str(Path(value).resolve()).casefold()
def rows(catalog): return [v for g in catalog['meta']['draft_materials'] for v in g.get('value',[])]

def require_folder(catalog,identifier):
    matches=[v for g in catalog['store']['draft_virtual_store'] if g['type']==0
             for v in g.get('value',[]) if v['id']==identifier]
    if len(matches)!=1 or any(v['id']==identifier for v in rows(catalog)):
        raise ValueError('Destination UUID is not one typed folder')
    return matches[0]

def resolve_folder_path(catalog,names):
    """Resolve only typed folder records, never a leaf with a matching parent."""
    folders=[v for g in catalog['store']['draft_virtual_store'] if g['type']==0 for v in g.get('value',[])]
    if len({v['id'] for v in folders})!=len(folders):raise ValueError('Duplicate folder UUID')
    parent=''
    for name in names:
        matches=[v for v in folders if v['display_name']==name and
                 parent_edges(catalog,v['id'])==[{'child_id':v['id'],'parent_id':parent}]]
        if len(matches)!=1:raise ValueError('Folder path missing or ambiguous: '+str(names))
        parent=matches[0]['id']
        require_folder(catalog,parent)
    if not names:raise ValueError('Empty folder path')
    return parent
def path_rows(catalog,path): return [v for v in rows(catalog) if v.get('file_Path') and canonical(v['file_Path'])==canonical(path)]
def parent_edges(catalog,identifier):
    return [v for g in catalog['store']['draft_virtual_store'] if g['type']==1
            for v in g.get('value',[]) if v['child_id']==identifier]


def preservation(before,after,job,identifier):
    errors=[]
    old_rows,new_rows=rows(before),rows(after)
    old={v['id']:v for v in old_rows}; new={v['id']:v for v in new_rows}
    if len(old)!=len(old_rows) or len(new)!=len(new_rows): errors.append('Duplicate registry IDs')
    service_id='cd484075-d92a-4bc9-b45c-d093d2f9e71b'
    stock=load(ROOT/'research/evidence/native-stock-capture-1791880114470205300/after')
    template=next(v for v in rows(stock) if v['id']==service_id)
    time_fields={'create_time','import_time','import_time_ms'}
    stable=lambda value:{k:v for k,v in value.items() if k not in time_fields}
    service_time_change=(service_id in old and service_id in new and not template.get('file_Path') and
        template.get('metetype')=='none' and stable(old[service_id])==stable(new[service_id])==stable(template))
    service_added=(service_id not in old and service_id in new and not template.get('file_Path') and
        template.get('metetype')=='none' and stable(new[service_id])==stable(template))
    changed=[key for key,value in old.items() if new.get(key)!=value and not (key==service_id and service_time_change)]
    if changed: errors.append('Existing registry rows changed')
    expected_added={identifier}|({service_id} if service_added else set())
    if set(new)-set(old)!=expected_added: errors.append('Expected exactly one new media registry ID')
    matches=path_rows(after,job['SourcePath'])
    if len(matches)!=1 or matches[0]['id']!=identifier: errors.append('New source ownership ambiguous')
    store=deepcopy(after['store']); removed=[]
    for group in store['draft_virtual_store']:
        if group['type']!=1: continue
        removed.extend(v for v in group.get('value',[]) if v['child_id']==identifier)
        group['value']=[v for v in group.get('value',[]) if v['child_id']!=identifier]
    if removed!=[{'child_id':identifier,'parent_id':job['MediaFolderId']}]: errors.append('Wrong or duplicate destination edge')
    if service_added:
        service_edges=[v for g in store['draft_virtual_store'] if g['type']==1 for v in g.get('value',[]) if v['child_id']==service_id]
        old_service_edges=[v for g in before['store']['draft_virtual_store'] if g['type']==1 for v in g.get('value',[]) if v['child_id']==service_id]
        if service_edges!=[{'child_id':service_id,'parent_id':''}]:errors.append('Stock empty service edge unverified')
        if not old_service_edges:
            for group in store['draft_virtual_store']:
                if group['type']==1:group['value']=[v for v in group.get('value',[]) if v['child_id']!=service_id]
    if normalized_store(store)!=normalized_store(before['store']): errors.append('Unrelated virtual-store data changed')
    if before['timeline']!=after['timeline']: errors.append('Timeline changed during the lab operation')
    return {'accepted':not errors,'errors':errors,'materialId':identifier,
            'timelineUnchanged':before['timeline']==after['timeline'],
            'changedRegistryIds':changed,'allowedServiceTimestampRefresh':service_time_change and old[service_id]!=new[service_id],
            'allowedStockServiceAddition':service_added,'serializedOrderOnly':store!=before['store'] and normalized_store(store)==normalized_store(before['store'])}


def main_pid():
    command='Get-Process CapCut -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id | ConvertTo-Json -Compress'
    result=subprocess.run(['powershell','-NoProfile','-NonInteractive','-Command',command],
        capture_output=True,text=True,timeout=5,creationflags=subprocess.CREATE_NO_WINDOW)
    values=json.loads(result.stdout or '[]'); values=values if isinstance(values,list) else [values]
    found=[]
    for pid in values:
        try:
            if any(m['name'].lower()=='vecreator.dll' for m in modules(pid)): found.append(pid)
        except OSError: pass
    if len(found)!=1: raise RuntimeError('One active CapCut editor process is required')
    return found[0]


def command(pid,job,run,action,material='',dll_name='CapSync.NativeAddR4097.dll'):
    if action==2:require_folder(load(lab_directory()),job['MediaFolderId'])
    if dll_name not in ('CapSync.NativeAddR4097.dll','CapSync.NativeCardMovePng.dll','CapSync.NativeTreeMove.dll','CapSync.NativeTreeMoveV2.dll','CapSync.NativeFolderStoreMove.dll','CapSync.NativeTypedTreeMove.dll','CapSync.NativePhotoTreeMove.dll'):
        raise ValueError('Unknown addition/move module')
    if dll_name in ('CapSync.NativeCardMovePng.dll','CapSync.NativeTreeMove.dll','CapSync.NativeTreeMoveV2.dll','CapSync.NativeTypedTreeMove.dll','CapSync.NativePhotoTreeMove.dll') and action!=2:
        raise ValueError('Alias move module cannot import media')
    if dll_name=='CapSync.NativeFolderStoreMove.dll' and action!=0:
        raise ValueError('Unaccepted hierarchy-only writer is read-only')
    (run/'evidence').mkdir(parents=True,exist_ok=True)
    loaded=validate(pid,build='9.6.0.4097')  # Exact installed VECreator/Qt paths and hashes.
    directory='NativeAddBuild' if dll_name=='CapSync.NativeAddR4097.dll' else 'NativeRootReadBuild'
    dll=ROOT/'artifacts'/directory/dll_name; sha=digest(dll)
    staged=ROOT/'artifacts/NativeAdd'/sha[:16]/dll.name
    staged.parent.mkdir(parents=True,exist_ok=True)
    if not staged.exists(): shutil.copyfile(dll,staged)
    if digest(staged)!=sha: raise RuntimeError('Staged bridge differs')
    existing=[m for m in loaded if m['name'].lower()==dll.name.lower()]
    if existing and (len(existing)!=1 or Path(existing[0]['path']).resolve()!=staged.resolve()):
        raise RuntimeError('Loaded bridge differs; restart CapCut before using a new build')
    loader=Loader(pid)
    try:
        if not existing: loader.call(loader.library_entry(),(str(staged)+'\0').encode('utf-16le'))
        module=next(m for m in modules(pid) if Path(m['path']).resolve()==staged.resolve())
        pe=PE(staged)
        rva=int(next(e['rva'] for e in pe.exports() if e['name']=='CapSync_AddCommandThread'),16)
        if not any(n=='.text' and a<=rva<a+s for n,a,_,s,_ in pe.sections): raise RuntimeError('Bridge entry is not code')
        output=run/'evidence'/f'native-add-{action}-{uuid.uuid4().hex}.json'
        request=Request(size=C.sizeof(Request),version=1,action=action,
            source=job['SourcePath'],root=job['RootPath'],meta=str(lab_directory()/'draft_meta_info.json'),output=str(output),
            jobId=job['Id'].encode('ascii'),targetId=job['MediaFolderId'].encode('ascii'),materialId=material.encode('ascii'),
            sha256=job['Hash'].encode('ascii'))
        code=loader.call(module['base']+rva,bytes(request))
        if code!=1: return {'status':'rejected','reason':f'Bridge entry rejected: {C.c_int32(code).value}'}
        deadline=time.monotonic()+5
        while not output.exists() and time.monotonic()<deadline: time.sleep(.05)
        if not output.exists(): return {'status':'unknown','reason':'Native completion unknown'}
        reply=json.loads(output.read_text(encoding='utf8'))
        if reply.get('jobId')!=job['Id']: raise RuntimeError('Wrong native job receipt')
        return reply
    finally: loader.close()


def execute(job,journal):
    def reply(status,reason=None,material=None):
        return {'JobId':job['Id'],'Status':status,'Reason':reason,'MaterialId':material}
    expected_root=(ROOT/'research/fixtures/AutoAddLab').resolve()
    source=Path(job['SourcePath']).resolve(); project=lab_directory();binding_root=Path(job['RootPath']).resolve()
    child_root=binding_root!=expected_root and os.environ.get('CAPSYNC_LAB_CROSS_BINDING')=='1' and binding_root.is_relative_to(expected_root)
    if job['ProjectId']!=LAB_ID or Path(job['ProjectDirectory']).resolve()!=project.resolve() or \
        (binding_root!=expected_root and not child_root) or not source.is_relative_to(binding_root) or \
        source.suffix.casefold() not in FORMATS or job['RelativePath'].replace('\\','/').casefold()!=source.relative_to(binding_root).as_posix().casefold() or \
        not 1<=job['SourceVersion'] or len(job['Hash'])!=64:
        return reply('Conflict','Job outside supported lab scope')
    if child_root:
        state=json.loads((journal.parent/'state.json').read_text(encoding='utf8'))
        binding=next((b for b in state['Bindings'] if b['Id']==job['BindingId']),None)
        owned=next((s for s in state['Sources'] if s['Id']==job['SourceId']),None)
        if not binding or not owned or binding['ProjectId']!=LAB_ID or canonical(binding['RootPath'])!=canonical(binding_root) or \
            owned['BindingId']!=binding['Id'] or owned['Version']!=job['SourceVersion'] or owned.get('MaterialId') is not None or \
            owned['RelativePath']!=job['RelativePath'] or owned['Hash']!=job['Hash'] or owned['FileIdentity']!=job['FileIdentity']:
            return reply('Conflict','Nested root import ownership changed')
        require_folder(load(project),binding['MediaFolderId'])
    native_job={**job,'RootPath':str(expected_root)}
    if str(uuid.UUID(job['Id']))!=job['Id']: return reply('Conflict','Invalid job identity')
    relative_directory=Path(job['RelativePath']).parent.as_posix()
    if relative_directory!='.':
        owners=[]
        for candidate in (journal.parent/'folder-journal').glob('*/journal.json'):
            entry=json.loads(candidate.read_text(encoding='utf8'));folder=entry['job']
            if entry['stage']=='completed' and folder['FolderId']==job['MediaFolderId'] and folder.get('BindingId')==job['BindingId'] \
                and folder['ProjectId']==job['ProjectId'] and canonical(folder['RootPath'])==canonical(job['RootPath']) \
                and folder['RelativePath'].replace('\\','/').casefold()==relative_directory.casefold():owners.append(folder)
        if len(owners)!=1:return reply('Conflict','No unique owned directory mapping for this destination')
    run=journal/job['Id']; (run/'evidence').mkdir(parents=True,exist_ok=True)
    path=run/'journal.json'
    record=json.loads(path.read_text(encoding='utf8')) if path.exists() else {'job':job,'stage':'planned'}
    if record['job']!=job: return reply('Conflict','Durable job identity changed')
    def save(): atomic(path,record)
    if record['stage']=='completed':
        current=load(project); matches=path_rows(current,source); edges=parent_edges(current,record['materialId'])
        if len(matches)!=1 or matches[0]['id']!=record['materialId'] or len(edges)!=1 or edges[0]['parent_id']!=job['MediaFolderId']:
            return reply('Conflict','Completed import was changed after verification')
        return reply('Verified',material=record['materialId'])
    if record['stage']=='conflict': return reply('Conflict',record.get('reason'))
    try: identity(); pid=main_pid()
    except (OSError,RuntimeError,subprocess.SubprocessError): return reply('Waiting','Open the isolated lab project in CapCut')
    catalog=load(project)
    folders=[v['id'] for g in catalog['store']['draft_virtual_store'] if g['type']==0 for v in g.get('value',[])]
    if job['MediaFolderId'] not in folders: return reply('Conflict','Target folder no longer exists')
    if record['stage']=='planned':
        if path_rows(catalog,source): return reply('Conflict','Source already imported without this journal; not claiming it')
        if not source.is_file() or source.stat().st_size!=job['Size'] or digest(source).casefold()!=job['Hash'].casefold():
            return reply('Superseded','Source changed before any dispatch')
        try: record['media']=inspect_media(source)
        except (OSError,subprocess.TimeoutExpired): return reply('Waiting','Media parser unavailable or busy')
        except ValueError as error: return reply('Conflict',str(error))
        # Refuse reparse points anywhere from the explicit fixture root to file.
        if any(p.lstat().st_file_attributes & 0x400 for p in [source,*source.parents] if p.is_relative_to(expected_root)):
            return reply('Conflict','Linked source excluded')
        backup_marker=journal/'session-backup.json'
        if not backup_marker.exists():
            result=subprocess.run([sys.executable,str(ROOT/'tools/backup_lab.py')],capture_output=True,text=True,check=True,timeout=15,
                                  creationflags=subprocess.CREATE_NO_WINDOW)
            backup=json.loads(result.stdout)
            if not backup['complete']: return reply('Conflict','Full lab backup not accepted')
            atomic(backup_marker,backup)
        before_path=run/('before-'+uuid.uuid4().hex)
        snapshot(project,before_path); record['beforeSnapshot']=before_path.name
        record['stage']='dispatchingImport'; save() # Save before calling the bridge.
        result=command(pid,native_job,run,1); record['dropReceipt']=result; save()
        if result['status'] in ('waiting','rejected'):
            record['stage']='planned'; save()
            return reply('Waiting',result.get('reason','Waiting for media view'))
        record['stage']='awaitingImport'; save()
    if record['stage'] in ('dispatchingImport','awaitingImport'):
        if not record.get('dropReceipt'):
            receipts=[json.loads(p.read_text(encoding='utf8')) for p in (run/'evidence').glob('native-add-1-*.json')]
            delivered=[r for r in receipts if r.get('jobId')==job['Id'] and r.get('dropAccepted') is True]
            if len(delivered)==1: record['dropReceipt']=delivered[0]; save()
        if record.get('dropReceipt',{}).get('dropAccepted') is not True:
            return reply('Unknown','No confirmed native drop receipt; import will not be repeated')
        # Read reconciliation only: even after timeout/restart do not redrop.
        deadline=time.monotonic()+12
        while True:
            catalog=load(project); matches=path_rows(catalog,source)
            if len(matches)==1: break
            if len(matches)>1: return reply('Conflict','Multiple records for the dispatched source')
            if time.monotonic()>=deadline: return reply('Unknown','No verified registry result; import will not be repeated')
            time.sleep(.2)
        before=load(run/record.get('beforeSnapshot','before')); old_ids={v['id'] for v in rows(before)}
        if matches[0]['id'] in old_ids: return reply('Conflict','Importer returned a pre-existing registry ID')
        record['materialId']=matches[0]['id']; record['stage']='imported'; save()
    identifier=record['materialId']
    catalog=load(project); matches=path_rows(catalog,source)
    if len(matches)!=1 or matches[0]['id']!=identifier: return reply('Conflict','Imported source identity changed')
    edges=parent_edges(catalog,identifier)
    if len(edges)!=1: return reply('Conflict','Imported material relationship ambiguous')
    if edges[0]['parent_id']!=job['MediaFolderId']:
        if record['stage']=='dispatchingMove': return reply('Unknown','Move completion unknown; no automatic repeat')
        record['stage']='dispatchingMove'; save()
        result=command(pid,native_job,run,2,identifier); record['moveReceipt']=result; save()
        if result['status']=='rejected':
            record['stage']='imported'; save(); return reply('Waiting',result.get('reason'))
        deadline=time.monotonic()+12
        while time.monotonic()<deadline:
            catalog=load(project); edges=parent_edges(catalog,identifier)
            if len(edges)==1 and edges[0]['parent_id']==job['MediaFolderId']: break
            time.sleep(.2)
    after_path=run/('after-'+uuid.uuid4().hex)
    snapshot(project,after_path); record['lastSnapshot']=after_path.name
    result=preservation(load(run/record.get('beforeSnapshot','before')),load(after_path),job,identifier)
    atomic(run/'acceptance.json',result)
    if not result['accepted']:
        record['stage']='conflict'; record['reason']='; '.join(result['errors']); save()
        return reply('Conflict',record['reason'])
    for receipt in (record.get('dropReceipt'),record.get('moveReceipt')):
        if receipt and any(receipt.get(key) is not True for key in ['navigationUnchanged','cursorUnchanged','foregroundUnchanged']):
            return reply('Unknown','Lab interaction checks were inconclusive; imported ID retained in journal')
    record['stage']='completed'; save()
    return reply('Verified',material=identifier)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--request',type=Path,required=True); parser.add_argument('--journal',type=Path,required=True)
    args=parser.parse_args(); journal=args.journal.resolve(); request=args.request.resolve()
    if not journal.is_relative_to(ROOT/'artifacts') or request.parent!=journal: raise ValueError('Owned journal required')
    job=json.loads(request.read_text(encoding='utf8'))
    if request.name!=job['Id']+'.request.json': raise ValueError('Request identity mismatch')
    # Single executor owns a journal directory, including across processes.
    with (journal/'executor.lock').open('a+b') as lock:
        if lock.tell()==0: lock.write(b'0'); lock.flush()
        lock.seek(0); msvcrt.locking(lock.fileno(),msvcrt.LK_NBLCK,1)
        try: result=execute(job,journal)
        finally: lock.seek(0); msvcrt.locking(lock.fileno(),msvcrt.LK_UNLCK,1)
    print(json.dumps(result))


if __name__=='__main__': main()
