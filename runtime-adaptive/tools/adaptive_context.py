"""Per-helper verified editor identity and offline interface report."""
from pathlib import Path
from load_native_lab import modules, digest
from adaptive_symbols import discover, require, CapabilityError
_context=None
def bind(pid, operation='connect'):
    global _context
    loaded=modules(pid)
    selected={}
    for name in ('vecreator.dll','videoeditor.dll','qt6core.dll','capcut.exe'):
        found=[m for m in loaded if m['name'].casefold()==name]
        if len(found)!=1:raise CapabilityError(operation,[name],'module_unavailable')
        selected[name]=Path(found[0]['path']).resolve()
    directory=selected['capcut.exe'].parent
    if any(p.parent!=directory for p in selected.values()):raise CapabilityError(operation,['module.directory'],'module_identity_changed')
    if _context is None or _context['pid']!=pid or _context['directory']!=directory:
        report=discover(selected['vecreator.dll'],selected['videoeditor.dll'])
        _context={'pid':pid,'directory':directory,'report':report}
    require(_context['report'],operation)
    _context['operation']=operation
    return _context
def current():
    if _context is None:raise CapabilityError('connect',['editor.context'],'module_unavailable')
    return _context
def export(name):
    value=current()['report']['sdkExports'].get(name)
    if value is None:raise CapabilityError('rename',['sdk.'+name])
    return {'name':name,'rva':hex(value)}
