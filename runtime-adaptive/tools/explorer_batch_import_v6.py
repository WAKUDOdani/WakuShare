"""One journaled stock multi-file drop, one tree move, full batch comparisons.

No per-file native process, no idle polling, no replay of uncertain batches.
Physical source locks and complete project ownership remain mandatory.
"""
import ctypes as C,json,time,uuid
from contextlib import ExitStack
from copy import deepcopy
from pathlib import Path
from explorer_product_scope_v6 import ProductScope
from explorer_operation_stage_v1 import stage
from explorer_batch_journals_v1 import materialize
from explorer_native_runtime_v3 import Drop,Lease,template_exact,normalize_stock_service
from explorer_project_io_v2 import load_project,snapshot_project
from explorer_transient_dispatch_v3 import invoke_command
from live_add import atomic,canonical,rows,preservation,parent_edges,require_folder
from live_update import StableFile
from load_native_lab import digest
from explorer_batch_compare_v3 import compare
from explorer_canonical_cache_v1 import canonical

class ImportRequest(C.Structure):_fields_=Drop._fields_+[('batchManifest',C.c_wchar*1024)]
class MoveRequest(C.Structure):_fields_=[('size',C.c_uint32),('version',C.c_uint32),('output',C.c_wchar*1024),('manifest',C.c_wchar*1024),('lease',Lease)]

