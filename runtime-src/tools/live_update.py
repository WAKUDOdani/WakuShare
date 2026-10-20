"""Durable live updates for same-directory PNG sources in the isolated lab.

The bin UUID is retained. Stock clip replacement may regenerate its internal
video-source UUID; the clip UUID and every other clip/source property must survive.
Unknown dispatches are read-reconciled and never automatically replayed.
"""
import argparse
from collections import Counter
from copy import deepcopy
import ctypes as C
from ctypes import wintypes as W
import json
import msvcrt
import os
from pathlib import Path
import subprocess
import time
import uuid
from urllib.parse import unquote
from load_native_lab import ROOT,LAB_ID,lab_directory,snapshot,identity
from live_add import atomic,digest,canonical,rows,path_rows,inspect_media,parent_edges
from live_relink_lab import command
from verify_native_import import load
from store_equivalence import normalized_store

# General rename remains disabled. The accepted, exact-scope source routes below
# uses narrow source setters and stock bin-only persistence.
PERSISTENT_RENAME_ENABLED=False
STILL_FORMATS={'.png','.jpg','.jpeg'}
RENAME_ONLY_FORMATS={'.gif','.wav','.mp3','.mp4','.mov'}


def lab_rename_allowed(job):
    """Explicit opt-in for the single reopened and accepted laboratory source."""
    if os.environ.get('CAPSYNC_LAB_PNG_RENAME')!='1':return False
    try:
        proof=json.loads((ROOT/'artifacts/LiveAddLab/png-rename-proof.json').read_text(encoding='utf8'))
    except (OSError,ValueError):
        scope=image_scope(job);return scope is not None and scope.get('allowRename') is not False
    if proof.get('acceptedAfterReopen') is True and proof.get('build')=='9.6.0.4097' and \
        all(proof.get(k)==job.get(k) for k in ['ProjectId','SourceId','BindingId','MaterialId']):return True
    scope=image_scope(job)
    return scope is not None and scope.get('allowRename') is not False


def known_alias_ids(job):
    scope=image_scope(job)
    if scope is not None:return scope.get('RelatedMaterialIds',[])
    try:proof=json.loads((ROOT/'artifacts/LiveAddLab/png-rename-proof.json').read_text(encoding='utf8'))
    except (OSError,ValueError):return None
    if proof.get('acceptedAfterReopen') is True and proof.get('build')=='9.6.0.4097' and \
        all(proof.get(k)==job.get(k) for k in ['ProjectId','SourceId','BindingId','MaterialId']):
        return proof.get('RelatedMaterialIds',[job['MaterialId']])
    return None


def image_scope(job):
    try:proof=json.loads((ROOT/'artifacts/LiveAddLab/image-update-scopes.json').read_text(encoding='utf8'))
    except (OSError,ValueError):return None
    scopes=[s for s in proof.get('scopes',[]) if s.get('build')=='9.6.0.4097' and s.get('isolatedLabExperiment') is True and
            all(s.get(k)==job.get(k) for k in ['ProjectId','SourceId','BindingId','MaterialId'])]
    return scopes[0] if len(scopes)==1 else None


def source_referenced(timeline,path):
    expected=str(path).replace('\\','/').casefold()
    def visit(value):
        if isinstance(value,str):
            normalized=value.replace('\\','/').casefold()
            if normalized.endswith(expected):return True
            if normalized.startswith(('local:','file:')):
                return unquote(normalized.split('?',1)[0].split('#',1)[0]).endswith(expected)
            return False
        if isinstance(value,dict):return any(visit(v) for v in value.values())
        if isinstance(value,list):return any(visit(v) for v in value)
        return False
    return visit(timeline)


def neutral(value):
    if isinstance(value,dict):return all(neutral(v) for v in value.values())
    if isinstance(value,list):return not value
    return value in (None,'',False,0)


