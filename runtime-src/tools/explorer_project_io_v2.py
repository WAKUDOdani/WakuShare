"""Read-only project snapshots, including CapCut's not-yet-serialized empty tree.

The implicit root shape comes from native-stock-capture and the empty-project
ReadProcessMemory proof. It is an in-memory comparison model, never a disk write.
"""
from copy import deepcopy
import hashlib
import json
from explorer_project_io import SaveInProgress,settling_read

SERVICE='cd484075-d92a-4bc9-b45c-d093d2f9e71b'
EMPTY_ROOT={'creation_time':0,'display_name':'','filter_type':0,'id':'',
    'import_time':0,'import_time_us':0,'material_color_tag':'','sort_sub_type':0,
    'sort_type':0,'subdraft_filter_type':0}
IMPLICIT_STORE={'draft_materials':[],'draft_virtual_store':[
    {'type':0,'value':[EMPTY_ROOT]},
    {'type':1,'value':[{'child_id':SERVICE,'parent_id':''}]},
    {'type':2,'value':[]}]}
NAMES=('draft_content.json','draft_meta_info.json','draft_virtual_store.json','template-2.tmp')

def _read_documents(directory):
    exists={name:(directory/name).exists() for name in NAMES}
    if not all(exists[name] for name in NAMES[:2]):raise SaveInProgress('Project documents unavailable')
    data={name:(directory/name).read_bytes() for name in NAMES if exists[name]}
    parsed={name:json.loads(value) for name,value in data.items()}
    if not exists['draft_virtual_store.json']:
        meta=parsed['draft_meta_info.json'];timeline=parsed['draft_content.json']
        if not isinstance(meta.get('draft_materials'),list) or any(g.get('value') for g in meta['draft_materials']):
            raise SaveInProgress('Nonempty project hierarchy unavailable')
        if any(t.get('segments') for t in timeline.get('tracks',[])):
            raise SaveInProgress('Used project hierarchy unavailable')
    if exists!={name:(directory/name).exists() for name in NAMES} or any((directory/name).read_bytes()!=value for name,value in data.items()):
        raise SaveInProgress('Project is being saved')
    return data

def read_documents(directory):
    try:return _read_documents(directory)
    except FileNotFoundError as error:
        # A file can vanish between exists() and read_bytes() during replace.
        # Keep the same bounded read wait; do not invent a missing hierarchy.
        raise SaveInProgress('Project documents are being replaced') from error

def load_project(directory):
    data=settling_read(read_documents,directory)
    return {'meta':json.loads(data['draft_meta_info.json']),
        'store':json.loads(data['draft_virtual_store.json']) if 'draft_virtual_store.json' in data else deepcopy(IMPLICIT_STORE),
        'timeline':json.loads(data['draft_content.json'])}

def document_hashes(directory):
    data=settling_read(read_documents,directory)
    return {name:hashlib.sha256(data[name]).hexdigest() if name in data else None for name in NAMES}

def snapshot_project(directory,destination):
    if destination.exists():raise ValueError('Snapshot already exists')
    data=settling_read(read_documents,directory)
    destination.mkdir(parents=True,exist_ok=False)
    for name,value in data.items():(destination/name).write_bytes(value)
    return {name:hashlib.sha256(data[name]).hexdigest() if name in data else None for name in NAMES}
