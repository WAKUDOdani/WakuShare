"""Read-only, version-independent discovery of the interfaces used by autosync.

Unknown or ambiguous machine-code landmarks disable their dependent operations.
No module is loaded, patched or invoked by this resolver.
"""
import bisect
import hashlib
import json
import struct
from pathlib import Path
from qt_meta_inventory import PE

PROFILE = Path(__file__).with_name('adaptive-symbols.json')
CORE = {'project.current', 'project.manager', 'project.managerStorage', 'project.store', 'media.service'}
READ = CORE | {'resources.manager', 'resources.model', 'timelines.manager'}
GROUPS = {
    'connect': CORE,
    'read': READ,
    'add': READ | {'metadata.allocate', 'metadata.vtable', 'metadata.assignTitle', 'folders.move', 'folders.save', 'folders.notify', 'media.save', 'media.refresh'},
    'folders': READ | {'metadata.allocate', 'metadata.vtable', 'folders.move', 'folders.save', 'folders.notify', 'media.refresh'},
    'rename': READ | {'metadata.assignTitle', 'media.sourcePath', 'media.rename', 'media.relink', 'media.save', 'media.refresh'},
    'move': READ | {'folders.move', 'folders.save', 'media.relink', 'media.save', 'media.refresh'},
    'remove': READ | {'media.remove', 'folders.save', 'media.refresh'},
    'restore': READ | {'metadata.allocate', 'metadata.vtable', 'folders.move', 'folders.save', 'media.refresh'},
}


class CapabilityError(Exception):
    def __init__(self, operation, missing, code='interface_unavailable'):
        self.operation, self.missing, self.code = operation, sorted(set(missing)), code
        super().__init__('AUTOSYNC|' + operation + '|' + code + '|' + ','.join(self.missing))


def scan(text, text_rva, mark):
    raw, mask = bytes.fromhex(mark['bytes']), bytes.fromhex(mark['mask'])
    if len(raw) != len(mask) or len(raw) < 12:
        raise ValueError('Invalid structural profile')
    runs, start = [], None
    for i, value in enumerate(mask + b'\0'):
        if value and start is None:
            start = i
        if not value and start is not None:
            runs.append((start, i)); start = None
    left, right = max(runs, key=lambda run: run[1] - run[0])
    if right - left < 3:
        raise ValueError('Weak structural profile')
    result, cursor = [], 0
    while True:
        found = text.find(raw[left:right], cursor)
        if found < 0:
            return result
        cursor, candidate = found + 1, found - left
        if candidate < 0 or candidate + len(raw) > len(text):
            continue
        if all(not mask[i] or raw[i] == text[candidate + i] for i in range(len(raw))):
            result.append(text_rva + candidate)
        if len(result) > 32:
            return []


def in_section(pe, rva, executable):
    return any((name == '.text') == executable and start <= rva < start + virtual_size
               for name, start, _, _, virtual_size in pe.sections)

def qt_abi(directory):
    """Inspect qVersion's constant return value without loading vendor code."""
    try:
        pe=PE(Path(directory)/'Qt6Core.dll')
        entry=next(item for item in pe.exports() if item['name']=='qVersion')
        rva=int(entry['rva'],16);offset=pe.offset(pe.base+rva)
        body=pe.raw[offset:offset+8]
        if body[:3]!=b'\x48\x8d\x05' or body[7:]!=b'\xc3':return None
        target=rva+7+struct.unpack_from('<i',body,3)[0]
        if not in_section(pe,target,False):return None
        offset=pe.offset(pe.base+target)
        return pe.raw[offset:offset+16].split(b'\0',1)[0].decode('ascii')
    except (OSError,ValueError,StopIteration,UnicodeDecodeError):return None


