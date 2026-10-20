"""Refresh only the current collection after a verified project operation.

Its pending marker can retry a view rebuild, never an import/move/rename.
No idle polling; retries happen on the operation or the next catalog event.
"""
import ctypes as C
import json
import time
import uuid
from explorer_native_runtime_v2 import Lease
from explorer_project_io_v2 import document_hashes,snapshot_project
from live_add import atomic

class Request(C.Structure):
    _fields_=[('size',C.c_uint32),('version',C.c_uint32),('output',C.c_wchar*1024),('lease',Lease)]

def refresh(data,context,*,mark=False):
    pending=context.private/('media-view-'+context.project_key+'.json')
    if not mark and not pending.exists():return True
    if mark:atomic(pending,{'projectKey':context.project_key,'kind':'view-only','contentCommandsAllowed':False})
    case=context.private/'media-view-reads'/uuid.uuid4().hex;case.mkdir(parents=True)
    before=document_hashes(context.directory);snapshot_project(context.directory,case/'before')
    editor=data['editor'];key=editor['Project']
    lease=Lease(processId=editor['ProcessId'],viewEpoch=editor['ViewEpoch'],location=key['Location'].replace('\\','/'),draftId=key['DraftId'].encode('ascii'),token=data['token'].encode('ascii'))
    receipt=None
    for attempt in range(3):
        if attempt:time.sleep(.75)
        receipt=context.invoke(editor['ProcessId'],'ViewRebuild','CapSync_ProductMediaViewThread',Request(lease=lease),case/f'evidence/view-{attempt}.json')
        if receipt.get('status')!='rejected' or receipt.get('reason')!='active pointer interaction':break
    after=document_hashes(context.directory);snapshot_project(context.directory,case/'after')
    accepted=before==after and receipt.get('status')=='refreshed' and all(receipt.get(k) is True for k in ('sdkBinUnchanged','navigationUnchanged','focusUnchanged','foregroundUnchanged'))
    atomic(case/'comparison.json',{'accepted':accepted,'projectDocumentsUnchanged':before==after,'viewOnly':True,'contentCommands':0})
    if accepted:pending.unlink(missing_ok=True)
    return accepted
