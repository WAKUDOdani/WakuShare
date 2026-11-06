"""The complete pre-command SDK Draft is authoritative for an open editor.

Saved snapshots remain intact. A sealed native receipt must prove every loaded
Draft and the SDK bin unchanged before its preimage can be used for comparison.
"""
from copy import deepcopy
import json
from explorer_draft_compare_v1 import same_draft
from explorer_project_io_v2 import read_documents

def baseline(saved,receipt,sidecar):
    if receipt.get('completeSdkBaseline') is not True:return saved,None
    if not all(receipt.get(k) is True for k in ('sdkBinUnchanged','allSdkDraftsUnchanged','focusUnchanged','foregroundUnchanged','navigationUnchanged')):raise ValueError('Complete native SDK preservation proof required')
    if sidecar.stat().st_size>64*1024*1024:raise ValueError('SDK baseline exceeds bounds')
    expected=json.loads(sidecar.read_bytes())
    if not isinstance(expected,dict) or not expected.get('id') or expected['id']!=saved['timeline'].get('id'):raise ValueError('SDK baseline belongs to another timeline')
    result=deepcopy(saved);result['timeline']=expected
    return result,expected

def saved_state(current,expected,directory):
    if expected is None:return current
    result=deepcopy(current)
    if same_draft(result['timeline'],expected,directory):result['timeline']=deepcopy(expected)
    return result

def template_exact(directory,expected,project):
    value=read_documents(directory).get('template-2.tmp')
    return value is not None and same_draft(json.loads(value),expected,project)
