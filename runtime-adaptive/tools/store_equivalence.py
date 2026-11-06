"""Compare serialized container/edge rows without granting field-change waivers.

CapCut rewrites these two flat arrays in tree traversal order after reopening.
All row fields, multiplicity, explicit sort settings and other groups remain
part of the comparison. This does not normalize child lists or timeline tracks.
"""
from copy import deepcopy
import json


def normalized_store(store):
    result=deepcopy(store)
    for group in result['draft_virtual_store']:
        if group['type'] in (0,1):
            group['value']=sorted(group.get('value',[]),key=lambda row:json.dumps(row,sort_keys=True,separators=(',',':')))
    return result
