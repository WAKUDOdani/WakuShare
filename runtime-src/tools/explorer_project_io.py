"""Bounded read-only settling after a project event or native command.

CapCut briefly denies file sharing while replacing its saved documents. Retrying
only the read cannot replay a native command or turn a graph conflict into success.
"""
import time
import hashlib
import json

class SaveInProgress(Exception):
    pass


def settling_read(operation,*args):
    for delay in (0,.05,.15,.3,.6,1.2,2):
        if delay:time.sleep(delay)
        try:return operation(*args)
        except (PermissionError,SaveInProgress,json.JSONDecodeError):
            if delay==2:raise


def load_project(directory):
    data=settling_read(read_documents,directory)
    return {'meta':json.loads(data['draft_meta_info.json']),'store':json.loads(data['draft_virtual_store.json']),'timeline':json.loads(data['draft_content.json'])}


def read_documents(directory):
    names=['draft_content.json','draft_meta_info.json','draft_virtual_store.json']
    if (directory/'template-2.tmp').exists():names.append('template-2.tmp')
    data={name:(directory/name).read_bytes() for name in names}
    for value in data.values():json.loads(value)
    if any((directory/name).read_bytes()!=value for name,value in data.items()):raise SaveInProgress('Project is being saved')
    return data


def snapshot_project(directory,destination):
    if destination.exists():raise ValueError('Snapshot already exists')
    data=settling_read(read_documents,directory)
    destination.mkdir(parents=True,exist_ok=False)
    for name,value in data.items():(destination/name).write_bytes(value)
    return {name:hashlib.sha256(value).hexdigest() for name,value in data.items()}
