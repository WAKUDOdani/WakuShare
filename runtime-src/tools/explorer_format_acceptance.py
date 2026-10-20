"""Repeatable fixture preparation and one-shot read-only CapCut format check.

Every dispatch has a durable preimage; no import, UI input or accepted-job replay.
"""
import argparse
import ctypes as C
import json
import shutil
import subprocess
import time
from pathlib import Path
from load_native_lab import ROOT, Loader, digest, identity, lab_directory, modules, snapshot, validate
from live_add import atomic, main_pid
from qt_meta_inventory import PE

FIXTURES=ROOT/'research/fixtures/AutoAddLab/FormatAcceptance-20261020'
RUN=ROOT/'artifacts/ExplorerFormatAcceptance-20261020'
DLL=ROOT/'artifacts/NativeExplorerObserveBuild/CapSync.ExplorerFormatReadV1.dll'
class Request(C.Structure):
    _fields_=[('size',C.c_uint32),('version',C.c_uint32),('input',C.c_wchar*1024),('output',C.c_wchar*1024)]

def prepare():
    if FIXTURES.exists() or RUN.exists():raise ValueError('Fixtures already prepared; never overwrite evidence')
    from PIL import Image
    FIXTURES.mkdir(parents=True);RUN.mkdir(parents=True)
    image=Image.new('RGB',(96,64),(40,180,120));generated=[];unavailable=[]
    for ext in ('png','jpg','jpeg','bmp','webp','tif','tiff','gif','ico','tga','ppm','pgm','pcx','avif'):
        path=FIXTURES/('format-probe.'+ext)
        try:
            (image.convert('L') if ext=='pgm' else image).save(path)
            generated.append(path)
        except (KeyError,OSError,ValueError) as error:unavailable.append({'extension':ext,'reason':str(error)})
    svg=FIXTURES/'format-probe.svg';svg.write_text('<svg xmlns="http://www.w3.org/2000/svg" width="96" height="64"><rect width="96" height="64" fill="#28b478"/></svg>',encoding='utf8');generated.append(svg)
    audio={'wav':['-c:a','pcm_s16le'],'mp3':['-c:a','libmp3lame'],'m4a':['-c:a','aac'],'aac':['-c:a','aac'],'flac':['-c:a','flac'],'ogg':['-c:a','libvorbis'],'opus':['-c:a','libopus'],'aiff':['-c:a','pcm_s16be'],'wma':['-c:a','wmav2']}
    video={'mp4':['-c:v','libx264','-pix_fmt','yuv420p'],'mov':['-c:v','libx264','-pix_fmt','yuv420p'],'m4v':['-c:v','libx264','-pix_fmt','yuv420p'],'mkv':['-c:v','libx264','-pix_fmt','yuv420p'],'avi':['-c:v','mpeg4'],'webm':['-c:v','libvpx-vp9'],'mpg':['-c:v','mpeg2video'],'mpeg':['-c:v','mpeg2video'],'ts':['-c:v','libx264','-pix_fmt','yuv420p'],'mts':['-c:v','libx264','-pix_fmt','yuv420p','-f','mpegts'],'wmv':['-c:v','wmv2'],'flv':['-c:v','flv'],'3gp':['-c:v','h263','-s','128x96']}
    for kind,formats in (('audio',audio),('video',video)):
        for ext,options in formats.items():
            target=FIXTURES/('format-probe.'+ext)
            command=['ffmpeg','-nostdin','-hide_banner','-loglevel','error','-n','-f','lavfi','-i',('sine=frequency=440:duration=0.4' if kind=='audio' else 'color=c=green:s=128x96:r=25:d=0.4'),*options,str(target)]
            result=subprocess.run(command,capture_output=True,timeout=20,creationflags=subprocess.CREATE_NO_WINDOW)
            if result.returncode:unavailable.append({'extension':ext,'reason':result.stderr.decode('utf8',errors='replace')})
            else:generated.append(target)
    atomic(RUN/'fixtures.json',{'root':str(FIXTURES),'files':[str(p) for p in generated],'unavailable':unavailable,'sha256':{p.name:digest(p) for p in generated}})
    print(json.dumps({'prepared':True,'fixtures':len(generated),'unavailable':unavailable}))

def read():
    marker=RUN/'journal.json'
    if marker.exists():raise ValueError('This one-shot read already has a journal; no automatic replay')
    fixtures=json.loads((RUN/'fixtures.json').read_text(encoding='utf8'))
    if any(digest(FIXTURES/name)!=sha for name,sha in fixtures['sha256'].items()):raise ValueError('Fixture changed')
    identity();pid=main_pid();loaded=validate(pid,build='9.6.0.4097')
    sdk=next(m for m in loaded if m['name'].casefold()=='videoeditor.dll')
    if digest(sdk['path'])!='47e341ce930074bd7d11ef418ea5c893fc6330aa73b2f2203c5098f302d63e9f':raise ValueError('SDK differs')
    snapshot(lab_directory(),RUN/'before')
    before={p.name:digest(p) for p in (RUN/'before').iterdir() if p.is_file()}
    sha=digest(DLL);staged=RUN/sha[:16]/DLL.name;staged.parent.mkdir()
    shutil.copyfile(DLL,staged)
    if any(m['name'].casefold()==DLL.name.casefold() for m in loaded):raise ValueError('Read module already loaded; do not replace it')
    export=next(e for e in PE(staged).exports() if e['name']=='CapSync_FormatReadThread');output=RUN/'format-read.json'
    atomic(marker,{'stage':'dispatchingRead','pid':pid,'binarySha256':sha,'projectMutation':False})
    loader=Loader(pid)
    try:
        if not loader.call(loader.library_entry(),(str(staged)+'\0').encode('utf-16le')):raise ValueError('Load failed')
        module=next(m for m in modules(pid) if Path(m['path']).resolve()==staged.resolve())
        request=Request(size=C.sizeof(Request),version=1,input=str(RUN/'fixtures.json'),output=str(output))
        if loader.call(module['base']+int(export['rva'],16),bytes(request))!=1:raise ValueError('Read rejected')
    finally:loader.close()
    deadline=time.monotonic()+20
    while not output.exists() and time.monotonic()<deadline:time.sleep(.05)
    if not output.exists():raise ValueError('Read completion unknown; do not replay')
    result=json.loads(output.read_text(encoding='utf8'));snapshot(lab_directory(),RUN/'immediate')
    immediate={p.name:digest(p) for p in (RUN/'immediate').iterdir() if p.is_file()}
    time.sleep(30);snapshot(lab_directory(),RUN/'saved')
    saved={p.name:digest(p) for p in (RUN/'saved').iterdir() if p.is_file()}
    accepted=result.get('status')=='read' and before==immediate==saved and result.get('projectMutation') is False
    atomic(marker,{'stage':'readAccepted' if accepted else 'conflict','accepted':accepted,'projectDocumentsUnchanged':before==immediate==saved,'projectMutation':False,'imports':0,'pid':pid,'binarySha256':sha})
    if not accepted:raise ValueError('Read or preservation failed; inspect evidence')
    print(json.dumps({'accepted':True,'suffixes':result['suffixes'],'files':[{ 'extension':Path(p['path']).suffix,'acceptedBySdk':p['acceptedBySdk']} for p in result['files']],'projectDocumentsUnchanged':True}))

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('action',choices=('prepare','read'));args=parser.parse_args()
    prepare() if args.action=='prepare' else read()
