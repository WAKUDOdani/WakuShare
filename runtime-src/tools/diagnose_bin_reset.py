"""One bounded, read-only lab scenario: saved documents + active SDK + reset callers.

No injected modules, editor commands, project writes or OS input. Detailed
evidence stays on disk; stdout contains a compact summary only. Requires the
locally staged capstone 5.0.6 solely for candidate call-site decoding.
"""
import argparse
from bisect import bisect_right
import hashlib
import json
from pathlib import Path
import re
import struct
import sys
import time

from load_native_lab import ROOT, LAB_ID, identity, lab_directory
from live_add import main_pid
from qt_live_read import Reader
from qt_meta_inventory import PE

CREATOR_SHA = '5bac0b46e9e045de20d278e98e652a5a55637b3d903b416f18d9f5e0b25f38f9'
SDK_SHA = '47e341ce930074bd7d11ef418ea5c893fc6330aa73b2f2203c5098f302d63e9f'
MATERIAL = 'c024b416-3002-4de9-9ab8-7e39d7148523'
NAMES = ('draft_meta_info.json', 'draft_virtual_store.json', 'draft_content.json')


def save(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf8')


def string(reader, address):
    raw = reader.read(address, 32)
    length, capacity = struct.unpack_from('<2Q', raw, 16)
    if length > 4096 or capacity < length or capacity > 65536:
        raise ValueError('SDK string layout not recognized')
    data = raw[:length] if capacity < 16 else reader.read(struct.unpack_from('<Q', raw)[0], length)
    if reader.read(address, 32) != raw:
        raise ValueError('SDK string changed during read')
    return data.decode('utf8')


def sdk_material(reader, creator, material_id=MATERIAL):
    # The verified getter takes this inline singleton address, not its vtable.
    manager = creator['base'] + 0xEBB65B0
    project = reader.ptr(manager + 0x18)
    if reader.rtti(reader.ptr(project)) != '.?AVVECoreProject@@':
        raise ValueError('Unexpected active project class')
    wrapper = reader.ptr(project + 0x30)
    if reader.read(wrapper + 0x10, 1) != b'\x01':
        raise ValueError('Unexpected SDK wrapper mode')
    store = reader.ptr(wrapper + 0x28)
    header = reader.read(store + 0x138, 16)
    head, count = struct.unpack('<2Q', header)
    if count > 32:
        raise ValueError('SDK group bounds exceeded')
    head_raw = reader.read(head, 32)
    pending = [struct.unpack_from('<Q', head_raw, 8)[0]]
    seen, samples, found = set(), [], []
    while pending:
        node = pending.pop()
        if node == head:
            continue
        if node in seen or len(seen) >= 32:
            raise ValueError('SDK map changed or is cyclic')
        seen.add(node)
        raw = reader.read(node, 64)
        samples.append((node, raw))
        pending.extend(struct.unpack_from('<Q', raw, off)[0] for off in (0, 16))
        kind = struct.unpack_from('<i', raw, 32)[0]
        begin, end = struct.unpack_from('<2Q', raw, 40)
        if end < begin or (end - begin) % 16 or end - begin > 512 * 16:
            raise ValueError('SDK material vector bounds exceeded')
        pointers = reader.read(begin, end - begin) if end > begin else b''
        samples.append((begin, pointers))
        for off in range(0, len(pointers), 16):
            obj = struct.unpack_from('<Q', pointers, off)[0]
            identifier=string(reader,obj+0x60)
            if material_id is None or identifier == material_id:
                item={'kind': kind, 'object': hex(obj),
                              'path': string(reader, obj), 'originalPath':string(reader,obj+0x20),
                              'label': string(reader, obj + 0xD0)}
                if material_id is None:item['id']=identifier
                found.append(item)
                if len(found)>512:raise ValueError('SDK material bounds exceeded')
    if len(seen) != count or (material_id is not None and len(found) != 1) or \
       (material_id is None and len({v['id'] for v in found})!=len(found)):
        raise ValueError('SDK owned material resolution incomplete or ambiguous')
    if any(reader.read(addr, len(raw)) != raw for addr, raw in samples if raw):
        raise ValueError('SDK containers changed during read')
    if (reader.read(store + 0x138, 16) != header or reader.read(head, 32) != head_raw
            or reader.ptr(manager + 0x18) != project or reader.ptr(project + 0x30) != wrapper
            or reader.ptr(wrapper + 0x28) != store):
        raise ValueError('SDK owner changed during read')
    return {'store': hex(store), 'groups': count, **({'materials':found} if material_id is None else {'material':found[0]})}


def catalog(directory):
    raw = {name: (directory / name).read_bytes() for name in NAMES}
    documents = {name: json.loads(data.decode('utf8')) for name, data in raw.items()}
    if documents[NAMES[0]]['draft_id'] != LAB_ID:
        raise ValueError('Saved project identity changed')
    if any((directory / name).read_bytes() != data for name, data in raw.items()):
        raise ValueError('Saved project changed during read; no implicit retry')
    rows = [row for group in documents[NAMES[0]]['draft_materials'] for row in group.get('value', [])]
    owned = [row for row in rows if row['id'] == MATERIAL]
    if len(owned) != 1:
        raise ValueError('Owned saved material missing or duplicated')
    return documents, {'hashes': {name: hashlib.sha256(raw[name]).hexdigest() for name in NAMES},
                       'material': owned[0], 'registryCount': len(rows)}


def reset_callers(reader, creator, sdk, creator_pe, sdk_pe, out, wrapper=False):
    sys.path.insert(0, str(ROOT / 'research/vendor/analysis-python'))
    from capstone import Cs, CS_ARCH_X86, CS_MODE_64, CS_OP_MEM
    from capstone.x86_const import X86_REG_RIP
    owner='StoreWrapper' if wrapper else 'DraftStore'
    exports = [entry for entry in sdk_pe.exports()
               if entry['name'].startswith('?resetDraftMaterialList@'+owner+'@')]
    expected=[0x135B080,0x135B0B0] if wrapper else [0x12D5780,0x12D5830]
    if sorted(int(entry['rva'], 16) for entry in exports) != expected:
        raise ValueError('Verified reset exports changed')
    slots = {entry['rva']: [] for entry in exports}
    for name, start, _, size, virtual in creator_pe.sections:
        if name != '.rdata':
            continue
        length = max(size, virtual)
        for offset in range(0, length, 1024 * 1024):
            data = reader.read(creator['base'] + start + offset, min(1024 * 1024, length - offset))
            for entry in exports:
                needle = struct.pack('<Q', sdk['base'] + int(entry['rva'], 16))
                for match in re.finditer(re.escape(needle), data):
                    address = start + offset + match.start()
                    if address % 8 == 0:
                        slots[entry['rva']].append(address)
    by_slot = {slot: entry['rva'] for entry in exports for slot in slots[entry['rva']]}
    nt=creator_pe.u32(0x3c)
    exception_rva,exception_size=struct.unpack_from('<2I',creator_pe.raw,nt+24+112+3*8)
    exception_offset=creator_pe.offset(creator_pe.base+exception_rva)
    functions = [struct.unpack_from('<3I', creator_pe.raw, exception_offset + off)[:2]
                 for off in range(0, exception_size, 12)]
    functions = sorted((begin, end) for begin, end in functions if begin < end)
    starts = [begin for begin, _ in functions]
    decoder = Cs(CS_ARCH_X86, CS_MODE_64)
    decoder.detail = True
    candidates = []
    for name, start, raw, size, _ in creator_pe.sections:
        if name != '.text':
            continue
        data = creator_pe.raw[raw:raw + size]
        for match in re.finditer(rb'\xff[\x15\x25]', data):
            off = match.start()
            if off + 6 > len(data):
                continue
            address = start + off
            slot = address + 6 + struct.unpack_from('<i', data, off + 2)[0]
            if slot not in by_slot:
                continue
            index = bisect_right(starts, address) - 1
            if index < 0 or not functions[index][0] <= address < functions[index][1]:
                candidates.append({'rva': hex(address), 'slot': hex(slot), 'decoded': False})
                continue
            begin, end = functions[index]
            if end - begin > 65536:
                candidates.append({'rva': hex(address), 'slot': hex(slot), 'decoded': False, 'reason': 'function exceeds bound'})
                continue
            code = creator_pe.raw[creator_pe.offset(creator_pe.base + begin):][:end - begin]
            instructions = list(decoder.disasm(code, creator_pe.base + begin))
            hit = next((i for i, ins in enumerate(instructions) if ins.address - creator_pe.base == address), None)
            valid = hit is not None and any(op.type == CS_OP_MEM and op.mem.base == X86_REG_RIP
                and instructions[hit].address + instructions[hit].size + op.mem.disp - creator_pe.base == slot
                for op in instructions[hit].operands)
            entry = {'rva': hex(address), 'slot': hex(slot), 'sdkRva': by_slot[slot],
                     'functionStart': hex(begin), 'functionEnd': hex(end), 'decoded': valid}
            candidates.append(entry)
            if valid:
                context = instructions[max(0, hit - 24):hit + 12]
                (out / f'caller-{address:x}.txt').write_text('\n'.join(
                    f'{ins.address - creator_pe.base:08x}  {ins.mnemonic} {ins.op_str}' for ins in context), encoding='utf8')
    result = {'exports': exports, 'slots': {key: [hex(v) for v in val] for key, val in slots.items()},
              'callers': candidates, 'executedCallsObserved': False}
    save(out / 'reset-callers.json', result)
    return result


def internal_reset_callers(pe, out):
    """Second check of the reset hypothesis, confined to SDK direct callers."""
    sys.path.insert(0, str(ROOT / 'research/vendor/analysis-python'))
    from capstone import Cs, CS_ARCH_X86, CS_MODE_64, CS_OP_IMM
    targets = {0x12D5780, 0x12D5830}
    nt=pe.u32(0x3c)
    exception_rva,exception_size=struct.unpack_from('<2I',pe.raw,nt+24+112+3*8)
    exception_offset=pe.offset(pe.base+exception_rva)
    functions = sorted(struct.unpack_from('<3I', pe.raw, exception_offset + off)[:2]
                       for off in range(0, exception_size, 12))
    starts = [begin for begin, _ in functions]
    decoder = Cs(CS_ARCH_X86, CS_MODE_64)
    decoder.detail = True
    callers = []
    for name, start, raw, size, _ in pe.sections:
        if name != '.text':
            continue
        data = pe.raw[raw:raw + size]
        for match in re.finditer(rb'[\xe8\xe9]', data):
            off = match.start()
            if off + 5 > len(data):
                continue
            address = start + off
            target = address + 5 + struct.unpack_from('<i', data, off + 1)[0]
            if target not in targets:
                continue
            index = bisect_right(starts, address) - 1
            if index < 0:
                continue
            begin, end = functions[index]
            if not begin <= address < end or end - begin > 65536:
                continue
            code = pe.raw[pe.offset(pe.base + begin):][:end - begin]
            instructions = list(decoder.disasm(code, pe.base + begin))
            hit = next((i for i, ins in enumerate(instructions) if ins.address - pe.base == address), None)
            if hit is None or not any(op.type == CS_OP_IMM and op.imm - pe.base == target
                                       for op in instructions[hit].operands):
                continue
            callers.append({'rva': hex(address), 'target': hex(target), 'functionStart': hex(begin), 'functionEnd': hex(end)})
            context = instructions[max(0, hit - 24):hit + 12]
            (out / f'sdk-caller-{address:x}.txt').write_text('\n'.join(
                f'{ins.address - pe.base:08x}  {ins.mnemonic} {ins.op_str}' for ins in context), encoding='utf8')
            if len(callers) >= 16:
                raise ValueError('Internal caller bound exceeded; narrow hypothesis instead of expanding scan')
    result = {'callers': callers, 'executedCallsObserved': False}
    save(out / 'internal-reset-callers.json', result)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--seconds', type=int, default=30)
    parser.add_argument('--internal-reset-only', action='store_true')
    args = parser.parse_args()
    if not 0 <= args.seconds <= 45:
        raise ValueError('Observation must be bounded to 45 seconds')
    identity()
    directory = lab_directory()
    pid = main_pid()
    reader = Reader(pid)
    out = ROOT / 'research/evidence' / f'bin-reset-{time.time_ns()}'
    out.mkdir()
    try:
        creator = next(m for m in reader.modules if m['name'].lower() == 'vecreator.dll')
        sdk = next(m for m in reader.modules if m['name'].lower() == 'videoeditor.dll')
        if Path(creator['path']).parent.name != '9.6.0.4097' or Path(sdk['path']).parent != Path(creator['path']).parent:
            raise ValueError('Unexpected active build')
        creator_pe, sdk_pe = PE(creator['path']), PE(sdk['path'])
        if hashlib.sha256(creator_pe.raw).hexdigest() != CREATOR_SHA or hashlib.sha256(sdk_pe.raw).hexdigest() != SDK_SHA:
            raise ValueError('Installed module hash changed')
        if args.internal_reset_only:
            routes = internal_reset_callers(sdk_pe, out)
            identity()
            print(json.dumps({'scenario': 'internalResetRoutes', 'decodedCallers': len(routes['callers']),
                              'evidence': str(out)}, ensure_ascii=True))
            return
        first_docs, first = catalog(directory)
        first['sdk'] = sdk_material(reader, creator)
        save(out / 'before.json', first)
        for name, document in first_docs.items():
            save(out / ('before-' + name), document)
        started = time.monotonic()
        routes = reset_callers(reader, creator, sdk, creator_pe, sdk_pe, out)
        remaining = args.seconds - (time.monotonic() - started)
        if remaining > 0:
            time.sleep(remaining)
        last_docs, last = catalog(directory)
        last['sdk'] = sdk_material(reader, creator)
        identity()
        save(out / 'after.json', last)
        for name, document in last_docs.items():
            save(out / ('after-' + name), document)
        compare = {'documentsEqual': {name: first_docs[name] == last_docs[name] for name in NAMES},
                   'ownedSavedMaterialEqual': first['material'] == last['material'],
                   'sdkMaterialEqual': first['sdk']['material'] == last['sdk']['material'],
                   'savedPath': last['material']['file_Path'], 'sdkPath': last['sdk']['material']['path'],
                   'savedPathExists': Path(last['material']['file_Path']).is_file(),
                   'pathsAgree': last['material']['file_Path'].replace('\\', '/').casefold()
                       == last['sdk']['material']['path'].replace('\\', '/').casefold()}
        save(out / 'comparison.json', compare)
        print(json.dumps({'scenario': 'readOnlyBaselineAndResetRoutes', 'pid': pid,
                          'documentsEqual': compare['documentsEqual'], 'pathsAgree': compare['pathsAgree'],
                          'sourceAvailable': compare['savedPathExists'],
                          'importSlots': sum(map(len, routes['slots'].values())),
                          'decodedCallers': sum(c['decoded'] for c in routes['callers']),
                          'evidence': str(out)}, ensure_ascii=True))
    except Exception as error:
        save(out / 'failure.json', {'error': str(error), 'type': type(error).__name__})
        raise
    finally:
        reader.close()


if __name__ == '__main__':
    main()
