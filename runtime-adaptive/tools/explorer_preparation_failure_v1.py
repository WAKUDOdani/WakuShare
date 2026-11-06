"""Recover only an independently proven missing-module failure before native load.

No native result is fabricated. The failed run and its diagnostics remain intact.
Loaded modules, a changed preimage, a native receipt or uncertain process lifetime
all refuse recovery. This is not a general retry of dispatched forests.
"""
import json
from pathlib import Path
from load_native_lab import modules,digest
from explorer_project_io_v2 import document_hashes
from live_add import atomic

def snapshot_hashes(directory):
    import json
    proof=directory/'.source-hashes.json'
    return json.loads(proof.read_bytes()) if proof.exists() else document_hashes(directory)

def proven(data,context,run,record):
    proof_file=run/'preparation-failure-proof.json'
    if not proof_file.is_file():return False
    proof=json.loads(proof_file.read_bytes())
    if proof.get('processId')!=data['editor']['ProcessId'] or proof.get('projectKey')!=context.project_key or proof.get('jobs')!=record['jobs']:return False
    if proof.get('module')!='CapSync.ExplorerProductFolderBatchV4.dll':return False
    if any(m['name'].casefold()==proof['module'].casefold() for m in modules(data['editor']['ProcessId'])):return False
    state=run/'evidence/forest-dispatch-state.json'
    receipt=run/'evidence/forest.json'
    if receipt.exists() or json.loads(state.read_bytes())!={'stage':'Dispatching','attempt':0,'receipt':'forest.json'}:return False
    error=(context.private/'adapter-errors'/proof['errorFile']).resolve()
    if error.parent!=context.private/'adapter-errors' or digest(error)!=proof['errorSha256']:return False
    failure=json.loads(error.read_bytes())
    if failure.get('type')!='FileNotFoundError' or not failure.get('reason','').endswith("CapSync.ExplorerProductCatalogV6.dll'"):return False
    if snapshot_hashes(run/'before')!=document_hashes(context.directory):return False
    atomic(run/'preparation-failure-verified.json',{'accepted':True,'projectUnchanged':True,'targetModuleNeverLoaded':True,'nativeCommands':0,'proofSha256':digest(proof_file)})
    return True
