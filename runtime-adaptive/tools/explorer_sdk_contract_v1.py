"""Resolve SDK methods by exported name in the verified current editor."""
import json
from load_native_lab import ROOT
from adaptive_context import export
def sdk_contract(media=False):
    value=json.loads((ROOT/'sdk-contract.json').read_bytes())
    required=dict(value['exports'])
    if media:required.update(value['avExports'])
    return {key:export(item['name']) for key,item in required.items()}, int(export('??_7Draft@lvve@@6B@')['rva'],16)
