"""Private product entry point. Renderer never receives its session capability."""
import json
from pathlib import Path
import re
import sys
import uuid
from explorer_product_bridge_v5 import bootstrap,prepare_commands
from explorer_product_scope_v6 import ProductScope
from live_add import atomic


def run(data):
    # Check before planning, journaling or dispatching any mutation.
    if data['action'] not in ('prepare','bootstrap'):
        from adaptive_context import bind
        from adaptive_symbols import CapabilityError
        operation={'batch':'add','folders':'folders','delete':'remove','relocateRoot':'move'}.get(data['action'],'read')
        if data['action']=='execute':operation={'add':'add','restore':'restore','folder':'folders','update':'rename','transfer':'move'}.get(data['kind'],'read')
        bind(data['editor']['ProcessId'],operation)
        from explorer_product_bridge_v5 import preflight
        preflight(data,operation)
    if data['action']=='prepare':return prepare_commands()
    if data['action']=='bootstrap':return bootstrap(data)
    from explorer_saved_documents_v1 import bind
    bind(data)
    if data['action']=='relocateRoot':
        from explorer_root_relocation_v1 import execute
        return execute(data)
    if data['action']=='batch':
        from explorer_batch_import_v6 import execute
        return execute(data)
    if data['action']=='folders':
        from explorer_folder_batch_v2 import execute
        return execute(data)
    context=ProductScope(data)
    if data['action']=='execute':
        from explorer_import_completion_v1 import complete as complete_import
        complete_import(data,context)
        from explorer_root_relocation_v1 import relocated_folder
        restored=relocated_folder(data,context)
        if restored is not None:return restored
        from explorer_folder_completion_v1 import complete
        complete(data,context)
        from explorer_native_runtime_v4 import execute
        return execute(data,context)
    from explorer_catalog_runtime_v6 import read,presence
    if data['action']=='catalog':result=read(data,context)
    elif data['action']=='presence':result=presence(data,context)
    elif data['action']=='delete':
        from explorer_remove_runtime_v6 import execute
        result=execute(data,context.private/'native-removals'/str(uuid.UUID(data['job']['Id'])),context=context)
    else:raise ValueError('Unknown product action')
    result.pop('Materials',None);result.pop('LiveSourceNames',None)
    return result


if __name__=='__main__':
    data=None
    try:
        data=json.loads(sys.stdin.read(33554433).lstrip('\ufeff'))
        result=run(data)
        if data.get('statePath') and data.get('editor',{}).get('Project'):
            key=data['editor']['Project']['Value']
            if re.fullmatch(r'project-v1-[a-f0-9]{64}',key):
                marker=Path(data['statePath']).resolve().parent/('media-view-'+key+'.json')
                if marker.exists():
                    reason=json.loads(marker.read_bytes()).get('reason') or 'AUTOSYNC|view|view_deferred|refresh pending'
                    result['Warnings']=[reason]
        print(json.dumps(result))
    except Exception as error:
        # Detailed errors stay private and cannot expose the pipe capability.
        if data and (data.get('statePath') or data.get('evidence')):
            private=(Path(data['statePath']).resolve().parent if data.get('statePath') else Path(data['evidence']).resolve())/'adapter-errors';private.mkdir(parents=True,exist_ok=True)
            atomic(private/(uuid.uuid4().hex+'.json'),{'type':type(error).__name__,'reason':re.sub(r'[a-fA-F0-9]{64}','<redacted>',str(error))})
        from adaptive_symbols import CapabilityError
        if isinstance(error,CapabilityError):
            print(json.dumps({'error':str(error),'completionUnknown':False,'operation':error.operation,'code':error.code,'missing':error.missing}))
        else:
            reason=str(error) if str(error).startswith('AUTOSYNC|') and len(str(error))<=8192 else 'AUTOSYNC|native|adapter_failed|'+type(error).__name__+': '+re.sub(r'[a-fA-F0-9]{64}','<redacted>',str(error))[:2048]
            print(json.dumps({'error':reason,'completionUnknown':True}))
        sys.exit(1)
