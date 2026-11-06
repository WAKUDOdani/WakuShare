"""Offline vendor-import validation; run before loading any new generation."""
from pathlib import Path
from qt_meta_inventory import PE

def missing_vendor_imports(dll, base=None):
    if base is None:
        from adaptive_context import current
        base=current()['directory']
    base=Path(base)
    image=PE(dll);nt=image.u32(0x3c);position=image.offset(image.base+image.u32(nt+24+120));missing=[]
    while any(image.raw[position:position+20]):
        name=image.cstring(image.offset(image.base+image.u32(position+12)));thunk=image.u32(position) or image.u32(position+16);position+=20
        if not name.lower().startswith('qt6'):continue
        available={e['name'] for e in PE(base/name).exports()};offset=image.offset(image.base+thunk)
        while True:
            value=image.u64(offset);offset+=8
            if not value:break
            if value>>63:continue
            function=image.cstring(image.offset(image.base+value)+2)
            if function not in available:missing.append({'library':name,'symbol':function})
    return missing

def require_vendor_imports(dll, base=None):
    missing=missing_vendor_imports(dll, base)
    if missing:
        from adaptive_context import current
        from adaptive_symbols import CapabilityError
        raise CapabilityError(current().get('operation','connect'),[item['library']+':'+item['symbol'] for item in missing],'vendor_import_unavailable')
