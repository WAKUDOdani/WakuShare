"""One stock unused-card removal, with full SDK preservation and no file delete."""
from copy import deepcopy
import json
from pathlib import Path
import time
from explorer_catalog_runtime_v2 import read as read_catalog
from explorer_media_lab import invoke
from explorer_native_runtime_v2 import Source,Lease,template_exact
from folder_view_repair import compare as graph_compare
from live_add import atomic,canonical,rows,parent_edges
from live_source_path import acceptance,SCOPES,PNG_MATERIAL
from live_update import source_referenced
from load_native_lab import ROOT,LAB_ID,digest,lab_directory,snapshot
from explorer_project_io_v2 import load_project as load
from explorer_native_compat import require_vendor_imports

DLL=ROOT/'artifacts/NativeExplorerObserveBuild/CapSync.ExplorerRemoveUnusedV3.dll'
MANIFEST=ROOT/'artifacts/ExplorerRemoveUnusedV3/manifest.json'

def prepare():
    require_vendor_imports(DLL)
    document={'build':'9.6.0.4097','labOnly':True,'binaries':{'Remove':digest(DLL)}}
    if MANIFEST.exists() and json.loads(MANIFEST.read_text(encoding='utf8'))!=document:raise ValueError('Sealed remover changed')
    MANIFEST.parent.mkdir(parents=True,exist_ok=True)
    if not MANIFEST.exists():atomic(MANIFEST,document)

def compare(before,after,job):
    expected=deepcopy(before);identifier=job['MaterialId']
    for group in expected['meta']['draft_materials']:group['value']=[r for r in group['value'] if r['id']!=identifier]
    for group in expected['store']['draft_virtual_store']:
        if group['type']==1:group['value']=[r for r in group['value'] if r['child_id']!=identifier]
    field='draft_timeline_materials_size_';previous=expected['meta'].get(field);current=after['meta'].get(field)
    accounting=None
    if isinstance(previous,int) and isinstance(current,int) and previous-current==job['Size']:
        accounting={'before':previous,'after':current,'removedSourceBytes':job['Size']};expected['meta'][field]=current
    result=graph_compare(expected,after)
    metadata=lambda value:{k:v for k,v in value['meta'].items() if k not in ('draft_materials','tm_draft_modified')}
    if metadata(expected)!=metadata(after):result['errors'].append('Other complete metadata changed')
    if any(r['id']==identifier for r in rows(after)) or parent_edges(after,identifier):result['errors'].append('Removed card UUID still exists')
    result.update(accepted=not result['errors'],removedMaterialId=identifier,removedByteAccounting=accounting)
    return result

def execute(data,case,require_missing=True,context=None):
    project_directory=context.directory if context else lab_directory()
    sdk_id=context.sdk_id if context else LAB_ID
    if context is None:prepare()
    job=data['job'];identifier=job['MaterialId'];editor=data['editor'];key=editor['Project']
    reply=lambda status,reason=None:{'JobId':job['Id'],'Status':status,'MaterialId':identifier if status=='Verified' else None,'Reason':reason,'NativeCommands':1 if (case/'evidence/remove.json').exists() else 0}
    if case.exists():return reply('Unknown','Removal already has a journal; never replay')
    if context is None and (job['ProjectId']!=key['Value'] or key['DraftId']!=LAB_ID.upper() or canonical(key['Location'])!=canonical(project_directory)):return reply('Conflict','Wrong laboratory session')
    root=Path(job['RootPath']).resolve();source=Path(job['SourcePath']).resolve()
    if not root.is_dir() or (context is None and not root.is_relative_to((ROOT/'research/fixtures/AutoAddLab').resolve())) or not source.is_relative_to(root):return reply('Waiting','Source root unavailable or outside laboratory')
    if require_missing and source.exists():return reply('Superseded','Source returned before deletion')
    if not require_missing and root.name!='RemovalChecks-20261020':return reply('Conflict','Manual removal simulation is fixture-only')
    catalog=read_catalog(data,context)
    if not catalog['Verified']:return reply('Waiting',catalog.get('Reason'))
    before=load(project_directory);selected=[r for r in rows(before) if r['id']==identifier];aliases=[r for r in rows(before) if r.get('file_Path') and canonical(r['file_Path'])==canonical(source)]
    if len(selected)!=1 or aliases!=selected:return reply('Conflict','Unused card ownership is absent or shared')
    if source_referenced(before['timeline'],source):return reply('Superseded','A used source and its clips must stay in CapCut')
    edges=parent_edges(before,identifier)
    if len(edges)!=1:return reply('Conflict','Unused card parent ambiguous')
    case.mkdir(parents=True);snapshot(project_directory,case/'before');record={'stage':'prepared','job':job,'requireMissing':require_missing};atomic(case/'journal.json',record)
    _,manifest=acceptance(SCOPES[PNG_MATERIAL]);exports=json.loads(manifest.read_text(encoding='utf8'))['exports']
    model=json.loads((ROOT/'artifacts/SdkModelProbe/1792059078966742900/model-report.json').read_text(encoding='utf8'))
    payload={'id':job['Id'],'projectId':sdk_id,'materialId':identifier,'expectedPath':selected[0]['file_Path'],'rootPath':str(root),'parentId':edges[0]['parent_id'],
        'metaPath':str(project_directory/'draft_meta_info.json'),'storePath':str(project_directory/'draft_virtual_store.json'),'baselineMeta':before['meta'],'baselineStore':before['store'],
        'baselineTimeline':before['timeline'],'exports':exports,'draftVtableRva':model['draftVtableRva'],'action':'remove','requireMissing':require_missing}
    atomic(case/'input.json',payload);record['stage']='dispatching';atomic(case/'journal.json',record)
    lease=Lease(processId=editor['ProcessId'],viewEpoch=editor['ViewEpoch'],location=key['Location'].replace('\\','/'),draftId=key['DraftId'].encode(),token=data['token'].encode())
    if context:receipt=context.invoke(editor['ProcessId'],'Remove','CapSync_SourcePath',Source(input=str(case/'input.json'),lease=lease),case/'evidence/remove.json')
    else:
        receipt=invoke(editor['ProcessId'],'Remove','CapSync_SourcePath',Source(input=str(case/'input.json'),lease=lease),case/'evidence/remove.json',manifest_path=MANIFEST,binaries={'Remove':DLL})
    required=('wholeSdkDraftExact','fullSdkBinPreserved','navigationUnchanged','foregroundUnchanged','focusUnchanged','cursorUnchanged')
    if receipt.get('status')!='dispatched' or not all(receipt.get(k) is True for k in required):
        record.update(stage='unknown',reason=receipt);atomic(case/'journal.json',record);return reply('Unknown','Stock removal is unconfirmed; no replay')
    snapshot(project_directory,case/'immediate');checked=compare(before,load(case/'immediate'),job);atomic(case/'immediate-comparison.json',checked)
    if not checked['accepted']:
        record.update(stage='conflict',reason=checked);atomic(case/'journal.json',record);return reply('Conflict','Immediate complete graph differs')
    record['stage']='verifyingSave';atomic(case/'journal.json',record);time.sleep(30)
    snapshot(project_directory,case/'saved');checked=compare(before,load(case/'saved'),job);atomic(case/'saved-comparison.json',checked)
    good=checked['accepted'] and template_exact(case/'before',case/'saved',before['timeline'])
    record.update(stage='savedVerified' if good else 'conflict',accepted=good);atomic(case/'journal.json',record)
    return reply('Verified' if good else 'Conflict',None if good else 'Saved complete graph differs')