class StableFile:
    def __init__(self,path):
        self.k=C.WinDLL('kernel32',use_last_error=True)
        self.k.CreateFileW.argtypes=[W.LPCWSTR,W.DWORD,W.DWORD,C.c_void_p,W.DWORD,W.DWORD,W.HANDLE];self.k.CreateFileW.restype=W.HANDLE
        self.k.CloseHandle.argtypes=[W.HANDLE]
        self.handle=self.k.CreateFileW(str(path),0x80000000,1,None,3,0x80,None) # read, share read only
        if self.handle==C.c_void_p(-1).value:raise OSError('Source is being written, moved or deleted')
    def close(self):self.k.CloseHandle(self.handle)
    def identity(self):
        class Info(C.Structure):
            _fields_=[('Attributes',W.DWORD),('Creation',W.FILETIME),('Access',W.FILETIME),('Write',W.FILETIME),
                ('Volume',W.DWORD),('SizeHigh',W.DWORD),('SizeLow',W.DWORD),('Links',W.DWORD),('IndexHigh',W.DWORD),('IndexLow',W.DWORD)]
        call=self.k.GetFileInformationByHandle;call.argtypes=[W.HANDLE,C.POINTER(Info)];call.restype=W.BOOL
        info=Info()
        if not call(self.handle,C.byref(info)) or not (info.IndexHigh or info.IndexLow):
            raise OSError('Physical source identity unavailable')
        if info.Links!=1:raise ValueError('Hard-linked photo requires an unambiguous identity policy')
        return f'{info.Volume:08X}:{info.IndexHigh:08X}{info.IndexLow:08X}'


def segment_map(doc):return {s['id']:s for t in doc['timeline']['tracks'] for s in t['segments']}
def video_map(doc):return {v['id']:v for v in doc['timeline']['materials']['videos']}


def plain_photo(video):
    """Refuse source-side edits that the stock replace command can reset."""
    crop={'upper_left_x':0.0,'upper_left_y':0.0,'upper_right_x':1.0,'upper_right_y':0.0,
          'lower_left_x':0.0,'lower_left_y':1.0,'lower_right_x':1.0,'lower_right_y':1.0}
    empty=['video_algorithm','video_mask_stroke','video_mask_shadow','stable','matting',
           'beauty_face_auto_preset','beauty_face_auto_preset_infos','beauty_face_preset_infos',
           'surface_trackings','pre_applied_vip_materials']
    absent=['reverse_path','intensifies_path','reverse_intensifies_path','intensifies_audio_path',
            'cartoon_path','beauty_body_preset_id','beauty_body_auto_preset','smart_motion',
            'multi_camera_info','freeze','corner_pin','content_feature_info','workflow_node_id',
            'live_photo_cover_path','audio_fade']
    return video.get('type')=='photo' and video.get('crop')==crop and video.get('crop_scale')==1.0 and \
        video.get('crop_ratio')=='free' and all(neutral(video.get(k)) for k in empty) and \
        not any(video.get(k) for k in absent)


def clip_check(before,after,step,new_path,width,height):
    segment=segment_map(after).get(step['segment']['id'])
    if not segment:return False,'Target clip disappeared'
    expected=deepcopy(step['segment']);expected['material_id']=segment['material_id']
    if segment!=expected:return False,'Target clip properties changed'
    video=video_map(after).get(segment['material_id'])
    if not video or canonical(video.get('path',''))!=canonical(new_path) or video.get('width')!=width or video.get('height')!=height:
        return False,'Target source metadata not updated'
    original=deepcopy(step['video'])
    for key in ['id','path','unique_id']:original[key]=video.get(key)
    if video!=original:return False,'Other source properties changed'
    if digest(Path(new_path)).casefold()!=step['hash'].casefold():return False,'Applied source bytes changed'
    return True,None


