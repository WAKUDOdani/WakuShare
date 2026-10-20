"""Read-only snapshots around one user-performed stock CapCut card move.

No native commands, filesystem source edits, input control or draft writes.
"""
import argparse
from collections import Counter
from copy import deepcopy
import json
from pathlib import Path
from compare_lab_timeline import compare as timeline_compare
from live_add import atomic,rows,parent_edges,digest
from load_native_lab import ROOT,identity,lab_directory,snapshot
from verify_native_import import load

RUN=ROOT/'artifacts/MoveReuseLab/stock-control'
CARD='4195482C-1347-423E-8A4A-34771C25E21E'
LOST='c024b416-3002-4de9-9ab8-7e39d7148523'
TARGET='f5316979-608e-4530-9b92-6b8ddd1118bf'


def compare(before,after):
    errors=[];left=deepcopy(before);right=deepcopy(after)
    a={v['id']:v for v in rows(left)};b={v['id']:v for v in rows(right)}
    if a.keys()!=b.keys():errors.append('Registry IDs changed')
    for key in a.keys()&b.keys():
        if key=='cd484075-d92a-4bc9-b45c-d093d2f9e71b':
            a[key]={k:v for k,v in a[key].items() if k not in ('create_time','import_time','import_time_ms')}
            b[key]={k:v for k,v in b[key].items() if k not in ('create_time','import_time','import_time_ms')}
        if a[key]!=b[key]:errors.append('Registry properties changed: '+key)
    if parent_edges(right,CARD)!=[{'child_id':CARD,'parent_id':TARGET}]:
        errors.append('Card is not in ReleaseCheck')
    else:parent_edges(right,CARD)[0]['parent_id']=''
    def store(c):
        return {g['type']:Counter(json.dumps(v,sort_keys=True) for v in g.get('value',[])) for g in c['store']['draft_virtual_store']}
    if store(left)!=store(right):errors.append('Other folder relationships changed')
    timeline=timeline_compare(left['timeline'],right['timeline'])
    if not timeline['equivalentExceptAudioHelperIds']:errors+=timeline['errors']
    excluded=('tm_draft_modified','draft_timeline_materials_size_','draft_materials')
    if {k:v for k,v in left['meta'].items() if k not in excluded}!={k:v for k,v in right['meta'].items() if k not in excluded}:
        errors.append('Other project metadata changed')
    return {'accepted':not errors,'errors':errors,'timeline':timeline,'nativeCommands':0}


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('phase',choices=('prepare','capture','accept'))
    args=parser.parse_args();identity()
    marker=RUN/'journal.json'
    if args.phase=='prepare':
        if RUN.exists():raise ValueError('Stock control already prepared; do not repeat')
        failure=json.loads((RUN.parent/'journal.json').read_text(encoding='utf8'))
        if failure['stage']!='conflictAfterReopen':raise ValueError('Expected the recorded reopen conflict')
        current=load(lab_directory());cards={v['id']:v for v in rows(current)}
        if LOST in cards or CARD not in cards or parent_edges(current,CARD)!=[{'child_id':CARD,'parent_id':''}]:
            raise ValueError('Expected surviving root alias, without the disappeared card')
        source=Path(cards[CARD]['file_Path'])
        if not source.is_file() or digest(source)!='8a8ecc73f8d13095c948c6d07bfbfe2cf33ee9abf22394faff06d564a2bee773':
            raise ValueError('Original red source differs')
        RUN.mkdir();snapshot(lab_directory(),RUN/'before')
        atomic(marker,{'stage':'awaitingUserStockMove','card':CARD,'target':TARGET,
                       'source':str(source),'hash':digest(source),'nativeCommands':0})
        print(json.dumps({'stage':'awaitingUserStockMove','nativeCommands':0}));return
    record=json.loads(marker.read_text(encoding='utf8'))
    if record['stage'] not in ('awaitingUserStockMove','awaitingStockReopen'):
        raise ValueError('No pending stock control')
    label='after-user-move' if args.phase=='capture' else 'reopened'
    snapshot(lab_directory(),RUN/label)
    result=compare(load(RUN/'before'),load(RUN/label));atomic(RUN/(label+'-comparison.json'),result)
    if not result['accepted']:raise ValueError('Stock move differs: '+str(result['errors']))
    if digest(Path(record['source']))!=record['hash']:raise ValueError('Physical source changed')
    record['stage']='awaitingStockReopen' if args.phase=='capture' else 'stockMoveAcceptedAfterReopen'
    atomic(marker,record);print(json.dumps({'stage':record['stage'],**result}))


if __name__=='__main__':main()
