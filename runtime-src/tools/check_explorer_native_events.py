"""One lab-only push connection, with project preservation and disconnect cleanup."""
import ctypes as C
import json
from pathlib import Path
import shutil
import time

from check_explorer_worker_protocol import Worker
from load_native_lab import ROOT, LAB_ID, Loader, digest, identity, lab_directory, modules, snapshot, validate
from live_add import atomic, main_pid
from folder_view_repair import compare
from verify_native_import import load
from qt_meta_inventory import PE


class Request(C.Structure):
    _fields_ = [('size', C.c_uint32), ('version', C.c_uint32), ('expectedLocation', C.c_wchar * 1024),
                ('pipe', C.c_wchar * 128), ('output', C.c_wchar * 1024), ('token', C.c_char * 65)]


def main():
    run = ROOT / 'artifacts/ExplorerNativeEventsLab'
    if run.exists(): raise ValueError('Native push acceptance was already attempted; no automatic replay')
    proof = json.loads((ROOT / 'artifacts/ExplorerSessionIdentityLab-02/journal.json').read_text(encoding='utf-8'))
    imports = json.loads((ROOT / 'research/evidence/explorer-events-imports-01.json').read_text(encoding='utf-8'))
    if not proof.get('accepted') or imports['missing']: raise ValueError('Accepted identity getter and checked imports required')
    identity(); pid = main_pid(); loaded = validate(pid, build='9.6.0.4097')
    sdk = next(module for module in loaded if module['name'].lower() == 'videoeditor.dll')
    if digest(sdk['path']) != '47e341ce930074bd7d11ef418ea5c893fc6330aa73b2f2203c5098f302d63e9f': raise ValueError('SDK differs')
    dll = ROOT / 'artifacts/NativeExplorerObserveBuild/CapSync.NativeExplorerEvents.dll'
    if any(module['name'].lower() == dll.name.lower() for module in loaded): raise ValueError('Bridge already loaded')
    sha = digest(dll); staged = ROOT / 'artifacts/NativeExplorerEvents' / sha[:16] / dll.name
    staged.parent.mkdir(parents=True, exist_ok=True)
    if not staged.exists(): shutil.copyfile(dll, staged)
    if digest(staged) != sha: raise ValueError('Staged bridge differs')
    pe = PE(staged); rva = int(next(entry for entry in pe.exports() if entry['name'] == 'CapSync_ExplorerEventsThread')['rva'], 16)
    if not any(name == '.text' and start <= rva < start + size for name, start, _, size, _ in pe.sections): raise ValueError('Entry is not code')
    snapshot(lab_directory(), run / 'before'); evidence = run / 'evidence'; evidence.mkdir()
    state = run / 'state.json'
    state.write_text(json.dumps({'SchemaVersion': 1, 'Bindings': [], 'Sources': [], 'Pending': []}), encoding='utf-8')
    record = {'stage': 'preparing', 'pid': pid, 'sha256': sha, 'editorCommands': 0}
    atomic(run / 'journal.json', record)
    worker = Worker(state, editor_pid=pid)
    try:
        ready = worker.event('ready'); bridge = ready['bridge']  # Token stays in memory, never in reports.
        assert ready['capabilities']['nativeObservation'] and not ready['capabilities']['nativeDispatch']
        reply, _ = worker.request('start'); assert reply['ok']
        output = evidence / 'bridge-status.json'
        request = Request(size=C.sizeof(Request), version=1, expectedLocation=str(lab_directory()),
            pipe=bridge['PipeName'], output=str(output), token=bridge['Token'].encode('ascii'))
        loader = Loader(pid)
        try:
            identity(); record['stage'] = 'dispatching'; atomic(run / 'journal.json', record)
            if not loader.call(loader.library_entry(), (str(staged) + '\0').encode('utf-16le')): raise ValueError('Load failed before callback')
            module = next(module for module in modules(pid) if Path(module['path']).resolve() == staged.resolve())
            if loader.call(module['base'] + rva, bytes(request)) != 1: raise ValueError('Bridge rejected; no replay')
        finally: loader.close()
        changed = worker.event('editorChanged')['state']
        editor = changed['editor']
        if editor['Status'] != 'Project' or editor['ProcessId'] != pid or editor['Project']['DraftId'] != LAB_ID.upper() or \
            Path(editor['Project']['Location']).resolve() != lab_directory().resolve():
            raise ValueError('Push identity was not verified: ' + repr(editor))
        atomic(run / 'editor-state.json', editor)
        snapshot(lab_directory(), run / 'immediate')
        checked = compare(load(run / 'before'), load(run / 'immediate')); atomic(run / 'immediate-comparison.json', checked)
        if not checked['accepted']: raise ValueError('Immediate project graph changed')
        time.sleep(30); snapshot(lab_directory(), run / 'saved')
        checked = compare(load(run / 'before'), load(run / 'saved')); atomic(run / 'saved-comparison.json', checked)
        if not checked['accepted']: raise ValueError('Saved project graph changed')
        reply, _ = worker.request('stop'); assert reply['ok']; worker.event('stopped'); worker.exited(0)
        deadline = time.monotonic() + 8
        native = {}
        while time.monotonic() < deadline:
            if output.exists():
                native = json.loads(output.read_text(encoding='utf-8'))
                if not native.get('active'): break
            time.sleep(.05)  # Bounded completion wait for disconnect, not an idle watcher.
        if native.get('active') is not False or native.get('snapshots', 0) < 1:
            raise ValueError('Native subscriptions did not stop on parent disconnect: ' + repr(native))
        snapshot(lab_directory(), run / 'stopped')
        checked = compare(load(run / 'before'), load(run / 'stopped')); atomic(run / 'stopped-comparison.json', checked)
        if not checked['accepted']: raise ValueError('Stopped project graph changed')
        record.update(stage='verified', accepted=True, graphPreserved=True, pushIdentity=True,
            subscriptionsStopped=True, nativeSnapshots=native['snapshots'], projectKey=editor['Project']['Value'], periodicTimers=0)
        atomic(run / 'journal.json', record); print(json.dumps(record))
    finally: worker.close()


if __name__ == '__main__': main()
