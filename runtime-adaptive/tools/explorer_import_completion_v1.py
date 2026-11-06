"""Verify a delivered import after an interrupted read; never issue data commands."""
import json,time,uuid
from pathlib import Path
from copy import deepcopy
from explorer_project_io_v2 import load_project,snapshot_project
from explorer_native_runtime_v4 import normalize_stock_service,template_exact
from explorer_saved_graph_v2 import read
from live_add import atomic,preservation,rows,canonical
from live_update import StableFile
from load_native_lab import digest

def complete(data,context):
    if data.get('kind') not in ('add','restore'):return False
    job=data['job'];run=context.private/'native-journal'/str(uuid.UUID(job['Id']));marker=run/'journal.json'
    if not marker.exists():return False
    record=json.loads(marker.read_bytes())
    if record.get('stage') not in ('Dispatching','VerifyingSave') or record.get('job')!=job or record.get('kind')!=data['kind']:return False
    moved=run/'native-receipt.json';delivered=run/'evidence/import-receipt.json'
    if not moved.exists() or not delivered.exists() or not (run/'before').exists():return False
    receipt=json.loads(moved.read_bytes());imported=json.loads(delivered.read_bytes())
    if receipt.get('status')!='moved' or not all(receipt.get(k) is True for k in ('idPreserved','parentUpdated','fullSdkBinPreserved','focusUnchanged','foregroundUnchanged','navigationUnchanged')):return False
    if imported.get('status')!='dispatched-unconfirmed' or not all(imported.get(k) is True for k in ('enterAccepted','moveAccepted','dropAccepted','focusUnchanged','foregroundUnchanged','navigationUnchanged')):return False
    identifier=receipt.get('materialId');uuid.UUID(identifier)
    before=load_project(run/'before')
    if any(row['id']==identifier for row in rows(before)):return False
    case=run/('read-only-completion-'+uuid.uuid4().hex);case.mkdir()
    for name,delay in (('immediate',0),('saved',30)):
        if delay:time.sleep(delay)
        stable=StableFile(Path(job['SourcePath']))
        try:
            if stable.identity()!=job['FileIdentity'] or digest(Path(job['SourcePath'])).casefold()!=job['Hash'].casefold() or Path(job['SourcePath']).stat().st_size!=job['Size']:return False
        finally:stable.close()
        sample=case/name;sample.mkdir();read(data,context,sample)
        snapshot_project(context.directory,sample/'project');after=load_project(sample/'project')
        checked=preservation(before,normalize_stock_service(before,after),job,identifier)
        left,right=deepcopy(before['meta']),deepcopy(after['meta'])
        for value in (left,right):value.pop('draft_materials',None);value.pop('tm_draft_modified',None)
        if left!=right:checked['errors'].append('Other metadata changed')
        if not template_exact(run/'before',sample/'project',before['timeline']):checked['errors'].append('Complete timeline template changed')
        checked['accepted']=not checked['errors'];atomic(sample/'comparison.json',checked)
        if not checked['accepted']:return False
    acceptance=case/'acceptance.json';atomic(acceptance,{'accepted':True,'nativeMutations':0,'savedSeconds':30,'materialId':identifier,'originalMoveReceiptSha256':digest(moved),'originalImportReceiptSha256':digest(delivered)})
    record.update(stage='Verified',materialId=identifier,readOnlyCompletion=str(case.relative_to(run)),readOnlyCompletionSha256=digest(acceptance));atomic(marker,record)
    return True
