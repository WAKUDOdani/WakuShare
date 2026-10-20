"""One journaled legacy-folder promotion; old creation receipts stay immutable."""
from copy import deepcopy
import ctypes as C
import json
import time
from explorer_native_runtime_v2 import Lease,template_exact,normalize_stock_service
from explorer_project_io_v2 import load_project,snapshot_project
from live_add import atomic,parent_edges,require_folder
from load_native_lab import digest
from store_equivalence import normalized_store

class Request(C.Structure):
    _fields_=[('size',C.c_uint32),('version',C.c_uint32),('output',C.c_wchar*1024),('name',C.c_wchar*81),('folderId',C.c_char*37),('parentId',C.c_char*37),('lease',Lease)]

def eligible(record,job):
    old=record['job']
    return record.get('stage')=='Verified' and record.get('kind')=='folder' and bool(old.get('ParentFolderId')) and job.get('ParentFolderId')=='' and {k:v for k,v in old.items() if k!='ParentFolderId'}=={k:v for k,v in job.items() if k!='ParentFolderId'}

def compare(before,after,job,old_parent,removed):
    errors=[];expected=deepcopy(before);after=normalize_stock_service(before,after)
    if parent_edges(before,job['FolderId'])!=[{'child_id':job['FolderId'],'parent_id':old_parent}]:errors.append('Legacy parent differs')
    require_folder(before,job['FolderId']);container=require_folder(before,old_parent)
    if container.get('display_name')!='WakuShare' or parent_edges(before,old_parent)!=[{'child_id':old_parent,'parent_id':''}]:errors.append('Legacy container differs')
    if removed:
        children=[r for g in before['store']['draft_virtual_store'] if g['type']==1 for r in g['value'] if r['parent_id']==old_parent]
        if children!=[{'child_id':job['FolderId'],'parent_id':old_parent}]:errors.append('Legacy container is not empty after promotion')
    for group in expected['store']['draft_virtual_store']:
        if group['type']==0 and removed:group['value']=[r for r in group['value'] if r['id']!=old_parent]
        if group['type']==1:
            if removed:group['value']=[r for r in group['value'] if r['child_id']!=old_parent]
            for row in group['value']:
                if row['child_id']==job['FolderId']:row['parent_id']=''
    if normalized_store(expected['store'])!=normalized_store(after['store']):errors.append('Complete hierarchy differs from root promotion')
    if before['timeline']!=after['timeline']:errors.append('Timeline changed')
    old_meta,new_meta=deepcopy(before['meta']),deepcopy(after['meta'])
    old_meta.pop('tm_draft_modified',None);new_meta.pop('tm_draft_modified',None)
    for document in (old_meta,new_meta):
        for group in document['draft_materials']:group['value'].sort(key=lambda row:json.dumps(row,sort_keys=True))
    if old_meta!=new_meta:errors.append('Complete material registry or metadata changed')
    return {'accepted':not errors,'errors':errors}

def promote(data,context,record,run):
    job=data['job'];case=run/'root-promotion'
    if case.exists():raise ValueError('Root promotion already attempted; never replay an uncertain move')
    case.mkdir();snapshot_project(context.directory,case/'before');before=load_project(case/'before')
    old_parent=record['job']['ParentFolderId'];require_folder(before,old_parent)
    atomic(case/'dispatch.json',{'stage':'Dispatching','previousJob':record['job'],'requestedJob':job})
    editor=data['editor'];key=editor['Project'];lease=Lease(processId=editor['ProcessId'],viewEpoch=editor['ViewEpoch'],location=key['Location'].replace('\\','/'),draftId=key['DraftId'].encode('ascii'),token=data['token'].encode('ascii'))
    receipt=context.invoke(editor['ProcessId'],'PromoteRoot','CapSync_ProductPromoteRootThread',Request(name=job['Name'],folderId=job['FolderId'].encode('ascii'),parentId=old_parent.encode('ascii'),lease=lease),case/'evidence/promote.json')
    if receipt.get('status')!='promoted' or not all(receipt.get(k) is True for k in ('sdkBinUnchanged','sdkDraftUnchanged','navigationUnchanged','focusUnchanged','foregroundUnchanged')):
        raise ValueError('Root promotion is unconfirmed; no command replay')
    # Stock removal saves asynchronously. A successful callback is not the
    # durable postimage. Bounded reads wait for that exact postimage; no replay.
    for sample in range(21):
        if sample:time.sleep(.25)
        after=load_project(context.directory)
        if compare(before,after,job,old_parent,receipt['removedEmptyLegacyContainer'])['accepted']:break
    for name,delay in (('immediate',0),('saved',1)):
        if delay:time.sleep(delay)
        snapshot_project(context.directory,case/name);after=load_project(case/name)
        result=compare(before,after,job,old_parent,receipt['removedEmptyLegacyContainer'])
        if not template_exact(case/'before',case/name,before['timeline']):result['errors'].append('Timeline template changed')
        result['accepted']=not result['errors'];atomic(case/(name+'-comparison.json'),result)
        if not result['accepted']:raise ValueError('Root promotion comparison differs; no replay')
    proof={'accepted':True,'folderId':job['FolderId'],'previousParent':old_parent,'newParent':'','requestedJob':job,'removedEmptyLegacyContainer':receipt['removedEmptyLegacyContainer'],'nativeCommands':1,'fileImports':0,'physicalFilesChanged':0}
    atomic(case/'acceptance.json',proof)
    record['rootPromotion']={'requestedJob':job,'proofSha256':digest(case/'acceptance.json')};atomic(run/'journal.json',record)
    return record

def proven(record,job,run):
    known=record.get('rootPromotion');path=run/'root-promotion/acceptance.json'
    if not known or known.get('requestedJob')!=job or not path.is_file() or path.stat().st_size>65536 or known.get('proofSha256')!=digest(path):return False
    proof=json.loads(path.read_text(encoding='utf8'))
    return proof.get('accepted') is True and proof.get('folderId')==job['FolderId'] and proof.get('previousParent')==record['job']['ParentFolderId'] and proof.get('newParent')=='' and proof.get('requestedJob')==job