def discover(creator_path, sdk_path):
    creator, sdk = PE(creator_path), PE(sdk_path)
    profile = json.loads(PROFILE.read_bytes())
    text = next(section for section in creator.sections if section[0] == '.text')
    code = creator.raw[text[2]:text[2] + text[3]]
    resolved, details, proofs = {}, [], {}
    for symbol in profile['symbols']:
        kind, votes, evidence = symbol['kind'], {}, []
        if kind == 'returnedGlobal':
            fn = resolved.get(symbol['functionKey'])
            if fn:
                offset = creator.offset(creator.base + fn)
                body = creator.raw[offset:offset + 128]
                for i in range(len(body) - 13):
                    if body[i:i + 3] == b'\x48\x8d\x05' and body[i + 7:i + 10] == b'\x48\x83\xc4' and body[i + 11:i + 13] == b'\x5b\xc3':
                        value = fn + i + 7 + struct.unpack_from('<i', body, i + 3)[0]
                        if in_section(creator, value, False):
                            votes[value] = 2
        else:
            for mark in symbol['marks']:
                matches = scan(code, text[1], mark)
                if len(matches) != 1:
                    evidence.append(0)
                    continue
                if kind == 'function':
                    value = matches[0] - mark['oldOffset']
                    if not in_section(creator, value, True):
                        evidence.append(0)
                        continue
                elif kind == 'rip':
                    reference = matches[0] + mark['referenceOffset']
                    offset = creator.offset(creator.base + reference + mark['displacementOffset'])
                    value = reference + mark['instructionLength'] + struct.unpack_from('<i', creator.raw, offset)[0]
                    if not in_section(creator, value, False):
                        evidence.append(0)
                        continue
                else:
                    raise ValueError('Unknown structural profile kind')
                votes[value] = votes.get(value, 0) + 1
                evidence.append(matches[0])
        accepted = [value for value, count in votes.items() if count >= 2]
        available = len(accepted) == 1
        if available:
            resolved[symbol['key']] = accepted[0]
            proofs[symbol['key']] = evidence[:3]
        details.append({'name': symbol['name'], 'key': symbol['key'], 'available': available,
                        'reason': None if available else 'missing_or_ambiguous_landmarks'})
    contract = json.loads((PROFILE.parent.parent / 'sdk-contract.json').read_bytes())
    exports = {item['name']: int(item['rva'], 16) for item in sdk.exports()}
    source_symbols = {key: item['name'] for key, item in {**contract['exports'], **contract['avExports']}.items()}
    sdk_contract = json.loads(PROFILE.with_name('adaptive-sdk-contract.json').read_bytes())
    common_symbols = {**sdk_contract['connect'], **sdk_contract['read']}
    source_symbols.update(sdk_contract['write'])
    available = {item['name'] for item in details if item['available']}
    abi=qt_abi(Path(creator_path).parent)
    capabilities = []
    for operation, required in GROUPS.items():
        sdk_required = sdk_contract['connect'] if operation == 'connect' else common_symbols
        if operation in ('rename', 'move'):
            sdk_required = {**sdk_required, **source_symbols}
        sdk_missing = ['sdk.' + key for key, name in sdk_required.items() if name not in exports]
        missing = sorted(required - available) + sdk_missing
        if abi!='6.2.2':missing.append('qt.privateABI.6.2.2 (found '+(abi or 'unknown')+')')
        capabilities.append({'operation': operation, 'available': not missing, 'missing': missing})
    return {'schemaVersion': 1, 'build': Path(creator_path).parent.name, 'qtAbi':abi,
            'creatorSha256': hashlib.sha256(creator.raw).hexdigest(), 'proofs': proofs,
            'sdkSha256': hashlib.sha256(sdk.raw).hexdigest(), 'symbols': resolved,
            'symbolDetails': details, 'capabilities': capabilities,
            'sdkExports': exports, 'profileSha256': hashlib.sha256(PROFILE.read_bytes()).hexdigest()}


def require(report, operation):
    item = next(item for item in report['capabilities'] if item['operation'] == operation)
    if not item['available']:
        raise CapabilityError(operation, item['missing'])
    return report
