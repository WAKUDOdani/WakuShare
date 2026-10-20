"""Same NTFS continuity proof; share ancestor locks within one catalog read."""
from contextlib import ExitStack
import ctypes as C
from ctypes import wintypes as W
from pathlib import Path
from explorer_file_stamp import stamp
from live_update import StableFile

class Tags(C.Structure):_fields_=[('attributes',W.DWORD),('tag',W.DWORD)]

class LockedPaths:
    def __init__(self):self.stack=ExitStack();self.parents={}
    def __enter__(self):return self
    def __exit__(self,*args):self.stack.close()
    @staticmethod
    def entry(kernel,path,stack):
        item=StableFile.__new__(StableFile);item.k=kernel
        item.handle=kernel.CreateFileW(str(path),0x80000000,1,None,3,0x02200000,None)
        if item.handle==C.c_void_p(-1).value:raise OSError('Source ancestor cannot be locked')
        stack.callback(item.close)
        get=kernel.GetFileInformationByHandleEx;get.argtypes=[W.HANDLE,C.c_int,C.c_void_p,W.DWORD];get.restype=W.BOOL;tags=Tags()
        if not get(item.handle,9,C.byref(tags),C.sizeof(tags)) or tags.attributes&0x400:raise OSError('Reparse-point ancestors cannot establish source continuity')
        return item
    def lock(self,path):
        path=Path(path).absolute();local=ExitStack()
        try:
            file=StableFile(path);local.callback(file.close);entry=self.entry(file.k,path,local)
            if entry.identity()!=file.identity():raise OSError('Source entry and data handle identify different files')
            ancestors=[]
            for parent in path.parents:
                if str(parent)==parent.anchor:continue
                key=str(parent)
                if key not in self.parents:
                    directory=self.entry(file.k,parent,self.stack)
                    self.parents[key]=stamp(directory,allow_zero=True)
                ancestors.append({'path':key.casefold(),'stamp':dict(self.parents[key])})
            physical={'file':stamp(file),'ancestors':ancestors}
            self.stack.callback(local.close);return file,physical
        except BaseException:
            local.close();raise
