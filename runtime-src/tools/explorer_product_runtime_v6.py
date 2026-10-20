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
    if data['action']=='prepare':return prepare_commands()
    if data['action']=='bootstrap':return bootstrap(data)
    if data['action']=='batch':
        from explorer_batch_import_v6 import execute
        return execute(data)
    if data['action']=='folders':
        from explorer_folder_batch_v2 import execute
        return execute(data)
    context=ProductScope(data)
    if data['action']=='execute':
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
        print(json.dumps(run(data)))
    except Exception as error:
        # Detailed errors stay private and cannot expose the pipe capability.
        if data and data.get('statePath'):
            private=Path(data['statePath']).resolve().parent/'adapter-errors';private.mkdir(parents=True,exist_ok=True)
            atomic(private/(uuid.uuid4().hex+'.json'),{'type':type(error).__name__,'reason':re.sub(r'[a-fA-F0-9]{64}','<redacted>',str(error))})
        print(json.dumps({'error':'Product adapter stopped; inspect private evidence; never replay an uncertain command'}))
        sys.exit(1)
