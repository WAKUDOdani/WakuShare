"""Complete Draft equality across CapCut's project-relative path spelling.

Only path fields pointing to the same resource under this project may expand a
UUID placeholder. No content, identity, field or different target is ignored.
"""
from copy import deepcopy
from pathlib import PureWindowsPath
import re
import json

def same_draft(saved,live,directory):
    normalized=deepcopy(saved)
    # CapCut stores its own project resources with a UUID placeholder, including
    # nested compositions, matting and color-match caches. The live SDK expands
    # that prefix. Compare only equivalent paths under this exact project root;
    # do not ignore a field, a missing resource, arbitrary text or another root.
    placeholder=re.compile(r'^##_draftpath_placeholder_[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}_##[/\\](.+)$')
    def unique_object(pairs):
        result={}
        for key,value in pairs:
            if key in result:raise ValueError('Duplicate content key')
            result[key]=value
        return result
    def walk(left,right):
        if isinstance(left,dict) and isinstance(right,dict):
            for key,value in list(left.items()):
                other=right.get(key)
                if isinstance(value,str) and isinstance(other,str) and (key=='path' or key.endswith('_path')):
                    match=placeholder.fullmatch(value)
                    if match:
                        relative=match[1].replace('\\','/');parts=relative.split('/')
                        if any(part in ('','.','..') or ':' in part or '\0' in part for part in parts):continue
                        if '\0' in other or any(part in ('.','..') for part in other.replace('\\','/').split('/')):continue
                        expected=PureWindowsPath(str(directory)).joinpath(*parts)
                        actual=PureWindowsPath(other)
                        if actual.is_absolute() and actual==expected:left[key]=other
                elif key=='content' and isinstance(value,str) and isinstance(other,str) and value!=other:
                    # Text styles are JSON inside a string. Apply the same exact
                    # resource-path comparison to font.path, retaining every text,
                    # range, style and unknown field. Never treat arbitrary text
                    # as a project path or discard malformed/duplicate JSON keys.
                    try:
                        a=json.loads(value,object_pairs_hook=unique_object)
                        b=json.loads(other,object_pairs_hook=unique_object)
                        if isinstance(a,dict) and isinstance(b,dict) and isinstance(a.get('text'),str) and isinstance(a.get('styles'),list):
                            walk(a,b)
                            if a==b:left[key]=other
                    except (ValueError,TypeError):pass
                else:walk(value,other)
        elif isinstance(left,list) and isinstance(right,list):
            for a,b in zip(left,right):walk(a,b)
    walk(normalized,live)
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
