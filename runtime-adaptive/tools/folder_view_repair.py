"""One lab UI-layout repair, with saved graph checks and no input automation."""
import argparse
import json
from pathlib import Path
import time
import uuid
from live_add import atomic,rows
from live_source_path import source_command
from load_native_lab import ROOT,identity,lab_directory,snapshot
from test_secondary_path_batch import batch_compare
from verify_native_import import load

CASE=ROOT/'artifacts/FolderViewRepair'


def compare(before,after):
    row=next(r for r in rows(before) if r.get('file_Path') and r.get('extra_info')==Path(r['file_Path']).name)
    anchor={'materialId':row['id'],'old':row['file_Path'],'new':row['file_Path'],'extension':Path(row['file_Path']).suffix}
    return batch_compare(before,after,[anchor],stock_metadata=True)


def events():
    path=CASE/'enable/folder-events.jsonl'
    return [json.loads(line) for line in path.read_text(encoding='utf8').splitlines() if line] if path.exists() else []


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('action',choices=('inspect','enable','accept','disable'))
    args=parser.parse_args();identity();run=CASE/args.action
    if run.exists():raise ValueError('Action already attempted; preserve journal and never replay')
    if args.action=='enable':
        inspected=json.loads((CASE/'inspect/source-receipt.json').read_text(encoding='utf8'))
        if inspected.get('status')!='inspected':raise ValueError('Completed view inspection required')
    snapshot(lab_directory(),run/'before');before=load(run/'before')
    if args.action=='accept':
        baseline=load(CASE/'enable/before');check=compare(baseline,before);atomic(run/'comparison.json',check)
        observed=events()
        good=observed and all(e.get('status')=='refreshed' and all(e.get(k) is True for k in
            ('focusUnchanged','foregroundUnchanged','cursorUnchanged','navigationUnchanged')) for e in observed)
        result={'stage':'awaitingUserAcceptance' if check['accepted'] and good else 'conflict',
                'graphPreserved':check['accepted'],'layoutEvents':len(observed),'interactionPreserved':bool(good),'newCommands':0}
        atomic(run/'journal.json',result);print(json.dumps(result));return
    request={'id':str(uuid.uuid4()),'action':args.action}
    atomic(run/'journal.json',{'stage':'dispatching','request':request})
    receipt=source_command(request,run,'CapSync.NativeFolderView.dll')
    expected={'inspect':'inspected','enable':'enabled','disable':'disabled'}[args.action]
    snapshot(lab_directory(),run/'immediate');check=compare(before,load(run/'immediate'));atomic(run/'immediate-comparison.json',check)
    if receipt.get('status')!=expected or not check['accepted']:
        raise ValueError('View command not confirmed or graph changed; do not replay')
    if args.action!='inspect':
        time.sleep(30);snapshot(lab_directory(),run/'saved');check=compare(before,load(run/'saved'));atomic(run/'saved-comparison.json',check)
        if not check['accepted']:raise ValueError('Saved graph differs; do not repeat view command')
    result={'stage':expected,'projectGraphPreserved':True,'projectCommands':0,
            'viewState':receipt.get('viewState'),'notifySignal':receipt.get('notifySignal')}
    atomic(run/'journal.json',result);print(json.dumps(result,ensure_ascii=True))


if __name__=='__main__':main()
