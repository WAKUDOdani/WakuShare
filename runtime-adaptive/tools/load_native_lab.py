"""Load only our metadata probe into the user-authorized isolated CapCut lab.

No input/focus control, editor binary patches, executable scratch allocation,
timeline/media operation or security-setting change. Unknown completion never
causes a forced thread termination or automatic retry.
"""
import argparse
import ctypes as C
from ctypes import wintypes as W
import hashlib
import json
import shutil
import struct
import subprocess
import time
from pathlib import Path
from qt_live_read import Reader
from qt_meta_inventory import PE

ROOT = Path(__file__).resolve().parent.parent
LAB_ID = '582F1BF9-2B25-4cf2-B83F-3528F1B868B2'
LAB_NAME = 'CapSync-Lab-20261013-001'


def identity():
    reply = subprocess.run(['node',str(ROOT/'tools/lab_identity.mjs')],capture_output=True,
                           text=True,check=True,timeout=15)
    if json.loads(reply.stdout)['draftId'] != LAB_ID: raise ValueError('Lab is not active')


def digest(path): return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def modules(pid):
    reader = Reader(pid)
    try: return reader.modules
    finally: reader.close()


def validate(pid,build=None,check_identity=True):
    if check_identity:
        identity()
    loaded = modules(pid)
    creator = next(m for m in loaded if m['name'].lower() == 'vecreator.dll')
    active_build=Path(creator['path']).parent.name
    if build is not None and active_build!=build:raise ValueError('Adapter is compiled for another build')
    release=None
    if active_build=='9.6.0.4097':
        metadata=json.loads((ROOT/'research/evidence/release-media-meta-4097.json').read_text(encoding='utf8'))
        release=json.loads((ROOT/'research/evidence/release-native-4097/comparison.json').read_text(encoding='utf8'))
        if Path(creator['path']).resolve()!=Path(metadata['image']).resolve() or digest(creator['path'])!=metadata['sha256']:
            raise ValueError('Unverified release image')
        if len(release['routines'])!=12 or not all(r['equivalentInstructions'] for r in release['routines']):
            raise ValueError('Release native comparison incomplete')
        expected={'Qt6Core.dll','Qt6Gui.dll','Qt6Quick.dll','Qt6Qml.dll','Qt6QmlModels.dll','Qt6Network.dll'}
        if {q['name'] for q in release['qt']}!=expected:raise ValueError('Release Qt comparison incomplete')
        for q in release['qt']:
            if not q['exportsIdentical'] or not q['sections'] or not all(s['same'] for s in q['sections']):
                raise ValueError('Release Qt mapped image changed')
            current=next(m for m in loaded if m['name'].lower()==q['name'].lower())
            if Path(current['path']).parent!=Path(creator['path']).parent or digest(current['path'])!=q['sha256']:
                raise ValueError('Release Qt dependency differs')
    else:
        for module_name, reference in [('vecreator.dll','qt-import-metadata.json'),('qt6core.dll','qt-core-metadata.json')]:
            saved = json.loads((ROOT/'research/evidence'/reference).read_text(encoding='utf8'))
            current = next(m for m in loaded if m['name'].lower() == module_name)
            if Path(current['path']).resolve() != Path(saved['image']).resolve() or digest(current['path']) != saved['sha256']:
                raise ValueError('Unverified editor/Qt image')
    gui = next(m for m in loaded if m['name'].lower() == 'qt6gui.dll')
    if Path(gui['path']).parent != Path(creator['path']).parent: raise ValueError('Qt GUI path mismatch')
    proof = json.loads((ROOT/'research/evidence/native-harness-proof.json').read_text(encoding='utf-8-sig'))
    for module_name in [] if release else ['Qt6Core.dll','Qt6Gui.dll','Qt6Qml.dll','Qt6Network.dll']:
        current = next(m for m in loaded if m['name'].lower() == module_name.lower())
        if Path(current['path']).parent != Path(creator['path']).parent or digest(current['path']) != proof['dependencies'][module_name]:
            raise ValueError('Qt dependency differs from tested harness')
    # The separate harness must have completed both runtime checks first.
    if {item['runtime'] for item in proof['reports']} != {'stock','vendor'}: raise ValueError('Both runtimes must be tested')
    for item in proof['reports']:
        report = item['report']
        if report.get('schemaVersion') != 1 or report.get('qtVersion') != '6.2.2' or report.get('visited',0) < 3 or report.get('qmlContexts',0) < 1:
            raise ValueError('Missing successful harness proof')
    if digest(ROOT/'artifacts/NativeVendorHarness/CapSync.NativeProbe.dll') != digest(ROOT/'artifacts/NativeBuildNinja/CapSync.NativeProbe.dll'):
        raise ValueError('Probe differs from vendor harness')
    if proof['probeSha256'] != digest(ROOT/'artifacts/NativeBuildNinja/CapSync.NativeProbe.dll'):
        raise ValueError('Probe changed since harness test')
    return loaded