def preservation(before,after,job,steps):
    result=deepcopy(after);old_rows={v['id']:v for v in rows(before)};new_rows={v['id']:v for v in rows(result)};errors=[]
    if old_rows.keys()!=new_rows.keys():errors.append('Registry IDs changed')
    primary=old_rows.get(job['MaterialId'])
    related=job.get('RelatedMaterialIds',[job['MaterialId']])
    if len(set(related))!=len(related) or job['MaterialId'] not in related:errors.append('Invalid shared-source identities')
    for identifier in related:
        own=new_rows.get(identifier);previous=old_rows.get(identifier)
        if not own or not previous or not primary or canonical(previous.get('file_Path',''))!=canonical(primary.get('file_Path','')):
            errors.append('Shared-source alias is not the exact original path');continue
        expected_label=Path(job['SourcePath']).name if previous.get('extra_info')==Path(previous['file_Path']).name else previous.get('extra_info')
        if canonical(own.get('file_Path',''))!=canonical(job['SourcePath']):errors.append('Bin source not applied')
        elif own.get('extra_info')!=expected_label:errors.append('Bin label not applied')
        else:own['file_Path']=previous['file_Path'];own['extra_info']=previous['extra_info']
    service='cd484075-d92a-4bc9-b45c-d093d2f9e71b'
    if service in old_rows and service in new_rows:
        if not old_rows[service].get('file_Path') and old_rows[service].get('metetype')=='none':
            for key in ['create_time','import_time','import_time_ms']:new_rows[service][key]=old_rows[service][key]
    def registry_groups(groups):
        normalized=deepcopy(groups)
        for group in normalized:group['value']=sorted(group.get('value',[]),key=lambda row:json.dumps(row,sort_keys=True,separators=(',',':')))
        return normalized
    if registry_groups(result['meta']['draft_materials'])!=registry_groups(before['meta']['draft_materials']):errors.append('Other registry properties changed')
    envelope=lambda meta:{k:v for k,v in meta.items() if k not in {'draft_materials','tm_draft_modified'}}
    if envelope(result['meta'])!=envelope(before['meta']):errors.append('Other project metadata changed')
    if normalized_store(result['store'])!=normalized_store(before['store']):errors.append('Folders/edges changed')
    segments=segment_map(result);videos=video_map(result)
    counts=Counter(v['id'] for v in result['timeline']['materials']['videos'])
    if any(n!=1 for n in counts.values()):errors.append('Duplicate timeline source IDs')
    for step in steps:
        good,reason=clip_check(before,after,step,job['SourcePath'],step['video']['width'],step['video']['height'])
        if not good:errors.append(reason);continue
        current=segments[step['segment']['id']];new_id=current['material_id'];old_id=step['video']['id']
        current['material_id']=step['segment']['material_id']
        # Stock replacement can leave the original source object when another clip still uses it.
        if new_id!=old_id:
            result['timeline']['materials']['videos']=[v for v in result['timeline']['materials']['videos'] if v['id']!=new_id]
        if not any(v['id']==old_id for v in result['timeline']['materials']['videos']):
            result['timeline']['materials']['videos'].append(deepcopy(step['video']))
        else:
            existing=next(v for v in result['timeline']['materials']['videos'] if v['id']==old_id)
            if new_id!=old_id and existing!=step['video']:
                errors.append('Retained shared source changed')
            elif new_id==old_id:
                existing.clear();existing.update(deepcopy(step['video']))
    # Video objects are keyed by UUID; restore the original serialization order.
    order={v['id']:i for i,v in enumerate(before['timeline']['materials']['videos'])}
    result['timeline']['materials']['videos'].sort(key=lambda v:order.get(v['id'],len(order)))
    if result['timeline']!=before['timeline']:errors.append('Other timeline data changed')
    return {'accepted':not errors,'errors':errors,'binId':job['MaterialId'],'clips':[s['segment']['id'] for s in steps]}


