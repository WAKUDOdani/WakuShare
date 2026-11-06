"""Lab-only read-only QObject tree snapshot for the verified Qt 6.2.2 build.

No LoadLibrary, remote thread, writes, method invocation or input control.
Private layouts are research observations; never use these pointers as handles
for production operations. Concurrent changes produce skipped/incomplete nodes.
"""
import argparse
import ctypes as C
from ctypes import wintypes as W
import hashlib
import json
import re
import struct
import subprocess
from pathlib import Path
from qt_meta_inventory import PE


class MODULEENTRY32W(C.Structure):
    _fields_ = [('dwSize',W.DWORD),('th32ModuleID',W.DWORD),('th32ProcessID',W.DWORD),
                ('GlblcntUsage',W.DWORD),('ProccntUsage',W.DWORD),('modBaseAddr',C.c_void_p),
                ('modBaseSize',W.DWORD),('hModule',C.c_void_p),('szModule',W.WCHAR*256),
                ('szExePath',W.WCHAR*260)]


class Reader:
    def __init__(self,pid):
        self.k = C.WinDLL('kernel32',use_last_error=True)
        self.k.OpenProcess.argtypes = [W.DWORD,W.BOOL,W.DWORD]
        self.k.OpenProcess.restype = W.HANDLE
        self.k.CloseHandle.argtypes = [W.HANDLE]
        self.k.ReadProcessMemory.argtypes = [W.HANDLE,C.c_void_p,C.c_void_p,C.c_size_t,C.POINTER(C.c_size_t)]
        self.k.ReadProcessMemory.restype = W.BOOL
        self.k.CreateToolhelp32Snapshot.argtypes = [W.DWORD,W.DWORD]
        self.k.CreateToolhelp32Snapshot.restype = W.HANDLE
        self.k.Module32FirstW.argtypes = [W.HANDLE,C.POINTER(MODULEENTRY32W)]
        self.k.Module32NextW.argtypes = [W.HANDLE,C.POINTER(MODULEENTRY32W)]
        self.handle = self.k.OpenProcess(0x0010,False,pid)  # PROCESS_VM_READ only
        if not self.handle: raise C.WinError(C.get_last_error())
        self.modules = []
        snap = self.k.CreateToolhelp32Snapshot(0x18,pid)
        if snap == C.c_void_p(-1).value: raise C.WinError(C.get_last_error())
        try:
            entry = MODULEENTRY32W()
            entry.dwSize = C.sizeof(entry)
            found = self.k.Module32FirstW(snap,C.byref(entry))
            while found:
                self.modules.append({'name':entry.szModule,'path':entry.szExePath,
                                     'base':entry.modBaseAddr,'size':entry.modBaseSize})
                found = self.k.Module32NextW(snap,C.byref(entry))
        finally: self.k.CloseHandle(snap)

    def close(self): self.k.CloseHandle(self.handle)

    def read(self,address,size):
        if address < 0x10000 or size > 1024*1024 or size < 0: raise ValueError('Invalid read bounds')
        buffer = C.create_string_buffer(size)
        actual = C.c_size_t()
        if not self.k.ReadProcessMemory(self.handle,address,buffer,size,C.byref(actual)) or actual.value != size:
            raise ValueError('Memory changed or is not readable')
        return buffer.raw

    def ptr(self,address): return struct.unpack('<Q',self.read(address,8))[0]

    def module(self,address):
        return next((m for m in self.modules if m['base'] <= address < m['base']+m['size']),None)

    def rtti(self,vtable):
        module = self.module(vtable)
        if not module: return None
        locator = self.ptr(vtable-8)
        fields = struct.unpack('<6I',self.read(locator,24))
        if fields[0] != 1 or locator-fields[5] != module['base']: return None
        address = module['base']+fields[3]+16
        raw = self.read(address,256).split(b'\0',1)[0]
        if not raw.startswith((b'.?AV',b'.?AU')): return None
        return raw.decode('ascii')

    def node(self,address,expected_parent=None):
        public = self.read(address,16)
        vtable, private = struct.unpack('<2Q',public)
        data = self.read(private,64)
        private_vtable, backptr, parent, array, children_ptr, count = struct.unpack_from('<6Q',data)
        if backptr != address or count > 20000 or (expected_parent is not None and parent != expected_parent):
            raise ValueError('QObject identity/parent validation failed')
        flags = struct.unpack_from('<I',data,48)[0]
        if flags & 0x0c: raise ValueError('QObject is being deleted')
        if not self.module(vtable) or not self.module(private_vtable): raise ValueError('Invalid QObject vtable')
        children = list(struct.unpack('<'+'Q'*count,self.read(children_ptr,count*8))) if count else []
        # Retry on next explicit snapshot, not by racing a changing container.
        if self.read(address,16) != public or self.read(private,64) != data:
            raise ValueError('QObject changed during snapshot')
        return {'address':hex(address),'parent':hex(parent),'type':self.rtti(vtable),'children':children}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pid',type=int,required=True)
    parser.add_argument('--metadata',type=Path,required=True)
    parser.add_argument('--core-metadata',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--qml-contexts',action='store_true',help='Follow verified existing context-data pointers without creating QQmlContext wrappers')
    args = parser.parse_args()
    def lab_identity():
        identity = subprocess.run(['node',str(Path(__file__).with_name('lab_identity.mjs'))],
                                  check=True,capture_output=True,text=True,timeout=15)
        return json.loads(identity.stdout)['draftId']
    draft_id = lab_identity()
    reader = Reader(args.pid)
    try:
        metadata = json.loads(args.metadata.read_text(encoding='utf8'))
        creator = next(m for m in reader.modules if m['name'].lower() == 'vecreator.dll')
        if Path(creator['path']).resolve() != Path(metadata['image']).resolve(): raise ValueError('Unexpected creator image')
        if hashlib.sha256(Path(creator['path']).read_bytes()).hexdigest() != metadata['sha256']: raise ValueError('Creator build changed')
        core = next(m for m in reader.modules if m['name'].lower() == 'qt6core.dll')
        if Path(core['path']).parent != Path(creator['path']).parent: raise ValueError('Unexpected Qt installation')
        core_metadata = json.loads(args.core_metadata.read_text(encoding='utf8'))
        if hashlib.sha256(Path(core['path']).read_bytes()).hexdigest() != core_metadata['sha256']:
            raise ValueError('Qt Core build changed')
        pe = PE(core['path'])
        exported = next(e for e in pe.exports() if e['name'] == '?self@QCoreApplication@@0PEAV1@EA')
        app = reader.ptr(core['base']+int(exported['rva'],16))
        pending = [(app,None)]
        gui = next(m for m in reader.modules if m['name'].lower() == 'qt6gui.dll')
        if Path(gui['path']).parent != Path(creator['path']).parent: raise ValueError('Unexpected Qt GUI installation')
        gui_pe = PE(gui['path'])
        windows_export = next(e for e in gui_pe.exports() if e['name'] == '?window_list@QGuiApplicationPrivate@@2V?$QList@PEAVQWindow@@@@A')
        windows_address = gui['base']+int(windows_export['rva'],16)
        window_list = reader.read(windows_address,24)
        _,window_ptr,window_count = struct.unpack('<3Q',window_list)
        if window_count > 1000: raise ValueError('Invalid Qt window list')
        windows = struct.unpack('<'+'Q'*window_count,reader.read(window_ptr,window_count*8)) if window_count else []
        if reader.read(windows_address,24) != window_list: raise ValueError('Qt window list changed')
        pending.extend((p,None) for p in windows)
        if args.qml_contexts:
            qml = next(m for m in reader.modules if m['name'].lower() == 'qt6qml.dll')
            proof = json.loads((Path(__file__).resolve().parent.parent/'research/evidence/native-harness-proof.json').read_text(encoding='utf-8-sig'))
            if Path(qml['path']).parent != Path(creator['path']).parent:raise ValueError('Unexpected QML installation')
            if hashlib.sha256(Path(qml['path']).read_bytes()).hexdigest() != proof['dependencies']['Qt6Qml.dll']:
                # The accepted release uses a different file hash; validate its
                # recorded Qt section/export equivalence instead of beta hashes.
                from load_native_lab import validate
                validate(args.pid,build='9.6.0.4097')
            # These reads match the installed contextForObject/contextObject/
            # parentContext disassembly. No exported function is invoked.
            if reader.read(qml['base']+0xc5a0,5) != bytes.fromhex('48 8b 41 40 c3'):
                raise ValueError('QML context-object accessor changed')
        seen = set()
        contexts, context_rows, context_skipped = set(), [], []
        nodes, skipped = [], []
        while pending and len(seen) < 50000:
            address,parent = pending.pop()
            if address in seen: continue
            seen.add(address)
            try:
                node = reader.node(address,parent)
                nodes.append({**node,'children':[hex(p) for p in node['children']]})
                pending.extend((p,address) for p in node['children'])
                if args.qml_contexts:
                    try:
                        private = reader.ptr(address+8)
                        declarative = reader.ptr(private+0x68)
                        context = reader.ptr(declarative+0x28) if declarative else 0
                        depth = 0
                        while context and context not in contexts:
                            if depth >= 128 or len(contexts) >= 10000: raise ValueError('QML context traversal bound reached')
                            data = reader.read(context,0x48)
                            parent_context = struct.unpack_from('<Q',data,0)[0]
                            model = struct.unpack_from('<Q',data,0x40)[0]
                            if model: reader.node(model)
                            if reader.read(context,0x48) != data: raise ValueError('QML context changed')
                            contexts.add(context)
                            context_rows.append({'address':hex(context),'parent':hex(parent_context),'model':hex(model)})
                            if model: pending.append((model,None))
                            context = parent_context
                            depth += 1
                        if reader.ptr(address+8) != private or reader.ptr(private+0x68) != declarative:
                            raise ValueError('QML object lifetime changed')
                    except (ValueError,UnicodeDecodeError,struct.error) as error:
                        context_skipped.append({'object':hex(address),'reason':str(error)})
            except (ValueError,UnicodeDecodeError,struct.error) as error:
                skipped.append({'address':hex(address),'reason':str(error)})
        if lab_identity() != draft_id: raise ValueError('Active project changed; discard snapshot')
        result = {'pid':args.pid,'projectId':draft_id,'mode':'PROCESS_VM_READ only','root':hex(app),'creatorSha256':metadata['sha256'],
                  'scope':'QCoreApplication/QWindow QObject trees and existing QML context-data models' if args.qml_contexts else 'QCoreApplication and registered QWindow parented QObject trees; other roots not enumerated',
                  'truncated':bool(pending),'nodes':nodes,'skipped':skipped,
                  'contexts':context_rows,'contextSkipped':context_skipped,
                  'candidates':[n for n in nodes if n['type'] and re.search('LocalMedia|LocalImport|ImportMgr|Importer|VirtualStore',n['type'])]}
        args.output.parent.mkdir(parents=True,exist_ok=True)
        args.output.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
        print(json.dumps({'nodes':len(nodes),'skipped':len(skipped),'contexts':len(contexts),'contextSkipped':len(context_skipped),'candidates':result['candidates']}))
    finally: reader.close()


if __name__ == '__main__': main()
