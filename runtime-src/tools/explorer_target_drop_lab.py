"""Two fresh one-shot lab imports through a scoped DropArea; never replays a dispatch."""
from __future__ import annotations

import argparse
from copy import deepcopy
import ctypes as C
import json
from pathlib import Path
import shutil
import subprocess
import sys
import time

from load_native_lab import ROOT, Loader, digest, identity, lab_directory, modules, snapshot, validate
from live_add import atomic, main_pid, path_rows, preservation, rows
from qt_meta_inventory import PE
from verify_native_import import load
from test_secondary_path_batch import batch_compare

RUN=ROOT/'artifacts/ExplorerTargetDropLab'
DLL=ROOT/'artifacts/NativeExplorerObserveBuild/CapSync.NativeExplorerTargetDrop.dll'


class Request(C.Structure):
    _fields_=[('size',C.c_uint32),('version',C.c_uint32),('hiddenRequired',C.c_uint32),
              ('source',C.c_wchar*1024),('meta',C.c_wchar*1024),('output',C.c_wchar*1024),('sha256',C.c_char*65)]


def compare(before_folder,after_folder,source,identifier):
    before,after=load(before_folder),load(after_folder)
    result=preservation(before,after,{'SourcePath':str(source),'MediaFolderId':''},identifier)
    left,right=deepcopy(before['meta']),deepcopy(after['meta'])
    for document in (left,right):
        document.pop('draft_materials',None);document.pop('tm_draft_modified',None)
    differing=[k for k in set(left)|set(right) if left.get(k)!=right.get(k)]
    if differing:result['errors'].append('Other metadata fields changed: '+','.join(sorted(differing)))
    before_template=before_folder/'template-2.tmp';after_template=after_folder/'template-2.tmp'
    if before_template.exists()!=after_template.exists() or (before_template.exists() and before_template.read_bytes()!=after_template.read_bytes()):
        result['errors'].append('Template changed')
    result['accepted']=not result['errors'];result['otherMetadataDifferences']=differing
    return result


