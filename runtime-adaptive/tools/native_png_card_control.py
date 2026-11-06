"""One addressed stock bin move after a user-performed stock control.

Same surviving card; no physical/source-path changes, imports or input control.
Check persisted documents and the live SDK record without replaying commands.
"""
import argparse
from copy import deepcopy
import json
from pathlib import Path
import time
import uuid
from diagnose_bin_reset import sdk_material
from live_add import atomic,canonical,command,digest,main_pid,parent_edges,rows
from load_native_lab import ROOT,identity,lab_directory,snapshot
from qt_live_read import Reader
from stock_png_move_control import CARD,TARGET as STOCK_TARGET,compare as stock_compare
from verify_native_import import load

RUN=ROOT/'artifacts/MoveReuseLab/native-card-control'
OLD_FOLDER=STOCK_TARGET
DEST='bf9c78a2-a7e1-41b8-af7e-05c3d3410b1c'
TREE_MODE=False


def sdk_record():
    reader=Reader(main_pid())
    try:
        creator=next(m for m in reader.modules if m['name'].lower()=='vecreator.dll')
        return sdk_material(reader,creator,CARD)
    finally:reader.close()


def verify_sdk_registry(catalog,evidence):
    reader=Reader(main_pid())
    try:
        creator=next(m for m in reader.modules if m['name'].lower()=='vecreator.dll')
        result=sdk_material(reader,creator,None)
    finally:reader.close()
    atomic(evidence,result)
    expected={v['id']:(v['type'],canonical(v.get('file_Path','')),v['extra_info']) for v in rows(catalog)}
    actual={v['id']:(v['kind'],canonical(v['path']),v['label']) for v in result['materials']}
    if expected!=actual:raise ValueError('Complete live SDK registry differs from saved registry')


def same_sdk(left,right):
    # Stock moves rebuild DraftMaterial objects. Their allocation addresses
    # are not material identities; sdk_material resolves the same exact UUID.
    shape=lambda r:{k:v for k,v in r['material'].items() if k!='object'}
    return left['store']==right['store'] and left['groups']==right['groups'] and shape(left)==shape(right)


def compare(before,after):
    # Reuse the stock control's complete document comparison, changing only
    # the two expected parent edges. It still rejects any lost/added card.
    left=deepcopy(before);right=deepcopy(after)
    if parent_edges(left,CARD)!=[{'child_id':CARD,'parent_id':OLD_FOLDER}]:
        raise ValueError('Source parent changed')
    if parent_edges(right,CARD)!=[{'child_id':CARD,'parent_id':DEST}]:
        return {'accepted':False,'errors':['Destination parent differs']}
    parent_edges(left,CARD)[0]['parent_id']=''
    parent_edges(right,CARD)[0]['parent_id']=STOCK_TARGET
    if TREE_MODE:
        from test_secondary_path_batch import batch_compare
        parent_edges(right,CARD)[0]['parent_id']=''
        row=next(v for v in rows(before) if v['id']==CARD)
        return batch_compare(left,right,[{'materialId':CARD,'old':row['file_Path'],
                             'new':row['file_Path'],'extension':'.png'}],reopened=True,stock_metadata=True)
    return stock_compare(left,right)