def execute(job,journal):
    def reply(status,reason=None):return {'JobId':job['Id'],'Status':status,'MaterialId':job['MaterialId'] if status=='Verified' else None,'Reason':reason}
    root=ROOT/'research/fixtures/AutoAddLab';project=lab_directory();source=Path(job['SourcePath']);old=root/job['PreviousPath']
    if job['ProjectId']!=LAB_ID or Path(job['ProjectDirectory']).resolve()!=project.resolve() or Path(job['RootPath']).resolve()!=root.resolve() or \
        not source.resolve().is_relative_to(root.resolve()) or source.resolve()!=(root/job['RelativePath']).resolve() or old.parent.resolve()!=source.parent.resolve() or \
        source.suffix.lower() not in STILL_FORMATS|RENAME_ONLY_FORMATS or old.suffix.lower() not in STILL_FORMATS|RENAME_ONLY_FORMATS:return reply('Conflict','Unsupported update scope')
    run=journal/job['Id'];(run/'evidence').mkdir(parents=True,exist_ok=True);record_path=run/'journal.json'
    record=json.loads(record_path.read_text(encoding='utf8')) if record_path.exists() else {'job':job,'stage':'planned'}
    if record['job']!=job:return reply('Conflict','Update job changed')
    def save():atomic(record_path,record)
    if record['stage']=='conflict':return reply('Conflict',record['reason'])
    rename=canonical(old)!=canonical(source) or 'Path' in [part.strip() for part in job.get('Flags','').split(',')]
    if rename:
        from live_source_path import applies as source_path_applies, execute as source_path_execute
        if source_path_applies(job):
            # Never fall through to the previous generic relink/clip replace
            # route after selecting the source-preserving adapter.
            try:source_lock=StableFile(source)
            except OSError:return reply('Waiting','Wait for a stable source file')
            try:return source_path_execute(job,run)
            finally:source_lock.close()
    rename_only=source.suffix.lower() in RENAME_ONLY_FORMATS
    if rename_only and (not rename or job.get('Flags')!='Path'):return reply('Waiting','Non-image content update adapter is not ready')
    if record['stage']=='planned' and rename and not (PERSISTENT_RENAME_ENABLED or lab_rename_allowed(job)):
        return reply('Waiting','Persistent rename adapter is not ready')
    if record['stage']=='completed':
        current=load(project);owned=[v for v in rows(current) if v['id']==job['MaterialId']]
        if len(owned)!=1 or canonical(owned[0].get('file_Path',''))!=canonical(source):return reply('Conflict','Completed bin ownership changed')
        for step in record['clips']:
            segment=segment_map(current).get(step['segment']['id'])
            video=video_map(current).get(segment['material_id']) if segment else None
            if not video or canonical(video.get('path',''))!=canonical(source):return reply('Conflict','Completed clip source changed')
        return reply('Verified')
    try:identity()
    except (OSError,subprocess.SubprocessError,ValueError):return reply('Waiting','Open the lab project')
    try:lock=StableFile(source)
    except OSError:return reply('Waiting','Wait for a stable source file')
    try:
        if not source.is_file() or source.stat().st_size!=job['Size'] or digest(source).casefold()!=job['Hash'].casefold():
            return reply('Superseded' if record['stage']=='planned' else 'Unknown','Source revision changed')
        if any(p.lstat().st_file_attributes&0x400 for p in [source,*source.parents] if p.is_relative_to(root)):return reply('Conflict','Linked source refused')
        doc=load(project)
        if record['stage']=='planned':
            candidates=[v for v in rows(doc) if v['id']==job['MaterialId']]
            if len(candidates)!=1 or canonical(candidates[0].get('file_Path',''))!=canonical(old):return reply('Conflict','Owned old bin path changed')
            row=candidates[0]
            aliases=path_rows(doc,old)
            if row.get('extra_info')!=old.name:return reply('Waiting','Custom primary bin label')
            if not 1<=len(aliases)<=16 or len({r['id'] for r in aliases})!=len(aliases):return reply('Conflict','Invalid exact-source aliases')
            scope=image_scope(job)
            allowed_aliases=known_alias_ids(job)
            if rename and (allowed_aliases is None or sorted(allowed_aliases)!=sorted(r['id'] for r in aliases)):
                return reply('Waiting','Independent source ownership proof required')
            if source.suffix.lower() in {'.jpg','.jpeg'}|RENAME_ONLY_FORMATS and (scope is None or
                sorted(scope.get('RelatedMaterialIds',[]))!=sorted(r['id'] for r in aliases)):
                return reply('Waiting','Independent source ownership proof required')
            if rename_only and (source_referenced(doc['timeline'],old) or scope.get('ByteHash','').casefold()!=job['Hash'].casefold()):
                return reply('Waiting','Used non-image source or changed bytes needs a separate adapter')
            if any(r['id']!=job['MaterialId'] for r in path_rows(doc,source)):
                return reply('Waiting','Destination path already belongs to another bin material')
            directory=Path(job['PreviousPath']).parent.as_posix()
            destination=job['MediaFolderId']
            if directory!='.':
                folders=[]
                for entry in (journal.parent/'folder-journal').glob('*/journal.json'):
                    mapping=json.loads(entry.read_text(encoding='utf8'))
                    folder=mapping['job']
                    if mapping['stage']=='completed' and folder.get('BindingId')==job['BindingId'] and folder['ProjectId']==job['ProjectId'] and \
                        canonical(folder['RootPath'])==canonical(root) and folder['RelativePath'].replace('\\','/').casefold()==directory.casefold():folders.append(folder['FolderId'])
                if len(folders)!=1:return reply('Conflict','No unique owned folder mapping')
                destination=folders[0]
            if parent_edges(doc,job['MaterialId'])!=[{'child_id':job['MaterialId'],'parent_id':destination}]:return reply('Conflict','Owned bin was moved manually')
            info=inspect_media(source);stream=info['probe']['streams'][0]
            width=stream.get('width',0);height=stream.get('height',0)
            if row.get('width')!=width or row.get('height')!=height:return reply('Waiting','Changed geometry needs a separate adapter')
            clips=[];videos=video_map(doc)
            for segment in segment_map(doc).values():
                video=videos.get(segment['material_id'])
                if not video or canonical(video.get('path',''))!=canonical(old):continue
                if not plain_photo(video) or video['width']!=width or video['height']!=height:
                    return reply('Waiting','Complex source processing needs a separate adapter')
                clips.append({'segment':segment,'video':video,'hash':job['Hash'],'stage':'planned'})
            if not clips and not rename:return reply('Waiting','Unplaced PNG cache refresh adapter is not ready')
            before=run/('before-'+uuid.uuid4().hex);snapshot(project,before)
            # Content-only changes already have the correct persisted bin path.
            # No native node setters or view refreshes are needed for them.
            record.update({'before':before.name,'clips':clips,'width':width,'height':height,
                           'relatedMaterialIds':sorted(r['id'] for r in aliases) if rename else [job['MaterialId']],
                           'stage':'dispatchingBin' if rename else 'updatingClips',
                           'binProof':'SDK persistent rename' if rename else 'existing persisted path'});save()
            if rename:
                request={'id':job['Id'],'oldPath':str(old),'newPath':str(source),'materialId':job['MaterialId'],'hash':job['Hash'],
                         'relatedMaterialIds':record['relatedMaterialIds']}
                result=command(request,run,1);record['native']=result;save()
                if result.get('status')=='rejected':record['stage']='planned';save();return reply('Waiting',result.get('reason'))
        if record['stage']=='dispatchingBin':
            if not record.get('native'):
                saved=[json.loads(p.read_text(encoding='utf8')) for p in (run/'evidence').glob('native-relink-1-*.json')]
                matching=[r for r in saved if r.get('jobId')==job['Id'] and r.get('status')=='changed']
                if len(matching)==1:record['native']=matching[0];save()
            native=record.get('native',{})
            if native.get('status')!='changed' or not all(native.get(k) is True for k in ['persistentAssigned','idPreserved','pathAssigned','nameAssigned','navigationUnchanged','foregroundUnchanged','focusUnchanged','cursorUnchanged']):
                return reply('Unknown','Bin completion unclear; not replaying')
            if sorted(native.get('updatedAliasIds',[]))!=record.get('relatedMaterialIds',[job['MaterialId']]):
                return reply('Unknown','Shared-source alias completion unconfirmed')
            doc=load(project);matches=[v for v in rows(doc) if v['id']==job['MaterialId']]
            if len(matches)!=1:return reply('Conflict','Owned bin disappeared or was duplicated')
            row=matches[0];until=time.monotonic()+5
            while time.monotonic()<until:
                doc=load(project);row=next(v for v in rows(doc) if v['id']==job['MaterialId'])
                if canonical(row.get('file_Path',''))==canonical(source) and row.get('extra_info')==source.name:break
                time.sleep(.2)
            # Never change clips while only the transient UI path is confirmed.
            if canonical(row.get('file_Path',''))!=canonical(source) or row.get('extra_info')!=source.name:
                return reply('Unknown','Bin persistence unconfirmed')
            bin_check=preservation(load(run/record['before']),doc,
                {**job,'RelatedMaterialIds':record.get('relatedMaterialIds',[job['MaterialId']])},[])
            if not bin_check['accepted']:return reply('Unknown','Bin aliases or other data unconfirmed: '+'; '.join(bin_check['errors']))
            record['stage']='updatingClips';save()
        for index,step in enumerate(record['clips']):
            if step['stage']=='completed':continue
            current=load(project)
            if step['stage']=='planned':
                if segment_map(current).get(step['segment']['id'])!=step['segment']:return reply('Conflict','Clip changed before dispatch')
                request=run/f'clip-{index}.request.json';output=run/f'clip-{index}.reply.json'
                atomic(request,{'projectId':LAB_ID,'segmentId':step['segment']['id'],'source':str(source),'width':record['width'],'height':record['height']})
                step['stage']='dispatching';save()
                result=subprocess.run(['node',str(ROOT/'tools/call_update_clip.mjs'),str(request),str(output)],capture_output=True,text=True,timeout=15,creationflags=subprocess.CREATE_NO_WINDOW)
                if result.returncode:return reply('Unknown','Clip completion unclear; retained for reconciliation')
            output=run/f'clip-{index}.reply.json'
            if not output.exists():return reply('Unknown','No clip reply; not replaying')
            response=json.loads(output.read_text(encoding='utf8'))
            if response.get('exitCode')!=0 or response.get('draftId')!=LAB_ID:return reply('Conflict','Stock clip replacement failed')
            until=time.monotonic()+5;good=False;reason=None
            while time.monotonic()<until:
                current=load(project);good,reason=clip_check(load(run/record['before']),current,step,str(source),record['width'],record['height'])
                if good:break
                time.sleep(.2)
            if not good:return reply('Unknown',reason)
            step['stage']='completed';save()
        after=run/('after-'+uuid.uuid4().hex);snapshot(project,after);record['after']=after.name;save()
        check_job={**job,'RelatedMaterialIds':record.get('relatedMaterialIds',[job['MaterialId']])}
        check=preservation(load(run/record['before']),load(after),check_job,record['clips']);atomic(run/'acceptance.json',check)
        if not check['accepted']:record['stage']='conflict';record['reason']='; '.join(check['errors']);save();return reply('Conflict',record['reason'])
        if rename:
            # On recovery, verify again without replaying completed native/clip commands.
            record['stage']='verifyingDurability';save()
            baseline=load(run/record['before']);until=time.monotonic()+30
            while True:
                current=load(project);check=preservation(baseline,current,check_job,record['clips'])
                if not check['accepted']:
                    final=run/('durability-conflict-'+uuid.uuid4().hex);snapshot(project,final)
                    record['stage']='conflict';record['reason']='; '.join(check['errors']);record['durabilitySnapshot']=final.name
                    atomic(run/'durability.json',check);save();return reply('Conflict',record['reason'])
                if time.monotonic()>=until:break
                time.sleep(.5)
            final=run/('durability-after-'+uuid.uuid4().hex);snapshot(project,final)
            check=preservation(baseline,load(final),check_job,record['clips']);atomic(run/'durability.json',check)
            record['durabilitySnapshot']=final.name
            if not check['accepted']:
                record['stage']='conflict';record['reason']='; '.join(check['errors']);save();return reply('Conflict',record['reason'])
        record['stage']='completed';save();return reply('Verified')
    finally:lock.close()


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--request',type=Path,required=True);parser.add_argument('--journal',type=Path,required=True)
    args=parser.parse_args();journal=args.journal.resolve();request=args.request.resolve()
    if not journal.is_relative_to(ROOT/'artifacts') or request.parent!=journal:raise ValueError('Owned journal required')
    job=json.loads(request.read_text(encoding='utf8'))
    if request.name!=job['Id']+'.request.json':raise ValueError('Request identity mismatch')
    with (journal/'executor.lock').open('a+b') as mutex:
        if mutex.tell()==0:mutex.write(b'0');mutex.flush()
        mutex.seek(0);msvcrt.locking(mutex.fileno(),msvcrt.LK_NBLCK,1)
        try:result=execute(job,journal)
        finally:mutex.seek(0);msvcrt.locking(mutex.fileno(),msvcrt.LK_UNLCK,1)
    print(json.dumps(result))


if __name__=='__main__':main()
