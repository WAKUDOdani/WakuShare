"""Recognize unreferenced runtime aliases, never media, clip or Draft identities.

CapCut can refresh combination_id while retaining the complete embedded Draft,
material ID and every clip field. An alias is eligible only when it occurs once
in the entire document and is not a reference anywhere else in that document.
"""
from collections import Counter
from copy import deepcopy
import uuid

def equivalent(before,after):
    if before==after:return True
    def strings(value):
        if isinstance(value,dict):
            for child in value.values():yield from strings(child)
        elif isinstance(value,list):
            for child in value:yield from strings(child)
        elif isinstance(value,str):yield value
    old_count=Counter(strings(before));new_count=Counter(strings(after));expected=deepcopy(before)
    def draft(left,right):
        old=left.get('materials',{}).get('drafts',[]);new=right.get('materials',{}).get('drafts',[])
        if len(old)!=len(new):return False
        for a,b in zip(old,new):
            if not isinstance(a,dict) or not isinstance(b,dict):return False
            if isinstance(a.get('draft'),dict) and isinstance(b.get('draft'),dict):
                if not draft(a['draft'],b['draft']):return False
            x,y=a.get('combination_id'),b.get('combination_id')
            if x==y:continue
            if a.get('type')!='combination' or b.get('type')!='combination' or not isinstance(a.get('draft'),dict) or a['draft']!=b.get('draft'):return False
            try:
                if not uuid.UUID(x).int or not uuid.UUID(y).int:return False
            except (ValueError,TypeError,AttributeError):return False
            if old_count[x]!=1 or new_count[y]!=1 or old_count[y] or new_count[x]:return False
            a['combination_id']=y
        return True
    return draft(expected,after) and expected==after
