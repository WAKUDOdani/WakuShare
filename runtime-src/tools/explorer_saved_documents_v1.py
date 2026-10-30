"""Request-scoped read-only SDK decoder. Plain JSON never crosses this boundary."""
import ctypes as C
import hashlib
import json
from pathlib import Path
import uuid
from explorer_project_io import SaveInProgress

_reader=None

def decode(directory,raw):
    if _reader is None:raise ValueError('Encrypted project requires a confirmed live SDK owner')
    return _reader(Path(directory).resolve(),raw)

def bind(data):
    global _reader
    _reader=None
    editor=data.get('editor',{});key=editor.get('Project')
    if editor.get('Status')!='Project' or not key:return
    from explorer_canonical_cache_v1 import canonical
    from explorer_native_runtime_v3 import Lease
    from explorer_product_bridge_v5 import invoke_observer,check_build
    location=Path(key['Location']).resolve();cache={}
    class Request(C.Structure):
        _fields_=[('size',C.c_uint32),('version',C.c_uint32),('output',C.c_wchar*1024),('lease',Lease)]
    lease=Lease(processId=editor['ProcessId'],viewEpoch=editor['ViewEpoch'],location=str(location).replace('\\','/'),draftId=key['DraftId'].encode('ascii'),token=data['token'].encode('ascii'))
    def read(directory,raw):
        if canonical(directory)!=canonical(location):raise ValueError('Encrypted document outside active project')
        names=('draft_content.json','draft_meta_info.json','draft_virtual_store.json','template-2.tmp')
        hashes={name:hashlib.sha256(raw[name]).hexdigest() if name in raw else None for name in names}
        revision=tuple(hashes.items())
        if revision in cache:return cache[revision].copy()
        check_build(editor['ProcessId'])
        output=Path(data['statePath']).resolve().parent/'document-reads'/uuid.uuid4().hex/'evidence/documents.json'
        result=invoke_observer(editor['ProcessId'],'Documents','CapSync_ProductDocumentRead',Request(lease=lease),output)
        if result.get('hashes')!=hashes:raise SaveInProgress('Project changed during SDK document read')
        if result.get('status')!='read' or result.get('projectMutation') is not False or not all(result.get(k) is True for k in ('focusUnchanged','foregroundUnchanged')):raise ValueError('Read-only SDK documents unavailable')
        if result.get('draftId')!=key['DraftId'] or canonical(result.get('location',''))!=canonical(location):raise ValueError('SDK document owner changed')
        documents=result['documents']
        if set(documents)!=set(raw) or any(not isinstance(value,dict) for value in documents.values()):raise ValueError('SDK document set invalid')
        decoded={name:json.dumps(value,ensure_ascii=False,separators=(',',':')).encode('utf8') for name,value in documents.items()}
        cache.clear();cache[revision]=decoded
        return decoded.copy()
    _reader=read
