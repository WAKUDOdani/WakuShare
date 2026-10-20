"""Offline vendor-import validation; run before loading any new generation."""
from pathlib import Path
from qt_meta_inventory import PE

def missing_vendor_imports(dll):
    base=Path.home()/'AppData/Local/CapCut/Apps/9.6.0.4097'
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

def require_vendor_imports(dll):
    missing=missing_vendor_imports(dll)
    if missing:raise ValueError('New adapter vendor imports differ: '+repr(missing))
