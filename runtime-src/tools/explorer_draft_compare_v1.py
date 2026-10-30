"""Exact Draft comparison with CapCut's saved audio-cache path spelling.

Only vocal-beautify production paths under this project's Resources/audioAlg
can use the stock UUID placeholder. No other field or missing file is ignored.
"""
from copy import deepcopy
from pathlib import Path
import re

PLACEHOLDER=re.compile(r'^##_draftpath_placeholder_[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}_##/(Resources/audioAlg/[^:]+)$')

def same_draft(saved,live,directory):
    normalized=deepcopy(saved)
    for row in normalized.get('materials',{}).get('vocal_beautifys',[]):
        path=row.get('production_path')
        if not isinstance(path,str):continue
        match=PLACEHOLDER.fullmatch(path)
        if not match:continue
        relative=match[1]
        if '\\' in relative or any(part in ('','.','..') for part in relative.split('/')):continue
        row['production_path']=str(Path(directory)/relative).replace('\\','/')
    return normalized==live

def unique_source_ids(draft):
    sources={}
    for group in ('videos','audios'):
        for row in draft.get('materials',{}).get(group,[]):
            identifier=row['id']
            if not identifier:raise ValueError('Empty SDK source identity')
            complete=(group,row)
            if identifier in sources and sources[identifier]!=complete:
                raise ValueError('Conflicting duplicate SDK source identity')
            sources[identifier]=complete
    return list(sources)
