"""One durable append for a complete owned directory forest, no replay."""
import ctypes as C,json,time,uuid
from pathlib import Path
from copy import deepcopy
from explorer_product_scope_v3 import ProductScope
from explorer_transient_dispatch_v1 import invoke_command,rejected_output,rejected_before_mutation
from explorer_native_runtime_v3 import Lease,normalize_stock_service,template_exact
from explorer_project_io_v2 import load_project,snapshot_project
from live_add import atomic,rows,parent_edges,require_folder
from store_equivalence import normalized_store

class Request(C.Structure):_fields_=[('size',C.c_uint32),('version',C.c_uint32),('output',C.c_wchar*1024),('manifest',C.c_wchar*1024),('lease',Lease)]

def compare(before,after,jobs):
    after=normalize_stock_service(before,after);reduced=deepcopy(after);errors=[]
    identifiers={j['FolderId'] for j in jobs}
    if len(identifiers)!=len(jobs):errors.append('Directory forest IDs duplicated')
    folders=[r for g in before['store']['draft_virtual_store'] if g['type']==0 for r in g['value']]
    if any(r['id'] in identifiers for r in folders):errors.append('Directory forest is not fresh')
    for job in jobs:
        found=[r for g in after['store']['draft_virtual_store'] if g['type']==0 for r in g['value'] if r['id']==job['FolderId']]
        if len(found)!=1 or found[0].get('display_name')!=job['Name']:errors.append('Directory name/UUID unverified')
        if parent_edges(after,job['FolderId'])!=[{'child_id':job['FolderId'],'parent_id':job['ParentFolderId']}]:errors.append('Directory parent unverified')
    for g in reduced['store']['draft_virtual_store']:
        if g['type']==0:g['value']=[r for r in g['value'] if r['id'] not in identifiers]
        if g['type']==1:g['value']=[r for r in g['value'] if r['child_id'] not in identifiers]
    if normalized_store(reduced['store'])!=normalized_store(before['store']):errors.append('Unrelated complete tree changed')
    left,right=deepcopy(before['meta']),reduced['meta']
    for doc in (left,right):
        doc.pop('tm_draft_modified',None)
        for g in doc['draft_materials']:g['value'].sort(key=lambda r:json.dumps(r,sort_keys=True))
    if left!=right:errors.append('Complete registry or metadata changed')
    if before['timeline']!=after['timeline']:errors.append('Timeline changed')
    return {'accepted':not errors,'errors':list(dict.fromkeys(errors)),'folders':len(jobs)}

def execute(data):
    jobs=data['jobs'];batch=str(uuid.UUID(data['batchId']))
    if not 1<=len(jobs)<=4096 or len({j['Id'] for j in jobs})!=len(jobs):raise ValueError('Invalid forest membership')
    context=ProductScope({**data,'action':'execute','kind':'folder','job':jobs[0]})
    for job in jobs[1:]:context.validate_job({**data,'action':'execute','kind':'folder','job':job})
    if len({(j['ProjectId'],j['RootPath']) for j in jobs})!=1:raise ValueError('Forest crosses selected root ownership')
    run=context.private/'native-forests'/batch;run.mkdir(parents=True,exist_ok=True);marker=run/'journal.json'
    answer=lambda status,reason=None:{'Replies':[{'JobId':j['Id'],'Status':status,'MaterialId':j['FolderId'] if status=='Verified' else None,'Reason':reason} for j in jobs],'NativeCommands':0}
    known=None
    if marker.exists():
        record=json.loads(marker.read_text(encoding='utf8'))
        if record['jobs']!=jobs:raise ValueError('Durable forest membership changed')
        if record['stage']=='Verified':
            current=load_project(context.directory)
            for j in jobs:
                if require_folder(current,j['FolderId']).get('display_name')!=j['Name'] or parent_edges(current,j['FolderId'])!=[{'child_id':j['FolderId'],'parent_id':j['ParentFolderId']}]:return answer('Conflict','Verified forest changed independently')
            return answer('Verified')
        proof=run/record.get('attemptDirectory','.')/'evidence/forest.json'
        if not rejected_output(proof):return answer('Unknown','Prior forest dispatch is never repeated')
        # The old callback explicitly reported zero changes. Keep its receipt,
        # IDs and membership; a fresh preimage owns the next permitted attempt.
        known=record;record['stage']='RejectedBeforeMutation';atomic(marker,record)
        number=record.get('attemptNumber',0)+1;run=run/f'deferred-{number}';run.mkdir(exist_ok=False)
    before=load_project(context.directory);snapshot_project(context.directory,run/'before');atomic(run/'input.json',{'jobs':jobs});record={'stage':'Dispatching','jobs':jobs,'attemptNumber':known.get('attemptNumber',0)+1 if known else 0,'attemptDirectory':run.name if known else '.'};atomic(marker,record)
    editor=data['editor'];key=editor['Project'];lease=Lease(processId=editor['ProcessId'],viewEpoch=editor['ViewEpoch'],location=key['Location'].replace('\\','/'),draftId=key['DraftId'].encode('ascii'),token=data['token'].encode('ascii'))
    started=time.monotonic();receipt=invoke_command(editor['ProcessId'],'FolderBatch','CapSync_ProductFolderBatch',Request(manifest=str(run/'input.json'),lease=lease),run/'evidence/forest.json')
    if rejected_before_mutation(receipt):
        record.update(stage='RejectedBeforeMutation',reason=receipt.get('reason'));atomic(marker,record)
        return answer('Waiting','Wait for CapCut to finish the current action; no changes were made')
    if receipt.get('status')!='created' or receipt.get('count')!=len(jobs) or not all(receipt.get(k) is True for k in ('sdkBinUnchanged','sdkDraftUnchanged','navigationUnchanged','focusUnchanged','foregroundUnchanged')):return answer('Unknown','Forest completion unconfirmed; no replay')
    for delay in (0,.1,.3,.9,1.5,2):
        if delay:time.sleep(delay)
        if compare(before,load_project(context.directory),jobs)['accepted']:break
    for name,delay in (('immediate',0),('saved',1)):
        if delay:time.sleep(delay)
        snapshot_project(context.directory,run/name);checked=compare(before,load_project(run/name),jobs)
        if not template_exact(run/'before',run/name,before['timeline']):checked['errors'].append('Timeline template changed');checked['accepted']=False
        atomic(run/(name+'-comparison.json'),checked)
        if not checked['accepted']:return answer('Conflict','Complete directory forest comparison differs')
    record.update(stage='Verified',elapsedSeconds=time.monotonic()-started);atomic(marker,record)
    for job in jobs:
        individual=context.private/'native-journal'/job['Id'];individual.mkdir(exist_ok=False);atomic(individual/'journal.json',{'job':job,'kind':'folder','stage':'Verified','materialId':job['FolderId'],'forestId':batch})
    result=answer('Verified');result['NativeCommands']=1;return result
