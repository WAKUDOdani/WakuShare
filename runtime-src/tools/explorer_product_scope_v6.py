"""Validated private-worker ownership for the product native boundary.

No material ownership is inferred from names, hashes or prior path occupants.
The native callback independently rechecks the live SDK, tree and session lease.
"""
import hashlib
import json
from pathlib import Path
import uuid
from explorer_canonical_cache_v1 import canonical


def unique(items, predicate, reason):
    found=[item for item in items if predicate(item)]
    if len(found)!=1:raise ValueError(reason)
    return found[0]


def child(root, path, *, equal=False):
    root=Path(root).resolve();path=Path(path).resolve()
    if not path.is_relative_to(root) or (path==root and not equal):raise ValueError('Path escaped selected binding')
    return path


class ProductScope:
    def __init__(self,data):
        editor=data['editor'];key=editor.get('Project')
        if editor.get('Status')!='Project' or not key or editor['ProcessId']<=0 or editor['ViewEpoch']<=0:raise ValueError('Confirmed live project required')
        draft=str(uuid.UUID(key['DraftId'])).upper()
        if draft=='00000000-0000-0000-0000-000000000000':raise ValueError('Empty draft identity')
        location=Path(key['Location'])
        if not location.is_absolute() or not location.is_dir() or canonical(location)!=canonical(location.resolve()):raise ValueError('Canonical live project directory required')
        self.directory=location.resolve()
        normalized=str(self.directory).rstrip('\\/')
        expected='project-v1-'+hashlib.sha256((draft+'\0'+normalized.upper()).encode('utf8')).hexdigest()
        if key['Value']!=expected:raise ValueError('Project key differs from live identity and directory')
        self.project_key=key['Value']
        meta=json.loads((self.directory/'draft_meta_info.json').read_text(encoding='utf8'))
        self.sdk_id=meta['draft_id']
        if str(uuid.UUID(self.sdk_id)).upper()!=draft:raise ValueError('Live project metadata identity differs')
        state_path=Path(data['statePath']).resolve()
        self.private=state_path.parent
        self.state=json.loads(state_path.read_text(encoding='utf8'))
        self.bindings=[b for b in self.state['Bindings'] if b['ProjectId']==self.project_key]
        for binding in self.state['Bindings']:
            root=Path(binding['RootPath']).resolve()
            if self.private.is_relative_to(root) or root.is_relative_to(self.private):raise ValueError('Private state overlaps a source root')
        self.source_index={};self.folder_index={};self.binding_index={}
        for item in self.state['Sources']:self.source_index.setdefault((item['Id'],item['BindingId']),[]).append(item)
        for item in self.state.get('ManagedFolders',[]):
            if item.get('Status')=='Completed':self.folder_index.setdefault((item['Job']['BindingId'],item['Job']['RelativePath'].replace('\\','/')),[]).append(item)
        for item in self.bindings:self.binding_index.setdefault(item['Id'],[]).append(item)
        if data.get('job') is not None:self.validate_job(data)

    def binding(self,identifier,root):
        binding=unique(self.binding_index.get(identifier,[]),lambda b:True,'Binding is not owned by current project')
        if binding['Status'] not in ('Ready','WaitingForRootFolder','WaitingForCrossBindingAdapter') or canonical(binding['RootPath'])!=canonical(root):raise ValueError('Selected binding revision changed')
        return binding

    def validate_job(self,data):
        job=data['job'];kind=data.get('kind') or data['action']
        uuid.UUID(job['Id'])
        if job['ProjectId']!=self.project_key:raise ValueError('Job belongs to another project')
        self.previous_root=Path(job['RootPath']).resolve();self.destination_root=self.previous_root
        if kind=='folder':
            self.virtual_container=job['ParentFolderId']=='' and job['Name']=='WakuShare'
            source=child(self.previous_root,job['SourceDirectory'],equal=True)
            if not source.is_dir():raise ValueError('Selected source directory unavailable')
            # Initial container/media folders are assigned by the private main
            # process; all other folders belong to an existing binding root.
            candidates=[]
            for destination in data.get('destinations',[]):
                binding=self.binding(destination['Id'],destination['RootPath'])
                if binding['MediaFolderId']!=destination['MediaFolderId']:raise ValueError('Destination folder ownership changed')
                if canonical(destination['RootPath'])!=canonical(self.previous_root):continue
                if (job['FolderId'],job['ParentFolderId'],job['Name']) in (
                    (destination['ContainerFolderId'],'','WakuShare'),
                    (destination['MediaFolderId'],destination['ContainerFolderId'],destination['Name'])):candidates.append(destination)
            if not candidates:
                candidates=[b for b in self.bindings if canonical(b['RootPath'])==canonical(self.previous_root) and b['Status']=='Ready']
                if len(candidates)!=1:raise ValueError('Folder has no selected source owner')
                pending=[f['Job'] for f in self.state.get('ManagedFolders',[]) if f['Job']['Id']==job['Id']]
                record=unique(pending,lambda f:f['FolderId']==job['FolderId'] and f['ParentFolderId']==job['ParentFolderId'],'Folder has no durable ownership')
                if record['ProjectId']!=self.project_key or canonical(record['RootPath'])!=canonical(self.previous_root) or canonical(self.previous_root/record['RelativePath'])!=canonical(source):raise ValueError('Folder request differs from durable job')
            return
        binding=self.binding(job['BindingId'],job['RootPath'])
        target=binding['MediaFolderId']
        if kind in ('add','restore'):
            prefix=''
            for part in Path(job['RelativePath']).parts[:-1]:
                prefix=prefix+'/'+part if prefix else part
                owned=unique(self.folder_index.get((binding['Id'],prefix),[]),lambda f:True,'Import folder lacks durable ownership')
                folder_job=owned['Job']
                if folder_job['ProjectId']!=self.project_key or canonical(folder_job['RootPath'])!=canonical(binding['RootPath']) or folder_job['ParentFolderId']!=target:raise ValueError('Import folder ancestry changed')
                target=folder_job['FolderId']
        if target!=job['MediaFolderId']:raise ValueError('Owned media folder changed')
        owner=unique(self.source_index.get((job['SourceId'],binding['Id']),[]),lambda s:True,'Logical source owner absent')
        if owner['Version']!=job['SourceVersion'] or owner['Hash']!=job['Hash'] or owner['Size']!=job['Size']:raise ValueError('Logical source revision changed')
        if kind=='transfer':
            destination=self.binding(job['DestinationBindingId'],job['DestinationRootPath'])
            if destination['MediaFolderId']!=job['DestinationMediaFolderId']:raise ValueError('Transfer destination folder changed')
            self.destination_root=Path(destination['RootPath']).resolve()
        if canonical(child(self.destination_root,self.destination_root/job['RelativePath']))!=canonical(job['SourcePath']):raise ValueError('Source request escaped selected root')
        if kind not in ('add','restore') and owner.get('MaterialId')!=job['MaterialId']:raise ValueError('Material owner changed')
        if kind not in ('presence','delete') and owner.get('FileIdentity')!=(job.get('FileIdentity') or data.get('fileIdentity')):raise ValueError('Physical source identity differs')

    def invoke(self,pid,adapter,export,request,output):
        from explorer_product_bridge_v5 import invoke_command
        return invoke_command(pid,adapter,export,request,output)
