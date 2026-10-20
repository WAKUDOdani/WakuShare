"""Resolve each path once inside one short, source-locked batch process.

Never persisted across filesystem events or worker sessions. Identity ownership
still uses FILE_ID; this only avoids repeated path resolution for the same rows.
"""
from functools import lru_cache
from live_add import canonical as resolve_path
canonical=lru_cache(maxsize=65536)(resolve_path)
