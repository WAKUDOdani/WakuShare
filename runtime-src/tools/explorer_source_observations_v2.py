"""Learn new SDK sources only across a locked, unchanged physical-file interval.

A first sighting at an old pathname is insufficient. A source with an unrelated
UUID is accepted only after an earlier complete SDK read proved it absent while
the exact owned file was already there, with an unchanged NTFS continuity stamp.
Existing unidentified sources remain unidentified. No editor mutations occur.
"""
from pathlib import Path
import json
from live_add import atomic,canonical
from photo_path_plan import MEDIA_FORMATS
from explorer_file_stamp import same_interval

LIMIT=32*1024*1024


def load(private,name,empty):
    path=Path(private)/name
    if not path.exists():return empty
    if path.stat().st_size>LIMIT:raise ValueError('Source ownership observations exceed their bound')
    return json.loads(path.read_text(encoding='utf8'))


def observe(private,state,project_key,materials,live,all_sdk_ids,stamps,evidence):
    if not evidence or len(live)>16384 or len({row['id'] for row in live})!=len(live) or len(all_sdk_ids)>16384 or len(set(all_sdk_ids))!=len(all_sdk_ids):
        raise ValueError('A complete unique live SDK snapshot is required')
    links=load(private,'source-links.json',[])
    from explorer_source_history_v2 import carry
    links=carry(private,state,project_key,links)
    observations=load(private,'source-observations.json',{'schema':1,'items':[]})
    if not isinstance(links,list) or len(links)>16384 or observations.get('schema')!=1 or len(observations.get('items',[]))>16384:
        raise ValueError('Invalid source ownership observations')
    previous=json.dumps(links,sort_keys=True);old_observations=json.dumps(observations,sort_keys=True)
    bindings={b['Id']:b for b in state['Bindings'] if b['ProjectId']==project_key and b['Status']=='Ready'}
    owners=[s for s in state['Sources'] if s['BindingId'] in bindings and s.get('MaterialId') and not s.get('MaterialRemoved') and s.get('AppliedPath') and s.get('FileIdentity') and s['Presence']=='Present' and s['RelativePath']==s['AppliedPath']]
    rows={row['id']:row for row in materials};all_ids=set(all_sdk_ids);created=[];blocked=[]
    if not {row['id'] for row in live}<=all_ids:raise ValueError('SDK source identities are incomplete')
    for source in owners:
        physical=source['FileIdentity'];current=stamps.get(source['Id'])
        if not current or current['file']['fileIdentity']!=physical or sum(s['FileIdentity']==physical for s in owners)!=1:continue
        path=Path(bindings[source['BindingId']]['RootPath'])/source['AppliedPath'];primary=rows.get(source['MaterialId'])
        if not primary or canonical(primary.get('file_Path',''))!=canonical(path):continue
        kind=MEDIA_FORMATS.get(path.suffix.lower())
        if kind!=primary.get('metetype'):continue
        scope={'ProjectId':project_key,'BindingId':source['BindingId'],'SourceId':source['Id'],'MaterialId':source['MaterialId'],'FileIdentity':physical}
        matches=lambda item:all(item.get(k)==v for k,v in scope.items())
        known=[item for item in links if matches(item)]
        baselines=[item for item in observations['items'] if matches(item)]
        if len(known)>1 or len(baselines)>1:raise ValueError('Duplicate physical source ownership record')
        link=known[0] if known else {**scope,'TimelineSourceIds':[],'BinAliasIds':[]}
        if len(link.get('TimelineSourceIds',[]))>16 or len(set(link.get('TimelineSourceIds',[])))!=len(link.get('TimelineSourceIds',[])):
            raise ValueError('Invalid proven source identities')
        candidates=[row for row in live if canonical(row['path'])==canonical(path)]
        group='audios' if kind=='music' else 'videos';types={'music','extract_music'} if kind=='music' else {'photo'} if kind=='photo' else {'video','gif'} if kind=='gif' else {'video'}
        if any(row['group']!=group or row['type'] not in types for row in candidates):
            blocked.append({'SourceId':source['Id'],'reason':'Different live source type'});continue
        existing=set(link['TimelineSourceIds']);proven=set(existing);unknown=[];added=False
        baseline=baselines[0] if baselines else None
        for row in candidates:
            identifier=row['id']
            direct=identifier==source['MaterialId'] or row.get('localMaterialId')==source['MaterialId']
            alias=rows.get(identifier)
            continuous=baseline and same_interval(baseline['stamp'],current) and canonical(baseline['path'])==canonical(path) and identifier not in baseline['allSourceIds']
            # Some stock timeline insertions create NLE objects without a bin
            # shadow row. The locked physical interval proves those objects too;
            # any existing same-UUID shadow must agree rather than be ignored.
            alias_matches=not alias or (alias.get('type')==0 and alias.get('metetype')==kind and canonical(alias.get('file_Path',''))==canonical(path))
            if (identifier in existing or direct or continuous) and alias_matches:
                proven.add(identifier)
                if identifier not in existing:
                    added=True;created.append({'SourceId':source['Id'],'TimelineSourceId':identifier,'proof':'direct-sdk-link' if direct else 'unchanged-physical-interval','evidence':evidence})
            else:unknown.append(identifier)
        if len(proven)>16:raise ValueError('Physical source SDK identities exceed the batch bound')
        # An SDK source removed by CapCut is never recreated. Keep a surviving
        # already proven bin alias separate from the actual source collection.
        retired=existing-all_ids;aliases=set(link.get('BinAliasIds',[]))
        for identifier in retired:
            alias=rows.get(identifier)
            if alias and alias.get('metetype')==kind and canonical(alias.get('file_Path',''))==canonical(path):aliases.add(identifier)
        aliases={identifier for identifier in aliases if identifier in rows and canonical(rows[identifier].get('file_Path',''))==canonical(path)}
        link.update(TimelineSourceIds=sorted(proven&all_ids),BinAliasIds=sorted(aliases-(proven&all_ids)))
        if added or retired:link['LastObservationEvidence']=evidence
        if link['TimelineSourceIds'] or link['BinAliasIds']:
            if not known:links.append(link)
        if unknown:
            blocked.append({'SourceId':source['Id'],'reason':'No unchanged physical interval before SDK source creation','ids':unknown})
            continue
        observation={**scope,'path':str(path),'stamp':current,'allSourceIds':sorted(all_ids),'evidence':evidence}
        observations['items']=[item for item in observations['items'] if not matches(item)]+[observation]
    if len(links)>16384 or len(observations['items'])>16384:raise ValueError('Source ownership observation count exceeded')
    if json.dumps(links,sort_keys=True)!=previous:
        if len(json.dumps(links).encode('utf8'))>LIMIT:raise ValueError('Source links exceed their write bound')
        atomic(Path(private)/'source-links.json',links)
    if json.dumps(observations,sort_keys=True)!=old_observations:
        if len(json.dumps(observations).encode('utf8'))>LIMIT:raise ValueError('Source observations exceed their write bound')
        atomic(Path(private)/'source-observations.json',observations)
    return {'created':created,'blocked':blocked,'editorMutations':0}
