"""Recognize only CapCut's first-save rekey of disabled per-clip audio helpers.

Not a source/material-ID remapper. Ordinary media IDs, clip IDs, timings and all
parameters remain exact. Only two complete known disabled schemas are eligible;
each helper keeps its one original reference on the same clip and array position.
"""
from collections import Counter
from copy import deepcopy
import json
import uuid

DEFAULTS={
    'loudnesses':{'enable':False,'time_range':None,'file_id':'','target_loudness':0,'loudness_param':None},
    'vocal_separations':{'type':'vocal_separation','choice':0,'removed_sounds':[],'time_range':None,'production_path':'','final_algorithm':'','enter_from':''}
}

def defaults_equivalent(before,after):
    if before==after:return True
    expected=deepcopy(before);mapping={}
    old_materials=before.get('materials',{});new_materials=after.get('materials',{})
    old_ids=Counter(row.get('id') for group in old_materials.values() if isinstance(group,list) for row in group if isinstance(row,dict))
    new_ids=Counter(row.get('id') for group in new_materials.values() if isinstance(group,list) for row in group if isinstance(row,dict))
    for group,shape in DEFAULTS.items():
        left,right=old_materials.get(group,[]),new_materials.get(group,[])
        if len(left)!=len(right):return False
        for i,(old,new) in enumerate(zip(left,right)):
            if old==new:continue
            if {k:v for k,v in old.items() if k!='id'}!=shape or {k:v for k,v in new.items() if k!='id'}!=shape:return False
            a,b=old.get('id'),new.get('id')
            try:
                if not a or not b or uuid.UUID(a).int==0 or uuid.UUID(b).int==0:return False
            except (ValueError,TypeError,AttributeError):return False
            if old_ids[a]!=1 or new_ids[b]!=1 or a in mapping or b in mapping.values() or old_ids[b] or new_ids[a]:return False
            mapping[a]=b;expected['materials'][group][i]['id']=b
    if not mapping:return False
    counts=Counter()
    for track in expected.get('tracks',[]):
        for segment in track.get('segments',[]):
            refs=segment.get('extra_material_refs',[])
            for i,ref in enumerate(refs):
                if ref in mapping:counts[ref]+=1;refs[i]=mapping[ref]
    if any(counts[identifier]!=1 for identifier in mapping):return False
    return expected==after

def normalize_first_library(before,after):
    from explorer_project_io_v2 import IMPLICIT_STORE
    if before['store']!=IMPLICIT_STORE or any(group.get('value') for group in before['meta']['draft_materials']):return before
    if not defaults_equivalent(before['timeline'],after['timeline']):return before
    result=deepcopy(before);result['timeline']=deepcopy(after['timeline']);return result

def initial_template_equivalent(original,current,before_timeline):
    if (original/'draft_virtual_store.json').exists():return False
    meta=json.loads((original/'draft_meta_info.json').read_bytes())
    if not isinstance(meta.get('draft_materials'),list) or any(g.get('value') for g in meta['draft_materials']):return False
    left=json.loads((original/'template-2.tmp').read_bytes())
    right=json.loads((current/'template-2.tmp').read_bytes())
    return left==before_timeline and defaults_equivalent(left,right)