def invoke(pid,source,hidden,output,sha):
    identity();loaded=validate(pid,build='9.6.0.4097')
    if digest(DLL)!=sha:raise ValueError('Prepared bridge changed')
    staged=ROOT/'artifacts/NativeExplorerTargetDrop'/sha[:16]/DLL.name;staged.parent.mkdir(parents=True,exist_ok=True)
    existing=[m for m in loaded if m['name'].lower()==DLL.name.lower()]
    if existing and (len(existing)!=1 or Path(existing[0]['path']).resolve()!=staged.resolve()):raise ValueError('Different bridge is already loaded')
    if not staged.exists():shutil.copyfile(DLL,staged)
    if digest(staged)!=sha:raise ValueError('Staged bridge differs')
    image=PE(staged);rva=int(next(e for e in image.exports() if e['name']=='CapSync_ExplorerTargetDropThread')['rva'],16)
    if not any(n=='.text' and a<=rva<a+s for n,a,_,s,_ in image.sections):raise ValueError('Bridge entry is not code')
    loader=Loader(pid)
    try:
        identity()
        if not existing:loader.call(loader.library_entry(),(str(staged)+'\0').encode('utf-16le'))
        module=next(m for m in modules(pid) if Path(m['path']).resolve()==staged.resolve())
        request=Request(size=C.sizeof(Request),version=1,hiddenRequired=int(hidden),source=str(source),
                        meta=str(lab_directory()/'draft_meta_info.json'),output=str(output),sha256=digest(source).encode('ascii'))
        status=loader.call(module['base']+rva,bytes(request))
        if status!=1:raise ValueError('Bridge rejected; no replay')
        deadline=time.monotonic()+15
        while not output.exists() and time.monotonic()<deadline:time.sleep(.05)
        if not output.exists():raise ValueError('Completion unknown; do not replay')
    finally:loader.close()
    return json.loads(output.read_text(encoding='utf-8'))


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('action',choices=('visible','hidden','accept'));args=parser.parse_args()
    identity()
    if args.action=='accept':
        marker=RUN/'accept.json'
        if marker.exists():raise ValueError('Acceptance already recorded')
        record=json.loads((RUN/'hidden/journal.json').read_text(encoding='utf-8'))
        if record['stage']!='awaitingReopen':raise ValueError('Both saved stages must pass first')
        snapshot(lab_directory(),RUN/'reopened')
        baseline=load(RUN/'hidden/saved');row=next(r for r in rows(baseline) if r.get('file_Path') and r.get('extra_info')==Path(r['file_Path']).name)
        anchor={'materialId':row['id'],'old':row['file_Path'],'new':row['file_Path'],'extension':Path(row['file_Path']).suffix}
        result=batch_compare(baseline,load(RUN/'reopened'),[anchor],stock_metadata=True,reopened=True)
        atomic(RUN/'reopen-comparison.json',result)
        atomic(marker,{'accepted':result['accepted'],'projectGraphPreserved':result['accepted'],'imports':2,'newClips':0})
        if not result['accepted']:raise ValueError('Reopened graph differs')
        print(json.dumps({'accepted':True,'imports':2,'newClips':0}));return
    run=RUN/args.action
    if run.exists():raise ValueError('This stage was already attempted; never repeat its import')
    if args.action=='hidden':
        previous=json.loads((RUN/'visible/journal.json').read_text(encoding='utf-8'))
        if previous['stage']!='savedVerified':raise ValueError('Visible control must pass first')
    proof=json.loads((ROOT/'artifacts/ExplorerDropInspect/journal.json').read_text(encoding='utf-8'))
    if proof['stage']!='inspected' or not proof['graphPreserved']:raise ValueError('Accepted read-only destination inspection required')
    backup=subprocess.run([sys.executable,str(ROOT/'tools/backup_lab.py')],capture_output=True,text=True,
                          timeout=40,creationflags=subprocess.CREATE_NO_WINDOW)
    if backup.returncode:raise ValueError('Stable full backup failed: '+backup.stderr)
    backup_info=json.loads(backup.stdout)
    if not backup_info['complete']:raise ValueError('Full backup incomplete')
    snapshot(lab_directory(),run/'before');evidence=run/'evidence';evidence.mkdir()
    atomic(run/'backup.json',backup_info)
    source=ROOT/'research/fixtures/AutoAddLab/ExplorerStage0'/('targeted-drop-'+args.action+'.png')
    source.parent.mkdir(parents=True,exist_ok=True)
    with source.open('xb') as target:target.write((ROOT/'research/fixtures/AutoAddLab/CapSync-Stock-Relink-NEW.png').read_bytes())
    if path_rows(load(run/'before'),source):raise ValueError('Fixture already registered')
    pid=main_pid();sha=digest(DLL)
    record={'stage':'dispatching','pid':pid,'source':str(source),'sha256':sha,'editorDispatches':1}
    atomic(run/'journal.json',record)
    native=invoke(pid,source,args.action=='hidden',evidence/'target-drop.json',sha)
    atomic(run/'native-receipt.json',native)
    if native.get('status')!='dispatched-unconfirmed' or not all(native.get(k) is True for k in ('focusUnchanged','foregroundUnchanged','navigationUnchanged')):
        record.update(stage='stopped',reason=native);atomic(run/'journal.json',record)
        raise ValueError('Targeted delivery not confirmed; no retry')
    deadline=time.monotonic()+20;matches=[]
    while time.monotonic()<deadline:
        matches=path_rows(load(lab_directory()),source)
        if len(matches)==1:break
        time.sleep(.1)
    if len(matches)!=1:raise ValueError('Imported material unknown; do not repeat delivery')
    identifier=matches[0]['id'];snapshot(lab_directory(),run/'immediate')
    result=compare(run/'before',run/'immediate',source,identifier);atomic(run/'immediate-comparison.json',result)
    if not result['accepted']:raise ValueError('Immediate graph differs; do not repeat or rollback automatically')
    time.sleep(30);snapshot(lab_directory(),run/'saved')
    result=compare(run/'before',run/'saved',source,identifier);atomic(run/'saved-comparison.json',result)
    if not result['accepted']:raise ValueError('Saved graph differs; no repeated delivery')
    record.update(stage='awaitingReopen' if args.action=='hidden' else 'savedVerified',materialId=identifier,graphPreserved=True,
                  viewVisible=native['viewVisible'],targetVisible=native['targetVisible'],newClips=0)
    atomic(run/'journal.json',record);print(json.dumps(record))


if __name__=='__main__':main()
