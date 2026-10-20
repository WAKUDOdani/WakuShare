"""Compare the entire batch in one pass, preserving every unrelated field.

Equivalent acceptance boundary to individual additions, without copying and
sorting the whole registry once for each of sixty-four new cards.
"""
from copy import deepcopy
import json
from explorer_native_runtime_v3 import normalize_stock_service
from live_add import rows,canonical
from store_equivalence import normalized_store
from explorer_canonical_cache_v1 import canonical

def compare(before,after,jobs,identifiers,parent):
    errors=[];after=normalize_stock_service(before,after);expected_ids={j['Id'] for j in jobs};added=set(identifiers.values())
    if set(identifiers)!=expected_ids or len(added)!=len(jobs):return {'accepted':False,'errors':['Batch identities are not complete and unique'],'count':len(jobs)}
    old_rows=rows(before);new_rows=rows(after);old={r['id']:r for r in old_rows};new={r['id']:r for r in new_rows}
    if len(old)!=len(old_rows) or len(new)!=len(new_rows):errors.append('Duplicate registry UUID')
    if added & set(old) or set(new)-set(old)!=added or set(old)-set(new):errors.append('Batch registry membership differs')
    if any(new.get(identifier)!=row for identifier,row in old.items()):errors.append('Unrelated registry row changed')
    paths={}
    for row in new_rows:
        if row.get('file_Path'):paths.setdefault(canonical(row['file_Path']),[]).append(row['id'])
    for job in jobs:
        if paths.get(canonical(job['SourcePath']))!=[identifiers[job['Id']]]:errors.append('New source ownership ambiguous')
    reduced=deepcopy(after['meta'])
    for group in reduced['draft_materials']:group['value']=[r for r in group['value'] if r['id'] not in added]
    left=deepcopy(before['meta'])
    for doc in (left,reduced):
        doc.pop('tm_draft_modified',None)
        for group in doc['draft_materials']:group['value'].sort(key=lambda row:json.dumps(row,sort_keys=True))
    if left!=reduced:errors.append('Other project metadata or registry group changed')
    store=deepcopy(after['store']);edges={identifier:[] for identifier in added}
    for group in store['draft_virtual_store']:
        if group['type']==1:
            for row in group['value']:
                if row['child_id'] in added:edges[row['child_id']].append(row)
            group['value']=[r for r in group['value'] if r['child_id'] not in added]
    parents={identifiers[j['Id']]:parent[j['Id']] if isinstance(parent,dict) else parent for j in jobs}
    if any(edges[identifier]!=[{'child_id':identifier,'parent_id':parents[identifier]}] for identifier in added):errors.append('Wrong or duplicate batch destination edge')
    if normalized_store(store)!=normalized_store(before['store']):errors.append('Unrelated virtual-store data changed')
    if before['timeline']!=after['timeline']:errors.append('Timeline changed during batch import')
    return {'accepted':not errors,'errors':list(dict.fromkeys(errors)),'count':len(jobs),'timelineUnchanged':before['timeline']==after['timeline']}