def main():
    global RUN,OLD_FOLDER,DEST,TREE_MODE
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('phase',choices=('apply','accept','finish-recorded','reconcile-tree'))
    parser.add_argument('--tree',action='store_true',help='Use stock tree reparent/persist instead of the grid command wrapper')
    args=parser.parse_args()
    if args.tree:
        TREE_MODE=True
        RUN=ROOT/'artifacts/NativeTreeMoveControl'
        OLD_FOLDER='bf9c78a2-a7e1-41b8-af7e-05c3d3410b1c';DEST=STOCK_TARGET
        proof=json.loads((ROOT/'artifacts/FolderFirstMoveReuseLab/recovery/journal.json').read_text(encoding='utf8'))
        if proof['stage']!='acceptedAfterReopen':raise ValueError('Restored lab not accepted')
        if args.phase=='finish-recorded':raise ValueError('No recorded stop for tree control; never replay')
    identity();marker=RUN/'journal.json'
    if args.phase=='reconcile-tree':
        if not args.tree:raise ValueError('Tree reconciliation requires --tree')
        record=json.loads(marker.read_text(encoding='utf8'))
        receipt=json.loads((RUN/'receipt.json').read_text(encoding='utf8'))
        audit=json.loads((RUN/'unknown-audit.json').read_text(encoding='utf8'))
        if record['stage']!='unknown' or receipt!={'jobId':record['job']['Id'],'status':'unknown',
                'reason':'Tree operation changed the SDK material registry'} or audit['removed'] or \
           audit['added']!=['cd484075-d92a-4bc9-b45c-d093d2f9e71b'] or audit['changed'] or not audit['timelineExact']:
            raise ValueError('Not the recorded stock-service-only result; no replay')
        before_sdk=json.loads((RUN/'sdk-before.json').read_text(encoding='utf8'))
        check=compare(load(RUN/'before'),load(RUN/'after-unknown'))
        atomic(RUN/'reconciled-immediate-comparison.json',check)
        if not check['accepted'] or not same_sdk(before_sdk,audit['sdkCard']):
            raise ValueError('Readback differs beyond stock service row')
        verify_sdk_registry(load(lab_directory()),RUN/'sdk-registry-readback.json')
        record.update(stage='verifyingSave',confirmedByReadback=True,nativeCommandReplayed=False,
                      nativeServiceGuardOverstrict=True,historicalUiFlagsUnavailable=True)
        atomic(marker,record);finish(record,before_sdk);return
    if args.phase=='finish-recorded':
        record=json.loads(marker.read_text(encoding='utf8'))
        before_sdk=json.loads((RUN/'sdk-before.json').read_text(encoding='utf8'))
        immediate=json.loads((RUN/'sdk-immediate.json').read_text(encoding='utf8'))
        proof=json.loads((RUN/'immediate-comparison.json').read_text(encoding='utf8'))
        if record['stage']!='conflict' or record['reason']!='Immediate documents or SDK record differ' or \
           not proof['accepted'] or not same_sdk(before_sdk,immediate):
            raise ValueError('Not the recorded allocation-address-only stop; no replay')
        record.update(stage='verifyingSave',allocationAddressChangeOnly=True);atomic(marker,record)
        finish(record,before_sdk);return
    if args.phase=='accept':
        record=json.loads(marker.read_text(encoding='utf8'))
        if record['stage']!='awaitingReopen':raise ValueError('No pending acceptance; no replay')
        snapshot(lab_directory(),RUN/'reopened')
        result=compare(load(RUN/'before'),load(RUN/'reopened'));atomic(RUN/'reopened-comparison.json',result)
        if not result['accepted']:
            record.update(stage='conflictAfterReopen',accepted=False);atomic(marker,record)
            raise ValueError('Native card move did not persist: '+str(result['errors']))
        if args.tree:verify_sdk_registry(load(RUN/'reopened'),RUN/'sdk-registry-reopened.json')
        record.update(stage='acceptedAfterReopen',accepted=True);atomic(marker,record)
        print(json.dumps({'stage':record['stage'],'newCommands':0,'accepted':True}));return
    if RUN.exists():raise ValueError('Native control already attempted; no replay')
    stock=ROOT/'artifacts/MoveReuseLab/stock-control/journal.json'
    if json.loads(stock.read_text(encoding='utf8'))['stage']!='stockMoveAcceptedAfterReopen':
        raise ValueError('User stock move control is not accepted')
    current=load(lab_directory());selected=[v for v in rows(current) if v['id']==CARD]
    if len(selected)!=1 or parent_edges(current,CARD)!=[{'child_id':CARD,'parent_id':OLD_FOLDER}]:
        raise ValueError('Surviving card or parent changed')
    source=Path(selected[0]['file_Path']);byte_hash=digest(source)
    if byte_hash!='8a8ecc73f8d13095c948c6d07bfbfe2cf33ee9abf22394faff06d564a2bee773' or \
       len([v for v in rows(current) if canonical(v.get('file_Path',''))==canonical(source)])!=1:
        raise ValueError('Expected one exact owned red source')
    RUN.mkdir();snapshot(lab_directory(),RUN/'before');before_sdk=sdk_record()
    atomic(RUN/'sdk-before.json',before_sdk)
    job={'Id':str(uuid.uuid4()),'SourcePath':str(source),'RootPath':str(ROOT/'research/fixtures/AutoAddLab'),
         'MediaFolderId':DEST,'Hash':byte_hash}
    record={'stage':'dispatching','job':job,'card':CARD,'physicalChanges':0,'nativeCommands':1}
    atomic(marker,record)
    module='CapSync.NativeTreeMove.dll' if args.tree else 'CapSync.NativeAddR4097.dll'
    receipt=command(main_pid(),job,RUN,2,CARD,module);atomic(RUN/'receipt.json',receipt)
    if receipt.get('status')!='moved' or any(receipt.get(k) is not True for k in
            ('idPreserved','parentUpdated','navigationUnchanged','foregroundUnchanged','cursorUnchanged')):
        record.update(stage='unknown',reason='No confirmed stock move result');atomic(marker,record)
        raise ValueError('Move not confirmed; no replay')
    snapshot(lab_directory(),RUN/'immediate')
    result=compare(load(RUN/'before'),load(RUN/'immediate'));atomic(RUN/'immediate-comparison.json',result)
    after_sdk=sdk_record();atomic(RUN/'sdk-immediate.json',after_sdk)
    if not result['accepted'] or not same_sdk(after_sdk,before_sdk):
        record.update(stage='conflict',reason='Immediate documents or SDK record differ');atomic(marker,record)
        raise ValueError(record['reason'])
    record['stage']='verifyingSave';atomic(marker,record)
    finish(record,before_sdk)


def finish(record,before_sdk):
    marker=RUN/'journal.json';source=Path(record['job']['SourcePath']);byte_hash=record['job']['Hash']
    time.sleep(max(0,min(30,30-(time.time()-(RUN/'receipt.json').stat().st_mtime))))
    snapshot(lab_directory(),RUN/'saved')
    result=compare(load(RUN/'before'),load(RUN/'saved'));atomic(RUN/'saved-comparison.json',result)
    after_sdk=sdk_record();atomic(RUN/'sdk-saved.json',after_sdk)
    if TREE_MODE:verify_sdk_registry(load(RUN/'saved'),RUN/'sdk-registry-saved.json')
    if not result['accepted'] or not same_sdk(after_sdk,before_sdk) or digest(source)!=byte_hash:
        record.update(stage='conflict',reason='Saved documents, SDK or physical source differ');atomic(marker,record)
        raise ValueError(record['reason'])
    record.update(stage='awaitingReopen',savedGraphPreserved=True,sdkRecordPreserved=True);atomic(marker,record)
    print(json.dumps({'stage':record['stage'],'savedGraphPreserved':True,'sdkRecordPreserved':True,'physicalChanges':0}))


if __name__=='__main__':main()
