"""Identity-owned photo path plan. Pure planning: no editor or filesystem writes.

An unused bin card does not require a timeline source. Used sources must link
to the bin UUID, or have an explicit durable source link; names/hashes cannot
establish that link. Equal names in another directory are independent.
"""
from copy import deepcopy
from pathlib import Path
from live_add import canonical,parent_edges,require_folder,rows

FORMATS={'.png','.jpg','.jpeg'}
MEDIA_FORMATS={**dict.fromkeys(('.png','.jpg','.jpeg','.bmp','.webp','.tif','.tiff','.ico','.avif'),'photo'),
    '.gif':'gif',**dict.fromkeys(('.wav','.mp3','.m4a','.aac','.flac','.ogg','.opus','.wma'),'music'),
    **dict.fromkeys(('.mp4','.mov','.m4v','.mkv','.avi','.webm','.mpg','.mpeg','.ts','.mts','.wmv','.flv'),'video')}


class UnsupportedPhotoPlan(ValueError):
    """Valid ownership case whose native adapter is not implemented yet."""

def within(root,path):
    return Path(path).resolve().is_relative_to(Path(root).resolve())

def relative(value):
    normalized=value.replace('\\','/')
    if not normalized or ':' in normalized or normalized.startswith('/') or any(p in ('','.','..') for p in normalized.split('/')):
        raise ValueError('Invalid relative photo path')
    return normalized

def owned_folder(state,binding,relative_file,catalog):
    directory=Path(relative(relative_file)).parent.as_posix()
    if directory=='.':directory=''
    if not directory:
        require_folder(catalog,binding['MediaFolderId']);return binding['MediaFolderId']
    parent=binding['MediaFolderId'];require_folder(catalog,parent);prefix=''
    for part in directory.split('/'):
        prefix=prefix+'/'+part if prefix else part
        found=[f for f in state.get('ManagedFolders',[]) if f.get('Status')=='Completed' and
            f['Job']['BindingId']==binding['Id'] and f['Job']['RelativePath'].replace('\\','/').casefold()==prefix.casefold()]
        if len(found)!=1:raise ValueError('No unique completed folder ownership: '+prefix)
        job=found[0]['Job'];identifier=job['FolderId']
        if job['ProjectId']!=binding['ProjectId'] or canonical(job['RootPath'])!=canonical(binding['RootPath']) or job['ParentFolderId']!=parent:
            raise ValueError('Folder ownership differs: '+prefix)
        require_folder(catalog,identifier)
        if parent_edges(catalog,identifier)!=[{'child_id':identifier,'parent_id':parent}]:
            raise ValueError('Folder parent changed: '+prefix)
        parent=identifier
    return parent

