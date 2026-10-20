"""Bounded private observations per project, never CapCut documents."""
import hashlib,json,os,uuid
from pathlib import Path

LIMIT=32*1024*1024
NAMES={'source-observations.json','source-links.json','bin-label-observations.json'}

def file(private,project,name):
    if name not in NAMES or not isinstance(project,str) or not project or len(project)>8192:raise ValueError('Invalid observation scope')
    return Path(private)/'project-observations'/hashlib.sha256(project.encode('utf8')).hexdigest()/name

def validate(project,name,value):
    if name=='source-links.json':groups=[value];field='ProjectId'
    else:
        if not isinstance(value,dict) or value.get('schema')!=1:raise ValueError('Invalid project observations')
        groups=[value.get('items')];field='ProjectId' if name=='source-observations.json' else 'projectKey'
        if name=='bin-label-observations.json':groups.append(value.get('sourceNames',[]))
    for items in groups:
        if not isinstance(items,list) or len(items)>16384 or any(not isinstance(i,dict) or i.get(field)!=project for i in items):raise ValueError('Observation escaped its project or exceeded its count bound')

def read(private,project,name,empty):
    path=file(private,project,name)
    if not path.exists():
        if any((Path(private)/n).exists() for n in NAMES) and not (Path(private)/'project-observations/migration.json').exists():raise ValueError('Observation migration required before starting the worker')
        return empty
    if path.stat().st_size>LIMIT:raise ValueError('Project observations exceed their byte bound')
    wrapper=json.loads(path.read_bytes())
    if wrapper.get('schema')!=1 or wrapper.get('projectKey')!=project:raise ValueError('Observation project identity differs')
    value=wrapper['value'];validate(project,name,value);return value

def write(private,project,name,value):
    validate(project,name,value)
    data=json.dumps({'schema':1,'projectKey':project,'value':value},ensure_ascii=False,separators=(',',':')).encode('utf8')
    if len(data)>LIMIT:raise ValueError('Project observations exceed their write bound')
    path=file(private,project,name);path.parent.mkdir(parents=True,exist_ok=True);temporary=path.with_suffix('.'+uuid.uuid4().hex+'.tmp')
    try:
        with temporary.open('xb') as output:output.write(data);output.flush();os.fsync(output.fileno())
        os.replace(temporary,path)
    finally:
        if temporary.exists():temporary.unlink()
