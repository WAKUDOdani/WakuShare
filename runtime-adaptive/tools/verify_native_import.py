"""Acceptance check for one lab import from owned before/after snapshots.

Invocation success and appearance of a new row are not sufficient. Existing
registry ownership, folders, relationships and the timeline must survive.
"""
import argparse
from collections import Counter
import json
from pathlib import Path

TARGET = 'f3fd343f-a805-42f7-9109-49e1dc8da258'


def check(before, after, source, allowed_added_rows=None):
    errors = []
    old = {r['id']:r for g in before['meta']['draft_materials'] for r in g.get('value',[])}
    new = {r['id']:r for g in after['meta']['draft_materials'] for r in g.get('value',[])}
    removed = sorted(old.keys()-new.keys())
    changed = sorted(k for k in old.keys()&new.keys() if old[k] != new[k])
    if removed: errors.append('Existing media registry rows disappeared')
    if changed: errors.append('Existing media registry rows changed')
    all_added = new.keys()-old.keys()
    allowed_added_rows = allowed_added_rows or {}
    time_fields = {'create_time','import_time','import_time_ms'}
    def stable_row(row): return {k:v for k,v in row.items() if k not in time_fields}
    allowed = {k for k in all_added if k in allowed_added_rows
               and not new[k].get('file_Path') and new[k].get('metetype') == 'none'
               and stable_row(new[k]) == stable_row(allowed_added_rows[k])}
    added = all_added-allowed
    if len(added) != 1: errors.append('Expected exactly one new registry ID')
    def canonical(path): return path.replace('\\','/').casefold()
    imported = [key for key in added if canonical(new[key].get('file_Path','')) == canonical(source)]
    if len(imported) != 1: errors.append('New source does not have one distinct registry ID')
    def groups(document,kind):
        return [v for g in document['draft_virtual_store'] if g['type'] == kind for v in g.get('value',[])]
    old_folders = {r['id']:r for r in groups(before['store'],0)}
    new_folders = {r['id']:r for r in groups(after['store'],0)}
    if old_folders != new_folders: errors.append('Existing folder containers changed')
    old_edges = Counter((r['child_id'],r['parent_id']) for r in groups(before['store'],1))
    new_edges = Counter((r['child_id'],r['parent_id']) for r in groups(after['store'],1))
    if old_edges-new_edges: errors.append('Existing folder/material relationships disappeared')
    delta = new_edges-old_edges
    expected = Counter({(imported[0],TARGET):1}) if len(imported) == 1 else Counter()
    if delta != expected: errors.append('New relationship is duplicated or targets the wrong folder')
    if groups(before['store'],2) != groups(after['store'],2): errors.append('Other virtual-store attributes changed')
    if before['timeline'] != after['timeline']: errors.append('Timeline document changed')
    return {'accepted':not errors,'errors':errors,'removedRegistryIds':removed,
            'changedRegistryIds':changed,'addedRegistryIds':sorted(all_added),
            'addedMediaRegistryIds':sorted(added),'allowedAddedServiceRows':sorted(allowed),
            'timelineUnchanged':before['timeline'] == after['timeline']}


def load(folder):
    def read(name): return json.loads((folder/name).read_text(encoding='utf8'))
    return {'meta':read('draft_meta_info.json'),'store':read('draft_virtual_store.json'),
            'timeline':read('draft_content.json')}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run',type=Path,required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    run = args.run.resolve()
    if not run.is_relative_to(root/'research/evidence'): raise ValueError('Owned evidence directory required')
    result = check(load(run/'before'),load(run/'after'),str(root/'research/fixtures/ManagedB/new-from-probe.png'))
    (run/'acceptance.json').write_text(json.dumps(result,indent=2),encoding='utf8')
    print(json.dumps(result))
    raise SystemExit(0 if result['accepted'] else 1)


if __name__ == '__main__': main()
