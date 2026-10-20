"""Durable display-name observations of already owned physical sources.

CapCut can reset a title while handling a Windows rename before the synchronizer
gets its filesystem event. Capture only while the original physical file is
still present; never learn a replacement's label from its reused pathname.
"""
import json
from pathlib import Path
from live_add import atomic,rows
from explorer_canonical_cache_v1 import canonical
from live_update import StableFile
from explorer_project_observations_v1 import read as read_project,write as write_project

def document(private,project):
    value=read_project(private,project,'bin-label-observations.json',{'schema':1,'items':[],'sourceNames':[]})
    if value.get('schema')!=1 or not isinstance(value.get('items'),list) or len(value['items'])>16384:raise ValueError('Invalid display-name observations')
    keys=set()
    for item in value['items']:
        key=(item['projectKey'],item['sourceId'],item['materialId'])
        if key in keys or not isinstance(item['label'],str) or len(item['label'])>4096:raise ValueError('Duplicate or invalid display-name observation')
        keys.add(key)
    names=value.get('sourceNames',[])
    if not isinstance(names,list) or len(names)>16384:raise ValueError('Invalid source-name observations')
    keys=set()
    for item in names:
        key=(item['projectKey'],item['sourceId'],item['timelineSourceId'])
        if key in keys or not isinstance(item['name'],str) or not item['name'] or len(item['name'])>4096 or (item['group'],item['field']) not in (('videos','material_name'),('audios','name')):raise ValueError('Duplicate or invalid source-name observation')
        keys.add(key)
    value['sourceNames']=names;return value

def read(private,project):return document(private,project)['items']

def observe(private,state,project_key,materials,live_source_names=()):
    value=document(private,project_key);items=value['items'];original=list(items);names=value['sourceNames'];old_names=list(names)
    links=read_project(private,project_key,'source-links.json',[])
    bindings={b['Id']:b for b in state['Bindings'] if b['ProjectId']==project_key and b['Status']=='Ready'}
    owners=[s for s in state['Sources'] if s['BindingId'] in bindings and s.get('MaterialId') and not s.get('MaterialRemoved') and s.get('AppliedPath') and s.get('FileIdentity')]
    for source in owners:
        if source['Presence']!='Present' or source['RelativePath']!=source['AppliedPath']:continue
        path=Path(bindings[source['BindingId']]['RootPath'])/source['AppliedPath']
        try:
            stable=StableFile(path)
            try:physical=stable.identity()
            finally:stable.close()
        except (OSError,ValueError):continue
        if physical!=source['FileIdentity'] or sum(s['FileIdentity']==physical for s in owners)!=1:continue
        primary=next((r for r in materials if r['id']==source['MaterialId']),None)
        if not primary or canonical(primary.get('file_Path',''))!=canonical(path):continue
        linked={identifier for link in links if link.get('ProjectId')==project_key and link.get('BindingId')==source['BindingId'] and link.get('SourceId')==source['Id'] and link.get('MaterialId')==source['MaterialId'] and link.get('FileIdentity')==physical for identifier in link.get('TimelineSourceIds',[])}
        for live in live_source_names:
            if not live.get('name') or canonical(live['path'])!=canonical(path) or (live['id'] not in linked and live['id']!=source['MaterialId'] and live.get('localMaterialId')!=source['MaterialId']):continue
            key=(project_key,source['Id'],live['id']);names=[n for n in names if (n['projectKey'],n['sourceId'],n['timelineSourceId'])!=key]
            names.append({'projectKey':project_key,'sourceId':source['Id'],'timelineSourceId':live['id'],'fileIdentity':physical,'path':str(path),'name':live['name'],'group':live['group'],'field':live['field']})
        for row in materials:
            if not row.get('file_Path') or canonical(row['file_Path'])!=canonical(path) or row.get('metetype')!=primary.get('metetype') or row.get('type')!=primary.get('type'):continue
            if any(s['Id']!=source['Id'] and s['MaterialId']==row['id'] for s in owners):continue
            label=row.get('extra_info')
            if not isinstance(label,str) or not label or len(label)>4096:continue
            key=(project_key,source['Id'],row['id'])
            items=[i for i in items if (i['projectKey'],i['sourceId'],i['materialId'])!=key]
            items.append({'projectKey':project_key,'sourceId':source['Id'],'materialId':row['id'],'fileIdentity':physical,'path':str(path),'label':label})
    if sorted(items,key=lambda i:(i['projectKey'],i['sourceId'],i['materialId']))!=sorted(original,key=lambda i:(i['projectKey'],i['sourceId'],i['materialId'])) or sorted(names,key=lambda i:(i['projectKey'],i['sourceId'],i['timelineSourceId']))!=sorted(old_names,key=lambda i:(i['projectKey'],i['sourceId'],i['timelineSourceId'])):
        if len(items)>16384 or len(names)>16384:raise ValueError('Display-name observation limit reached')
        write_project(private,project_key,'bin-label-observations.json',{'schema':1,'items':items,'sourceNames':names})

def apply(private,job,plan,catalog):
    labels=dict(plan['newBinNames']);known=read(private,job['ProjectId']);restored=[]
    for row in rows(catalog):
        if row['id'] not in labels:continue
        observations=[i for i in known if i['projectKey']==job['ProjectId'] and i['sourceId']==job['SourceId'] and i['materialId']==row['id'] and i['fileIdentity']==plan['fileIdentity'] and canonical(i['path'])==canonical(plan['old'])]
        if len(observations)!=1:continue
        old=observations[0]
        ordinary=Path(row['file_Path']).name
        # A newer explicit custom title in the SDK wins over the observation.
        if old['label']!=Path(old['path']).name and row.get('extra_info')==ordinary:
            labels[row['id']]=old['label'];restored.append(row['id'])
    plan.update(newBinNames=labels,newBinName=labels[plan['materialId']],titlesRecoveredFromPhysicalObservation=restored)
    recovered=[];observed_names=document(private,job['ProjectId'])['sourceNames']
    for original in plan.get('timelineSources',[]):
        identifier=original.get('id',plan.get('sourceId'))
        source_names=[n for n in observed_names if n['projectKey']==job['ProjectId'] and n['sourceId']==job['SourceId'] and n['timelineSourceId']==identifier and n['fileIdentity']==plan['fileIdentity'] and canonical(n['path'])==canonical(plan['old']) and n['group']==plan['sourceGroup'] and n['field']==plan['nameField']]
        current=original.get(plan['nameField'],'')
        if len(source_names)==1 and current in ('',Path(plan['old']).name):
            old_name=source_names[0]['name'];desired=Path(plan['new']).name if old_name==Path(plan['old']).name else old_name
            if 'newSourceNames' in plan:plan['newSourceNames'][identifier]=desired
            if identifier==plan['sourceId']:plan['newSourceName']=desired
            recovered.append(identifier)
    if recovered:plan.update(sourceNameRecoveredFromPhysicalObservation=True,sourceNamesRecoveredFromPhysicalObservation=recovered)
    return plan