class ProbeRequest(C.Structure):
    _fields_ = [('size',C.c_uint32),('version',C.c_uint32),('outputPath',C.c_wchar*1024)]


class LabImportRequest(C.Structure):
    _fields_ = [('size',C.c_uint32),('version',C.c_uint32),('outputPath',C.c_wchar*1024),
                ('sourcePath',C.c_wchar*1024),('projectMetaPath',C.c_wchar*1024)]


class Loader:
    def __init__(self,pid):
        self.pid = pid
        self.k = C.WinDLL('kernel32',use_last_error=True)
        for name, args, result in [
            ('OpenProcess',[W.DWORD,W.BOOL,W.DWORD],W.HANDLE),
            ('CloseHandle',[W.HANDLE],W.BOOL),
            ('VirtualAllocEx',[W.HANDLE,C.c_void_p,C.c_size_t,W.DWORD,W.DWORD],C.c_void_p),
            ('VirtualFreeEx',[W.HANDLE,C.c_void_p,C.c_size_t,W.DWORD],W.BOOL),
            ('WriteProcessMemory',[W.HANDLE,C.c_void_p,C.c_void_p,C.c_size_t,C.POINTER(C.c_size_t)],W.BOOL),
            ('CreateRemoteThread',[W.HANDLE,C.c_void_p,C.c_size_t,C.c_void_p,C.c_void_p,W.DWORD,C.POINTER(W.DWORD)],W.HANDLE),
            ('WaitForSingleObject',[W.HANDLE,W.DWORD],W.DWORD),
            ('GetExitCodeThread',[W.HANDLE,C.POINTER(W.DWORD)],W.BOOL),
            ('GetModuleHandleW',[W.LPCWSTR],W.HMODULE),
            ('GetProcAddress',[W.HMODULE,C.c_char_p],C.c_void_p),
            ('GetModuleHandleExW',[W.DWORD,C.c_void_p,C.POINTER(W.HMODULE)],W.BOOL),
            ('GetModuleFileNameW',[W.HMODULE,W.LPWSTR,W.DWORD],W.DWORD),
        ]:
            fn = getattr(self.k,name)
            fn.argtypes,fn.restype = args,result
        self.handle = self.k.OpenProcess(0x0002|0x0400|0x0008|0x0020|0x0010,False,pid)
        if not self.handle: raise C.WinError(C.get_last_error())

    def close(self): self.k.CloseHandle(self.handle)

    def library_entry(self):
        base = self.k.GetModuleHandleW('kernel32.dll')
        address = self.k.GetProcAddress(base,b'LoadLibraryW')
        owner = W.HMODULE()
        if not address or not self.k.GetModuleHandleExW(0x0004|0x0002,address,C.byref(owner)):
            raise C.WinError(C.get_last_error())
        path = C.create_unicode_buffer(1024)
        if not self.k.GetModuleFileNameW(owner,path,1024): raise C.WinError(C.get_last_error())
        remote = next(m for m in modules(self.pid) if Path(m['path']).resolve() == Path(path.value).resolve())
        return remote['base'] + address - owner.value

    def call(self,entry,payload):
        address = self.k.VirtualAllocEx(self.handle,None,len(payload),0x3000,0x04)
        if not address: raise C.WinError(C.get_last_error())
        thread = None
        completed = False
        try:
            source = C.create_string_buffer(payload)
            actual = C.c_size_t()
            if not self.k.WriteProcessMemory(self.handle,address,source,len(payload),C.byref(actual)) or actual.value != len(payload):
                raise C.WinError(C.get_last_error())
            thread = self.k.CreateRemoteThread(self.handle,None,0,entry,address,0,None)
            if not thread: raise C.WinError(C.get_last_error())
            wait = self.k.WaitForSingleObject(thread,15000)
            if wait != 0:
                raise RuntimeError('Native thread completion unknown; request memory retained, no retry')
            completed = True
            code = W.DWORD()
            if not self.k.GetExitCodeThread(thread,C.byref(code)): raise C.WinError(C.get_last_error())
            return code.value
        finally:
            if thread: self.k.CloseHandle(thread)
            if not thread or completed: self.k.VirtualFreeEx(self.handle,address,0,0x8000)


def lab_directory():
    import os
    base = Path(os.environ['LOCALAPPDATA'])/'CapCut/User Data/Projects/com.lveditor.draft'
    found = []
    for directory in base.iterdir():
        if not directory.is_dir(): continue
        try:
            meta = json.loads((directory/'draft_meta_info.json').read_text(encoding='utf8'))
            if meta.get('draft_id') == LAB_ID and meta.get('draft_name') == LAB_NAME: found.append(directory)
        except (OSError,ValueError): pass
    if len(found) != 1: raise ValueError('Expected one isolated lab directory')
    return found[0]


