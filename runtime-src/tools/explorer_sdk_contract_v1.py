"""Immutable SDK export contract, without packaging laboratory projects or journals."""
import json
from pathlib import Path
from load_native_lab import ROOT


def sdk_contract(media=False):
    packaged = ROOT / 'sdk-contract.json'
    if packaged.exists():
        value = json.loads(packaged.read_bytes())
        if value['build'] != '9.6.0.4097':
            raise ValueError('SDK contract build differs')
        exports = dict(value['exports'])
        if media:
            exports.update(value['avExports'])
        return exports, value['draftVtableRva']
    # Development uses the previously accepted reference, never another probe.
    from live_source_path import acceptance, SCOPES, PNG_MATERIAL
    _, manifest = acceptance(SCOPES[PNG_MATERIAL])
    exports = json.loads(manifest.read_bytes())['exports']
    if media:
        proof = json.loads((ROOT / 'research/evidence/direct-sdk-access/av-narrow-path-batch/journal.json').read_bytes())
        exports.update(json.loads(Path(proof['manifest']).read_bytes())['exports'])
    model = json.loads((ROOT / 'artifacts/SdkModelProbe/1792059078966742900/model-report.json').read_bytes())
    return exports, model['draftVtableRva']
