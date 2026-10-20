"""Finish a proven created folder by reading only; never repeat a mutation."""
from copy import deepcopy
import json,time,uuid
from explorer_native_runtime_v3 import compare_folder,template_exact
from explorer_project_io_v2 import load_project,snapshot_project
from explorer_saved_graph_v2 import read
from live_add import atomic
from load_native_lab import digest

def compare(before,after,job,original,current):
    checked=compare_folder(before,after,job)
    left,right=deepcopy(before['meta']),deepcopy(after['meta'])
    for value in (left,right):
        value.pop('draft_materials',None);value.pop('tm_draft_modified',None)
    if left!=right:checked['errors'].append('Other metadata changed')
    if not template_exact(original,current,before['timeline']):checked['errors'].append('Complete template changed')
    checked['accepted']=not checked['errors']
    return checked

def complete(data,context):
    if data.get('kind')!='folder':return False
    job=data['job'];run=context.private/'native-journal'/str(uuid.UUID(job['Id']));marker=run/'journal.json'
    if not marker.exists():return False
    record=json.loads(marker.read_bytes())
    if record.get('stage') not in ('Dispatching','VerifyingSave') or record.get('kind')!='folder' or record.get('job')!=job:return False
    receipt=run/'evidence/folder.json'
    if not receipt.exists():return False
    proof=json.loads(receipt.read_bytes())
    if proof.get('status')!='created' or proof.get('jobId')!=job['Id'] or proof.get('folderId')!=job['FolderId'] or proof.get('name')!=job['Name']:return False
    if not all(proof.get(k) is True for k in ('folderAppended','metadataConstructed','focusUnchanged','foregroundUnchanged','navigationUnchanged')):return False
    before=load_project(run/'before');case=run/('read-only-completion-'+uuid.uuid4().hex);case.mkdir()
    for name,delay in (('immediate',0),('saved',30)):
        if delay:time.sleep(delay)
        sample=case/name;sample.mkdir();read(data,context,sample)
        snapshot_project(context.directory,sample/'project')
        checked=compare(before,load_project(sample/'project'),job,run/'before',sample/'project')
        atomic(sample/'comparison.json',checked)
        if not checked['accepted']:return False
    atomic(case/'acceptance.json',{'accepted':True,'nativeMutations':0,'savedSeconds':30,'wholeSdkSavedGraph':True,'originalReceiptSha256':digest(receipt)})
    record.update(stage='Verified',materialId=job['FolderId'],readOnlyCompletion=str(case.relative_to(run)),readOnlyCompletionSha256=digest(case/'acceptance.json'))
    atomic(marker,record)
    return True
