"""Read-only PE64/Qt 6.2 metadata inventory; never loads or modifies the image.

Layout reference: qt/qtbase tag v6.2.2, qobjectdefs.h, qmetaobject.h,
qmetaobject_p.h. This is a build-specific research tool, not a callable API.
"""
import argparse
import hashlib
import json
import re
import struct
from pathlib import Path


class PE:
    def __init__(self, path):
        self.path = Path(path)
        self.raw = self.path.read_bytes()
        nt = self.u32(0x3c)
        if self.raw[nt:nt+4] != b'PE\0\0':
            raise ValueError('Not a PE image')
        opt = nt + 24
        if self.u16(opt) != 0x20b:
            raise ValueError('Requires PE64')
        self.base = self.u64(opt + 24)
        self.sections = []
        section_start = opt + self.u16(nt + 20)
        for n in range(self.u16(nt + 6)):
            p = section_start + n * 40
            name = self.raw[p:p+8].rstrip(b'\0').decode('ascii')
            virtual_size, rva, size, offset = struct.unpack_from('<4I', self.raw, p+8)
            self.sections.append((name, rva, offset, size, virtual_size))
        self.export_rva = self.u32(opt + 112)

    def u16(self, p): return struct.unpack_from('<H', self.raw, p)[0]
    def u32(self, p): return struct.unpack_from('<I', self.raw, p)[0]
    def u64(self, p): return struct.unpack_from('<Q', self.raw, p)[0]

    def offset(self, va):
        rva = va - self.base
        for _, start, offset, size, _ in self.sections:
            if start <= rva < start + size:
                return offset + rva - start
        raise ValueError('Address outside file-backed sections')

    def va(self, offset):
        for _, start, raw, size, _ in self.sections:
            if raw <= offset < raw + size:
                return self.base + start + offset - raw
        raise ValueError('Offset outside sections')

    def cstring(self, p):
        end = self.raw.index(0, p, p+4096)
        return self.raw[p:end].decode('utf8')

    def exports(self):
        if not self.export_rva: return []
        p = self.offset(self.base + self.export_rva)
        count = self.u32(p + 24)
        names = self.offset(self.base + self.u32(p + 32))
        ordinals = self.offset(self.base + self.u32(p + 36))
        functions = self.offset(self.base + self.u32(p + 28))
        return [{'name': self.cstring(self.offset(self.base+self.u32(names+i*4))),
                 'rva': hex(self.u32(functions+self.u16(ordinals+i*2)*4))}
                for i in range(count)]

    def metadata(self, string_start, meta_start):
        data_start = self.offset(self.u64(meta_start+16))
        header = struct.unpack_from('<14I', self.raw, data_start)
        revision, class_name, _, _, methods, method_start, props, prop_start = header[:8]
        if revision != 10 or methods > 2000 or props > 2000:
            raise ValueError('Unsupported or invalid metadata')
        first_offset = self.u32(string_start)
        if first_offset % 8 or not 8 <= first_offset <= 65536:
            raise ValueError('Invalid string descriptor table')
        count = first_offset // 8

        def string(index):
            if index >= count: raise ValueError('Invalid string index')
            off, length = struct.unpack_from('<II', self.raw, string_start+index*8)
            if off < first_offset or off + length > 200000 or self.raw[string_start+off+length] != 0:
                raise ValueError('Invalid metadata string')
            return self.raw[string_start+off:string_start+off+length].decode('utf8')

        builtin = {0:'unknown', 1:'bool', 2:'int', 3:'uint', 4:'qlonglong', 5:'qulonglong',
                   6:'double', 8:'QVariantMap', 9:'QVariantList', 10:'QString', 11:'QStringList',
                   12:'QByteArray', 17:'QUrl', 30:'QUuid', 31:'void*', 38:'float',
                   39:'QObject*', 41:'QVariant', 43:'void', 45:'QJsonValue', 46:'QJsonObject',
                   47:'QJsonArray', 48:'QJsonDocument'}
        def datatype(value):
            return string(value & 0x7fffffff) if value & 0x80000000 else builtin.get(value, f'QMetaType#{value}')

        result = {'class': string(class_name), 'metaRva':hex(self.va(meta_start)-self.base),
                  'stringRva':hex(self.va(string_start)-self.base), 'revision':revision,
                  'superVa':hex(self.u64(meta_start)), 'staticMetacallRva':hex(self.u64(meta_start+24)-self.base),
                  'methods':[], 'properties':[], 'enums':[]}
        for n in range(methods):
            name, argc, parameters, tag, flags, metatype = struct.unpack_from('<6I',self.raw,data_start+(method_start+n*6)*4)
            if argc > 32: raise ValueError('Too many parameters')
            types = struct.unpack_from('<'+'I'*(argc+1),self.raw,data_start+parameters*4)
            param_names = struct.unpack_from('<'+'I'*argc,self.raw,data_start+(parameters+argc+1)*4)
            result['methods'].append({'name':string(name), 'return':datatype(types[0]),
                'arguments':[{'type':datatype(t),'name':string(p)} for t,p in zip(types[1:],param_names)],
                'kind':{0:'method',4:'signal',8:'slot',12:'constructor'}[flags & 12],
                'access':{0:'private',1:'protected',2:'public'}.get(flags & 3,'unknown'), 'index':n})
        for n in range(props):
            name, typ, flags, notify, rev = struct.unpack_from('<5I', self.raw,data_start+(prop_start+n*5)*4)
            result['properties'].append({'name':string(name),'type':datatype(typ), 'flags':hex(flags)})
        enum_count,enum_start = header[8:10]
        if enum_count > 2000: raise ValueError('Invalid enum count')
        for n in range(enum_count):
            name,alias,flags,keys,values = struct.unpack_from('<5I',self.raw,data_start+(enum_start+n*5)*4)
            if keys > 4096: raise ValueError('Invalid enum key count')
            entries = []
            for i in range(keys):
                key,value = struct.unpack_from('<Ii',self.raw,data_start+(values+i*2)*4)
                entries.append({'name':string(key),'value':value})
            result['enums'].append({'name':string(name),'alias':string(alias),'flags':flags,'entries':entries})
        return result

    def inventory(self, pattern):
        results = {}
        # A class-name string is followed by NUL in moc's offset/length table.
        for section, _, start, size, _ in self.sections:
            if section != '.rdata': continue
            for match in re.finditer(rb'[A-Za-z_][A-Za-z0-9_:]{3,180}\x00',self.raw[start:start+size]):
                name = match.group()[:-1].decode('ascii')
                if not pattern.search(name): continue
                char_start = start+match.start()
                for s in range(max(start,char_start-65536),char_start,4):
                    if self.u32(s) != char_start-s or self.u32(s+4) != len(name): continue
                    needle = struct.pack('<Q',self.va(s))
                    pos = self.raw.find(needle,start,start+size)
                    while pos >= 0:
                        try:
                            info = self.metadata(s,pos-8)
                            if info['class'] == name: results[info['metaRva']] = info
                        except (ValueError,IndexError,KeyError,struct.error,UnicodeDecodeError): pass
                        pos = self.raw.find(needle,pos+1,start+size)
        return sorted(results.values(),key=lambda x:x['class'])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('image',type=Path)
    parser.add_argument('--pattern',default='Import|LocalMedia|VirtualStore|Replacement')
    parser.add_argument('--output',type=Path,required=True)
    args = parser.parse_args()
    image = PE(args.image)
    result = {'image':str(args.image.resolve()),'sha256':hashlib.sha256(image.raw).hexdigest(),
              'preferredBase':hex(image.base), 'classes':image.inventory(re.compile(args.pattern)),
              'exports':[e for e in image.exports() if re.search(args.pattern,e['name'],re.I)]}
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
    print(json.dumps({'classes':len(result['classes']),'exports':len(result['exports']),'output':str(args.output)}))


if __name__ == '__main__': main()
