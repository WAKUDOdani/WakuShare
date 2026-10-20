"""Carry proven NLE links through completed, fully verified ownership changes.

Neither a new binding nor a replacement bin UUID is inferred from its pathname.
Every edge requires the Core completion and matching native immediate/save
receipts for this project, logical source and unchanged physical FILE_ID.
"""
from copy import deepcopy
import json
from pathlib import Path
from live_add import atomic,canonical


def read(path):
    if path.stat().st_size>1024*1024:raise ValueError('Ownership receipt exceeds its bound')
    return json.loads(path.read_text(encoding='utf8'))


def same_job(left,right):
    if set(left)!=set(right):return False
    paths={'RootPath','DestinationRootPath','ProjectDirectory','SourcePath'}
    return all(canonical(left[k])==canonical(right[k]) if k in paths else left[k]==right[k] for k in left)


def verified(private,job,kind,material):
    case=Path(private)/'native-journal'/job['Id']
    try:
        record=read(case/'journal.json')
        return record.get('stage')=='Verified' and record.get('kind')==kind and record.get('materialId')==material and same_job(record['job'],job) and all(read(case/name).get('accepted') is True for name in ('immediate-comparison.json','saved-comparison.json'))
    except FileNotFoundError:return False


def carry(private,state,project_key,links):
    result=deepcopy(links);bindings={b['Id']:b for b in state['Bindings'] if b['ProjectId']==project_key};changed=False
    for link in result:
        if link.get('ProjectId')!=project_key or not link.get('FileIdentity'):continue
        sources=[s for s in state['Sources'] if s['Id']==link['SourceId'] and s['BindingId'] in bindings and s.get('FileIdentity')==link['FileIdentity'] and s.get('MaterialId') and not s.get('MaterialRemoved')]
        if len(sources)!=1:continue
        source=sources[0];start=(link['BindingId'],link['MaterialId']);goal=(source['BindingId'],source['MaterialId'])
        if start==goal:continue
        edges=[]
        for attempt in state.get('TransferAttempts',[]):
            job=attempt['Job']
            if attempt['Status']!='Completed' or job['ProjectId']!=project_key or job['SourceId']!=source['Id'] or job['FileIdentity']!=source['FileIdentity'] or job['SourceVersion']>=source['Version']:continue
            if verified(private,job,'transfer',job['MaterialId']):edges.append(((job['BindingId'],job['MaterialId']),(job['DestinationBindingId'],job['MaterialId']),job['Id'],None))
        for attempt in state.get('RestoreAttempts',[]):
            job=attempt['Job']['Import'];previous=attempt['Job']['PreviousMaterialId'];material=attempt.get('MaterialId')
            if attempt['Status']!='Completed' or job['ProjectId']!=project_key or job['SourceId']!=source['Id'] or job.get('FileIdentity')!=source['FileIdentity'] or job['SourceVersion']>=source['Version'] or previous not in source.get('RetiredMaterialIds',[]) or not material:continue
            if verified(private,job,'restore',material):edges.append(((job['BindingId'],previous),(job['BindingId'],material),job['Id'],previous))
        if len(edges)>64:raise ValueError('Ownership history edge bound exceeded')
        queue=[(start,[])];visited={start};route=None
        while queue:
            current,chain=queue.pop(0)
            for edge in edges:
                if edge[0]!=current or edge[1] in visited:continue
                candidate=chain+[edge]
                if len(candidate)>32:raise ValueError('Ownership history route bound exceeded')
                if edge[1]==goal:route=candidate;break
                visited.add(edge[1]);queue.append((edge[1],candidate))
            if route is not None:break
        if route is None:continue # A same-named new card is never enough.
        history=list(link.get('OwnershipHistory',[]))
        for old,new,job_id,retired in route:history.append({'BindingId':old[0],'MaterialId':old[1],'DestinationBindingId':new[0],'DestinationMaterialId':new[1],'VerifiedJobId':job_id})
        if len(history)>32:raise ValueError('Proven source ownership history is full')
        proven=set(link.get('ProvenRetiredMaterialIds',[]))|{edge[3] for edge in route if edge[3]}
        link.update(BindingId=goal[0],MaterialId=goal[1],OwnershipHistory=history,ProvenRetiredMaterialIds=sorted(proven));changed=True
    keys=[(l['ProjectId'],l['BindingId'],l['SourceId'],l['MaterialId']) for l in result]
    if len(keys)!=len(set(keys)):raise ValueError('Ownership history would merge independent source-link records')
    if changed:
        if len(json.dumps(result).encode('utf8'))>32*1024*1024:raise ValueError('Source links exceed their write bound')
        atomic(Path(private)/'source-links.json',result)
    return result
