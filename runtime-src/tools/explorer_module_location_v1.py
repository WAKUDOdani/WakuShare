"""Reuse a byte-identical sealed product DLL already loaded before app upgrade."""
from pathlib import Path


def select_loaded(staged, loaded, expected_hash, digest, canonical, *, relocated=False):
    present = [m for m in loaded if m['name'].casefold() == staged.name.casefold()]
    if not present:
        return staged
    if len(present) != 1:
        raise ValueError('Ambiguous loaded product module')
    current = Path(present[0]['path'])
    if canonical(current) == canonical(staged):
        return staged
    if not relocated or not staged.name.startswith('CapSync.ExplorerProduct'):
        raise ValueError('Different sealed module location')
    if digest(staged) != expected_hash or digest(current) != expected_hash:
        raise ValueError('Relocated module bytes differ from sealed product generation')
    return current
