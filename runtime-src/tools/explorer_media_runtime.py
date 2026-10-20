"""Explicit laboratory-only media generation, separate from accepted V2 pins."""
import json
from explorer_media_lab import invoke as dispatch
from explorer_native_compat import require_vendor_imports
from live_add import atomic
from load_native_lab import ROOT,digest

BUILD=ROOT/'artifacts/NativeExplorerObserveBuild'
BINARIES={
    'ImportMedia':BUILD/'CapSync.ExplorerRuntimeImportMediaV4.dll',
    'TreeMedia':BUILD/'CapSync.ExplorerRuntimeTreeMediaV3.dll',
    'BinMedia':BUILD/'CapSync.ExplorerRuntimeBinMediaV9.dll',
    'SourceMedia':BUILD/'CapSync.ExplorerRuntimeSourceMediaV6.dll'}
MANIFEST=ROOT/'artifacts/ExplorerMediaRuntimeV10/manifest.json'
LABELS_PRESERVED=True
BIN_PREFLIGHT=True
EXPLICIT_LABELS=True
ALIASES={'Import':'ImportMedia','TreeMove':'TreeMedia','TreeLinked':'TreeMedia','BinPath':'BinMedia','BinAliases':'BinMedia','SourceWindows':'SourceMedia'}

def prepare():
    for dll in BINARIES.values():require_vendor_imports(dll)
    value={'build':'9.6.0.4097','labOnly':True,'binaries':{name:digest(dll) for name,dll in BINARIES.items()}}
    if MANIFEST.exists() and json.loads(MANIFEST.read_text(encoding='utf8'))!=value:raise ValueError('Sealed media runtime changed')
    MANIFEST.parent.mkdir(parents=True,exist_ok=True)
    if not MANIFEST.exists():atomic(MANIFEST,value)

def invoke(pid,adapter,export,request,output):
    prepare();key=ALIASES[adapter]
    origin=ROOT/'artifacts'/('ExplorerSourceMediaV6' if key=='SourceMedia' else 'ExplorerBinMediaV9' if key=='BinMedia' else 'ExplorerMediaV3' if key=='TreeMedia' else 'ExplorerImportMediaV4')
    return dispatch(pid,key,export,request,output,manifest_path=MANIFEST,binaries=BINARIES,staging_root=origin)
