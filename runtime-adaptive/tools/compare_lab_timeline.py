"""Compare lab timelines, permitting only consistent regeneration of audio helper IDs.

This is a separate diagnostic result; it does not weaken native-import acceptance.
"""
import argparse
import copy
import json
from pathlib import Path


def compare(before, after):
    normalized = copy.deepcopy(after)
    mapping = {}
    errors = []
    for category in ('loudnesses', 'vocal_separations'):
        old = before.get('materials', {}).get(category, [])
        new = normalized.get('materials', {}).get(category, [])
        if len(old) != len(new):
            errors.append(f'{category}: helper count changed')
            continue
        for left, right in zip(old, new):
            if {k:v for k,v in left.items() if k != 'id'} != {k:v for k,v in right.items() if k != 'id'}:
                errors.append(f'{category}: helper settings changed')
                continue
            if right['id'] in mapping and mapping[right['id']] != left['id']:
                errors.append('Ambiguous helper ID mapping')
            mapping[right['id']] = left['id']
            right['id'] = left['id']
    for track in normalized.get('tracks', []):
        for segment in track.get('segments', []):
            segment['extra_material_refs'] = [mapping.get(v,v) for v in segment.get('extra_material_refs', [])]
    if before != normalized: errors.append('Other timeline content or references changed')
    return {'equivalentExceptAudioHelperIds':not errors,'errors':errors,
            'regeneratedIds':sum(k != v for k,v in mapping.items()),
            'videoMaterialsUnchanged':before.get('materials',{}).get('videos') == after.get('materials',{}).get('videos')}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run',type=Path,required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent/'research/evidence'
    run = args.run.resolve()
    if not run.is_relative_to(root): raise ValueError('Owned snapshots required')
    before = json.loads((run/'before/draft_content.json').read_text(encoding='utf8'))
    after = json.loads((run/'after/draft_content.json').read_text(encoding='utf8'))
    result = compare(before,after)
    (run/'timeline-semantic-check.json').write_text(json.dumps(result,indent=2),encoding='utf8')
    print(json.dumps(result))
    raise SystemExit(0 if result['equivalentExceptAudioHelperIds'] else 1)


if __name__ == '__main__': main()
