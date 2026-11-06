"""Read a continuity stamp while StableFile denies writes, moves and deletion.

This is deliberately unavailable on a filesystem without a valid NTFS USN.
It never falls back to pathname, content hash, length or modification time.
"""
import ctypes as C
from ctypes import wintypes as W
import struct
from contextlib import ExitStack,contextmanager
from pathlib import Path
from live_update import StableFile


def same_interval(before,after):
    """Directory ChangeTime can change on child edits without a directory rename.

    A directory rename updates that directory's USN. Compare each ancestor's
    own FILE_ID/USN plus its absolute position, retaining all file-level fields.
    """
    def chain(value):
        return [(row['path'],row['stamp']['fileIdentity'],row['stamp']['usn']) for row in value['ancestors']]
    return before['file']==after['file'] and chain(before)==chain(after)


def stamp(stable,allow_zero=False):
    identity=stable.identity();kernel=stable.k
    class Basic(C.Structure):
        _fields_=[('creation',C.c_int64),('access',C.c_int64),('write',C.c_int64),('change',C.c_int64),('attributes',W.DWORD)]
    basic=Basic();get=kernel.GetFileInformationByHandleEx
    get.argtypes=[W.HANDLE,C.c_int,C.c_void_p,W.DWORD];get.restype=W.BOOL
    if not get(stable.handle,0,C.byref(basic),C.sizeof(basic)) or basic.change<=0:
        raise OSError('Physical source change stamp is unavailable')
    ioctl=kernel.DeviceIoControl
    ioctl.argtypes=[W.HANDLE,W.DWORD,C.c_void_p,W.DWORD,C.c_void_p,W.DWORD,C.POINTER(W.DWORD),C.c_void_p];ioctl.restype=W.BOOL
    versions=(C.c_ushort*2)(2,2);buffer=C.create_string_buffer(4096);size=W.DWORD()
    if not ioctl(stable.handle,0x900eb,versions,4,buffer,len(buffer),C.byref(size),None):
        raise OSError('Source continuity requires a readable NTFS change journal')
    length,major,minor,reference,parent,usn=struct.unpack_from('<IHHQQq',buffer.raw)
    if not 60<=length<=size.value<=len(buffer) or major!=2 or minor!=0 or usn<0 or (usn==0 and not allow_zero) or reference!=int(identity.split(':')[1],16):
        raise ValueError('Physical source USN record differs from its file identity')
    return {'fileIdentity':identity,'usn':usn,'changeTime':basic.change}


@contextmanager
def locked_path(path):
    """Include every renameable ancestor: directory rename need not touch file USN."""
    path=Path(path).absolute()
    with ExitStack() as stack:
        file=StableFile(path);stack.callback(file.close)
        ancestors=[];parents=[p for p in path.parents if str(p)!=p.anchor]
        # Hold the entry itself without following a file symlink. A lock on a
        # symlink's target would not prove continuity of the symlink's pathname.
        for parent in [path,*parents]:
            directory=StableFile.__new__(StableFile);directory.k=file.k
            directory.handle=file.k.CreateFileW(str(parent),0x80000000,1,None,3,0x02200000,None)
            if directory.handle==C.c_void_p(-1).value:raise OSError('Source ancestor cannot be locked')
            stack.callback(directory.close)
            # Do not follow a directory junction or symbolic link when proving
            # continuity of an absolute path. The default file handle follows it.
            get=file.k.GetFileInformationByHandleEx;get.argtypes=[W.HANDLE,C.c_int,C.c_void_p,W.DWORD];get.restype=W.BOOL
            class Tags(C.Structure):_fields_=[('attributes',W.DWORD),('tag',W.DWORD)]
            tags=Tags()
            if not get(directory.handle,9,C.byref(tags),C.sizeof(tags)) or tags.attributes&0x400:
                raise OSError('Reparse-point ancestors cannot establish source continuity')
            if parent==path:
                if directory.identity()!=file.identity():raise OSError('Source entry and data handle identify different files')
            else:ancestors.append({'path':str(parent).casefold(),'stamp':stamp(directory,allow_zero=True)})
        yield file,{'file':stamp(file),'ancestors':ancestors}