def snapshot(project,out):
    out.mkdir(parents=True,exist_ok=False)
    result = {}
    for name in ['draft_content.json','draft_meta_info.json','draft_virtual_store.json','template-2.tmp']:
        source = project/name
        if not source.exists(): continue
        data = source.read_bytes()
        json.loads(data.decode('utf8'))
        (out/name).write_bytes(data)
        result[name] = hashlib.sha256(data).hexdigest()
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pid',type=int,required=True)
    parser.add_argument('--import-probe',action='store_true',help='Disabled failed experiment; always refuses')
    args = parser.parse_args()
    if args.import_probe:
        raise RuntimeError('Import experiment disabled: it reset the lab media registry. Read-only diagnostics remain available.')
    if C.sizeof(C.c_void_p) != 8 or C.sizeof(ProbeRequest) != 2056: raise ValueError('Requires Windows x64')
    validate(args.pid)
    project = lab_directory()
    run = ROOT/'research/evidence'/f'native-load-{time.time_ns()}'
    evidence = run/'evidence'
    evidence.mkdir(parents=True)
    before = snapshot(project,run/'before')
    dll = ROOT/'artifacts/NativeBuildNinja/CapSync.NativeProbe.dll'
    sha = digest(dll)
    staged = ROOT/'artifacts/NativeProbe'/sha[:16]/dll.name
    staged.parent.mkdir(parents=True,exist_ok=True)
    if staged.exists() and digest(staged) != sha: raise ValueError('Staged probe mismatch')
    if not staged.exists(): shutil.copyfile(dll,staged)
    image = PE(staged)
    export_name = 'CapSync_LabImportThread' if args.import_probe else 'CapSync_InspectThread'
    export = next(e for e in image.exports() if e['name'] == export_name)
    rva = int(export['rva'],16)
    if not any(n == '.text' and start <= rva < start+size for n,start,_,size,_ in image.sections):
        raise ValueError('Probe export is not executable code')
    user = C.WinDLL('user32')
    user.GetForegroundWindow.restype = W.HWND
    foreground_before = user.GetForegroundWindow()
    loader = Loader(args.pid)
    try:
        validate(args.pid)  # Immediately before loading; never activate a project.
        existing = next((m for m in modules(args.pid) if Path(m['path']).resolve() == staged.resolve()),None)
        if not existing:
            loader.call(loader.library_entry(),(str(staged)+'\0').encode('utf-16le'))
        loaded = next(m for m in modules(args.pid) if Path(m['path']).resolve() == staged.resolve())
        identity()
        output = evidence/('native-import-result.json' if args.import_probe else 'native-probe-result.json')
        if args.import_probe:
            source = ROOT/'research/fixtures/ManagedB/new-from-probe.png'
            if digest(source) != '9c5d6e379ea0e432845ff3023e407c13b14df84e09d420f9d912008ab8d92380':
                raise ValueError('Synthetic source changed')
            request = LabImportRequest(size=C.sizeof(LabImportRequest),version=1,outputPath=str(output),
                                       sourcePath=str(source),projectMetaPath=str(project/'draft_meta_info.json'))
        else:
            request = ProbeRequest(size=C.sizeof(ProbeRequest),version=1,outputPath=str(output))
        if len(str(output)) >= 1024: raise ValueError('Report path too long')
        result = loader.call(loaded['base']+rva,bytes(request))
        if result != 1: raise RuntimeError(f'Probe rejected request: {C.c_int32(result).value}')
        deadline = time.monotonic()+10
        while not output.exists() and time.monotonic() < deadline: time.sleep(0.05)
        if not output.exists(): raise RuntimeError('Probe report completion unknown; no retry')
        report = json.loads(output.read_text(encoding='utf8'))
        identity()
        if args.import_probe and report.get('status') == 'dispatched-unconfirmed':
            deadline = time.monotonic()+8
            while time.monotonic() < deadline:
                try:
                    saved = json.loads((project/'draft_meta_info.json').read_text(encoding='utf8'))
                    rows = [r for g in saved.get('draft_materials',[]) for r in g.get('value',[])]
                    if any(Path(r.get('file_Path','')).resolve() == source.resolve() for r in rows if r.get('file_Path')):
                        break
                except (OSError,ValueError): pass
                time.sleep(0.1)
            identity()
        after = snapshot(project,run/'after')
        receipt = {'pid':args.pid,'projectId':LAB_ID,'probeSha256':sha,'report':str(output),
                   'before':before,'after':after,'allProjectFilesUnchanged':before == after,
                   'foregroundBefore':foreground_before,'foregroundAfter':user.GetForegroundWindow(),
                   'mode':'one lab import' if args.import_probe else 'read-only inspection',
                   'nativeStatus':report.get('status'),'visited':report.get('visited'),'candidates':len(report.get('candidates',[]))}
        (run/'receipt.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2),encoding='utf8')
        print(json.dumps(receipt,ensure_ascii=False))
    finally: loader.close()


if __name__ == '__main__': main()