def plan(job,state,catalog,observed_identity,source_links=(),linked_aliases=False,linked_alias_moves=False,media=False,preserve_labels=False,batch_sources=False):
    """Return a complete guarded photo plan, including an empty source list."""
    if job.get('Flags')!='Path':raise ValueError('Only an unchanged-content path operation is supported')
    binding=next((b for b in state['Bindings'] if b['Id']==job['BindingId']),None)
    transfer=job.get('DestinationBindingId') is not None
    destination=next((b for b in state['Bindings'] if b['Id']==job.get('DestinationBindingId')),None) if transfer else binding
    source=next((s for s in state['Sources'] if s['Id']==job['SourceId']),None)
    if not binding or not source or source['BindingId']!=binding['Id'] or \
       binding['ProjectId']!=job['ProjectId'] or binding['MediaFolderId']!=job['MediaFolderId'] or \
       canonical(binding['RootPath'])!=canonical(job['RootPath']) or source.get('MaterialId')!=job['MaterialId'] or \
       source.get('MaterialRemoved',False) or source['Version']!=job['SourceVersion'] or source['Presence']!='Present' or \
       source['Hash'].casefold()!=job['Hash'].casefold() or source['Size']!=job['Size'] or \
       (source.get('AppliedHash') or '').casefold()!=job['Hash'].casefold():
        raise ValueError('Photo source revision or binding ownership changed')
    if transfer and (not destination or destination['Id']==binding['Id'] or destination['ProjectId']!=job['ProjectId'] or
        canonical(destination['RootPath'])!=canonical(job['DestinationRootPath']) or destination['MediaFolderId']!=job['DestinationMediaFolderId'] or
        job.get('FileIdentity')!=observed_identity):
        raise ValueError('Photo transfer destination or physical identity changed')
    if not observed_identity or source.get('FileIdentity')!=observed_identity:
        raise ValueError('Physical file identity differs from the planned source')
    previous=relative(job['PreviousPath']);desired=relative(job['RelativePath'])
    if (source.get('AppliedPath') or '').replace('\\','/').casefold()!=previous.casefold() or \
       source['RelativePath'].replace('\\','/').casefold()!=(previous if transfer else desired).casefold():
        raise ValueError('Desired/applied source path changed')
    root=Path(binding['RootPath']);destination_root=Path(destination['RootPath']);old=root/previous;new=destination_root/desired
    if not within(root,old) or not within(destination_root,new) or canonical(new)!=canonical(job['SourcePath']) or canonical(old)==canonical(new):
        raise ValueError('Photo paths escaped binding or did not change')
    if old.suffix.lower() not in (MEDIA_FORMATS if media else FORMATS) or old.suffix.lower()!=new.suffix.lower():
        raise ValueError('Photo format conversion is not a path change')
    kind=MEDIA_FORMATS[old.suffix.lower()] if media else 'photo'
    source_group='audios' if kind=='music' else 'videos'
    name_field='name' if kind=='music' else 'material_name'
    linked=[];linked_bin=[];retired=[]
    for link in source_links:
        if all(link.get(k)==job.get(k) for k in ('ProjectId','BindingId','SourceId','MaterialId')):
            linked+=link.get('TimelineSourceIds',[])
            linked_bin+=link.get('BinAliasIds',[])
            retired+=link.get('ProvenRetiredMaterialIds',[])
    retired=sorted(set(retired)&set(source.get('RetiredMaterialIds',[])))
    if len(retired)>16 or any(row['id'] in retired for row in rows(catalog)):raise ValueError('A proven retired local material is still present or exceeds its bound')
    if len(set(linked))!=len(linked):raise ValueError('Duplicate explicit source link')
    material=job['MaterialId'];aliases=[r for r in rows(catalog) if r.get('file_Path') and canonical(r['file_Path'])==canonical(old)]
    cards=[r for r in aliases if r['id']==material]
    allowed={material,*linked,*linked_bin} if linked_aliases else {material}
    if not aliases or len(aliases)>16 or len({r['id'] for r in aliases})!=len(aliases) or len(cards)!=1 or any(r['id'] not in allowed or r.get('metetype')!=kind or r.get('type')!=0 for r in aliases):
        raise ValueError('Bin source ownership is shared, absent or not a photo')
    if any(r.get('file_Path') and canonical(r['file_Path'])==canonical(new) for r in rows(catalog)):
        raise ValueError('New path already belongs to a bin material')
    card=cards[0]
    for alias in aliases:
        if any(alias.get(k)!=card.get(k) for k in ('width','height')) or (not preserve_labels and alias.get('extra_info','').casefold()!=old.name.casefold()):
            raise UnsupportedPhotoPlan('Linked alias has different dimensions or a custom label')
    if not preserve_labels and card.get('extra_info')!=old.name:
        raise UnsupportedPhotoPlan('Custom label must be preserved by a separate stock-label adapter')
    old_folder=owned_folder(state,binding,previous,catalog)
    target=owned_folder(state,destination,desired,catalog)
    if parent_edges(catalog,material)!=[{'child_id':material,'parent_id':old_folder}]:
        raise ValueError('Owned card was moved independently in CapCut')
    moving=old_folder!=target
    if job.get('DestinationFolderId')!=(target if moving or transfer else None):
        raise ValueError('Job destination differs from the owned typed folder')
    if catalog['meta']['draft_id']!=job['ProjectId']:raise ValueError('Different project catalog')
    candidates=[]
    for group,items in catalog['timeline']['materials'].items():
        if not isinstance(items,list):continue
        for item in items:
            if isinstance(item,dict) and item.get('path') and canonical(item['path'])==canonical(old):
                source_types={'music','extract_music'} if kind=='music' else {'photo'} if kind=='photo' else {'video','gif'} if kind=='gif' else {'video'}
                if group!=source_group or item.get('type') not in source_types or not item.get('id'):
                    raise ValueError('Old photo path also belongs to a different source type')
                if item.get('type')=='extract_music' and item.get('local_material_id')!=material and item.get('local_material_id') not in retired:
                    raise UnsupportedPhotoPlan('Extracted audio requires its exact local bin identity before source setters')
                if item['id']!=material and item.get('local_material_id')!=material and item['id'] not in linked:
                    raise ValueError('Timeline source has no proven link to the owned bin UUID')
                candidates.append(item)
    ids=[s['id'] for s in candidates]
    if len(set(ids))!=len(ids) or (linked and set(linked)!=set(ids)):
        raise ValueError('Timeline source identities are duplicated or explicit links changed')
    if len(ids)>(16 if batch_sources else 1):raise UnsupportedPhotoPlan('Multiple independent timeline source objects exceed the enabled batch source adapter')
    if any(r['id']!=material and r['id'] not in ids and r['id'] not in linked_bin for r in aliases):raise ValueError('Alias lacks its exact linked timeline source')
    alias_rows=[r for r in aliases if r['id']!=material]
    if alias_rows and moving and not linked_alias_moves:raise UnsupportedPhotoPlan('Linked alias folder relocation needs a batch folder adapter')
    alias_edges={r['id']:deepcopy(parent_edges(catalog,r['id'])) for r in alias_rows}
    if any(len(edges)!=1 for edges in alias_edges.values()):raise ValueError('Linked alias parent is absent or ambiguous')
    used=any(s.get('material_id') in ids for t in catalog['timeline']['tracks'] for s in t['segments'])
    referenced={s.get('material_id') for t in catalog['timeline']['tracks'] for s in t['segments']}
    # The narrow SDK route resolves the source through an existing segment.
    # A detached material must not reach dispatch and become an unknown job.
    if ids and (not used or (batch_sources and any(identifier not in referenced for identifier in ids))):
        raise UnsupportedPhotoPlan('Detached timeline source requires a source-container adapter')
    result={'id':job['Id'],'materialId':material,'old':str(old),'new':str(new),
        'extension':old.suffix.lower(),'hash':job['Hash'],'fileIdentity':observed_identity,
        'relatedMaterialIds':[r['id'] for r in aliases],'linkedAliasRows':deepcopy(alias_rows),'linkedAliasEdges':alias_edges,'oldFolderId':old_folder,'destinationFolderId':target,'moving':moving,
        'sourceId':ids[0] if ids else None,'timelineSources':deepcopy(candidates),'usedOnTimeline':used,
        'newSourceName':(new.name if candidates[0].get(name_field)==old.name else candidates[0].get(name_field,'')) if candidates else None,
        'newBinName':new.name}
    if media:result.update(mediaKind=kind,sourceGroup=source_group,nameField=name_field)
    if batch_sources:
        result.update(sourceIds=ids,newSourceNames={s['id']:(new.name if s.get(name_field)==old.name else s.get(name_field,'')) for s in candidates})
    if retired:result['ownedRetiredMaterialIds']=retired
    if preserve_labels:
        labels={r['id']:(new.name if r.get('extra_info')==Path(r['file_Path']).name else r.get('extra_info','')) for r in aliases}
        result.update(newBinName=labels[material],newBinNames=labels)
    return result