def execute(data):
    jobs=data['jobs'];batch_id=str(uuid.UUID(data['batchId']))
    if not 1<=len(jobs)<=16384 or len({j['Id'] for j in jobs})!=len(jobs):raise ValueError('Invalid batch membership')
    stage('preparing')
    context=ProductScope({**data,'action':'execute','kind':'add','job':jobs[0]})
    for job in jobs[1:]:context.validate_job({**data,'action':'execute','kind':'add','job':job})
    if len({(j['ProjectId'],j['BindingId'],j['RootPath']) for j in jobs})!=1:raise ValueError('Batch crosses destination ownership')
    run=context.private/'native-batches'/batch_id;run.mkdir(parents=True,exist_ok=True);marker=run/'journal.json'
    known=json.loads(marker.read_text(encoding='utf8')) if marker.exists() else None
    def result(status,reason=None,identifiers=None,rejected=()):
        return {'Replies':[{'JobId':j['Id'],'Status':'RejectedFormat' if j['Id'] in rejected else status,'MaterialId':(identifiers or {}).get(j['Id']),'Reason':reason} for j in jobs],'NativeCommands':0}
    if known:
        if known['jobs']!=jobs:raise ValueError('Durable batch membership changed')
        if known['stage']=='Verified':
            current=load_project(context.directory)
            for j in jobs:
                if j['Id'] in known['rejected']:continue
                found=[r for r in rows(current) if r['id']==known['materials'][j['Id']] and canonical(r.get('file_Path',''))==canonical(j['SourcePath'])]
                if len(found)!=1 or parent_edges(current,found[0]['id'])!=[{'child_id':found[0]['id'],'parent_id':j['MediaFolderId']}]:return result('Conflict','Verified batch material changed independently')
            materialize(context.private,jobs,batch_id,known['materials'],known['rejected'])
            return result('Verified',identifiers=known['materials'],rejected=known['rejected'])
        if known['stage']!='RejectedBeforeMutation':return result('Unknown','Prior batch dispatch is never repeated; retained receipt needs inspection')
        # Only an explicit dispatched=false receipt permits another attempt;
        # retain every rejected output in its original immutable directory.
        proof=run/known.get('attemptDirectory','.')/'evidence/target-drop.json'
        rejected_proof=json.loads(proof.read_text(encoding='utf8'))
        if rejected_proof.get('status')!='rejected' or rejected_proof.get('dispatched') is not False:raise ValueError('Zero-dispatch proof unavailable')
        number=known.get('attemptNumber',0)+1;run=run/f'deferred-{number}';run.mkdir(exist_ok=False)
    before=load_project(context.directory);require_folder(before,jobs[0]['MediaFolderId']);old_ids={r['id'] for r in rows(before)}
    if len(old_ids)+len(jobs)>=16384:return result('Conflict','ProjectVerificationCapacityExceeded')
    registered_paths={canonical(r['file_Path']) for r in rows(before) if r.get('file_Path')}
    source_paths={j['Id']:canonical(j['SourcePath']) for j in jobs}
    if any(path in registered_paths for path in source_paths.values()):return result('Conflict','A batch source already exists without a matching receipt')
    editor=data['editor'];key=editor['Project'];lease=Lease(processId=editor['ProcessId'],viewEpoch=editor['ViewEpoch'],location=key['Location'].replace('\\','/'),draftId=key['DraftId'].encode('ascii'),token=data['token'].encode('ascii'))
    started=time.monotonic()
    with ExitStack() as stack:
        for job in jobs:
            stable=StableFile(Path(job['SourcePath']));stack.callback(stable.close)
            if stable.identity()!=job['FileIdentity'] or digest(Path(job['SourcePath'])).upper()!=job['Hash'].upper():return result('Waiting','Batch source changed before dispatch')
        snapshot_project(context.directory,run/'before');atomic(run/'input.json',{'jobs':jobs});record={'stage':'Dispatching','jobs':jobs,'attemptNumber':known.get('attemptNumber',0)+1 if known else 0,'attemptDirectory':run.name if known else '.'};atomic(marker,record)
        first=jobs[0];stage('importing');receipt=invoke_command(editor['ProcessId'],'BatchImport','CapSync_ExplorerTargetDropThread',ImportRequest(hiddenRequired=2,source=first['SourcePath'],meta=str(context.directory/'draft_meta_info.json'),sha256=first['Hash'].encode(),root=first['RootPath'],jobId=batch_id.encode(),lease=lease,batchManifest=str(run/'input.json')),run/'evidence/target-drop.json')
        if receipt.get('status')=='rejected' and receipt.get('dispatched') is False and receipt.get('decoderRejected') is not True:
            record.update(stage='RejectedBeforeMutation',reason=receipt.get('reason'));atomic(marker,record)
            if record['attemptNumber']<2 and receipt.get('reason')=='project document unavailable':
                time.sleep(.25);return execute(data)
            return result('Waiting','No import was dispatched; wait for the same project to become ready')
        rejected=receipt.get('rejectedJobs',[]);accepted=receipt.get('acceptedJobs',[])
        if len(accepted)+len(rejected)!=len(jobs) or set(accepted)&set(rejected) or set(accepted+rejected)!={j['Id'] for j in jobs}:return result('Unknown','Native batch membership unconfirmed')
        if not accepted and receipt.get('dispatched') is False and receipt.get('decoderRejected') is True:
            record.update(stage='Verified',materials={},rejected=rejected);atomic(marker,record);return result('Verified',identifiers={},rejected=rejected)
        if receipt.get('status')!='dispatched-unconfirmed' or not all(receipt.get(k) is True for k in ('enterAccepted','moveAccepted','dropAccepted','focusUnchanged','foregroundUnchanged','navigationUnchanged')):return result('Unknown','Native batch drop unconfirmed; no replay')
        selected=[j for j in jobs if j['Id'] in accepted];identifiers={};deadline=time.monotonic()+max(60,min(600,len(selected)*.2))
        while time.monotonic()<deadline:
            current=load_project(context.directory);identifiers={};fresh_paths={}
            for row in rows(current):
                if row['id'] not in old_ids and row.get('file_Path'):fresh_paths.setdefault(canonical(row['file_Path']),[]).append(row['id'])
            for j in selected:
                matches=fresh_paths.get(source_paths[j['Id']],[])
                if len(matches)==1:identifiers[j['Id']]=matches[0]
            if len(identifiers)==len(selected):break
            time.sleep(.1)
        if len(identifiers)!=len(selected):return result('Unknown','Batch completion is incomplete; no replay')
        stage('placing')
        checked=compare(before,current,selected,identifiers,receipt['folderId']);atomic(run/'import-comparison.json',checked)
        if not checked['accepted']:return result('Conflict','Full batch import comparison differs')
        record.update(stage='Moving',materials=identifiers,rejected=rejected);atomic(marker,record)
        destinations={j['Id']:j['MediaFolderId'] for j in selected}
        needs_move=any(j['MediaFolderId']!=receipt['folderId'] for j in selected)
        if needs_move:
            atomic(run/'move-input.json',{'targetId':first['MediaFolderId'],'originId':receipt['folderId'],'materials':[{'id':identifiers[j['Id']],'path':j['SourcePath'],'targetId':j['MediaFolderId']} for j in selected]})
            moved=invoke_command(editor['ProcessId'],'BatchMove','CapSync_ProductBatchMove',MoveRequest(manifest=str(run/'move-input.json'),lease=lease),run/'evidence/move.json')
            if moved.get('status')!='moved' or moved.get('count')!=len(selected) or not all(moved.get(k) is True for k in ('sdkBinUnchanged','sdkDraftUnchanged','focusUnchanged','foregroundUnchanged','navigationUnchanged')):return result('Unknown','Batch tree placement unconfirmed; no replay')
        stage('checking')
        for sample in range(31):
            if sample:time.sleep(.1)
            current=load_project(context.directory)
            if compare(before,current,selected,identifiers,destinations)['accepted']:break
        for name,delay in (('immediate',0),('saved',1)):
            if delay:time.sleep(delay)
            snapshot_project(context.directory,run/name);after=load_project(run/name);checked=compare(before,after,selected,identifiers,destinations)
            if not template_exact(run/'before',run/name,before['timeline']):checked['errors'].append('Complete timeline template changed');checked['accepted']=False
            atomic(run/(name+'-comparison.json'),checked)
            if not checked['accepted']:return result('Conflict','Complete batch saved comparison differs; no replay')
        from explorer_media_view_v1 import refresh
        visible=refresh(data,context,mark=True)
        record.update(stage='Verified',materials=identifiers,rejected=rejected,elapsedSeconds=time.monotonic()-started,viewRefreshed=visible);atomic(marker,record)
        materialize(context.private,jobs,batch_id,identifiers,rejected)
        answer=result('Verified',identifiers=identifiers,rejected=rejected);answer['NativeCommands']=1+needs_move;return answer
