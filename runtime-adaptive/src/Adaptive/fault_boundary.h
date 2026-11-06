#pragma once
#include <Windows.h>
#include <cstdio>
#include <string>
#include <utility>

namespace ExplorerFaultBoundary {
inline thread_local const char* stage="native.callback";
inline thread_local ULONG_PTR faultPc=0;
inline int filter(EXCEPTION_POINTERS* value){faultPc=reinterpret_cast<ULONG_PTR>(value->ExceptionRecord->ExceptionAddress);return value->ExceptionRecord->ExceptionCode==0xe06d7363UL?EXCEPTION_CONTINUE_SEARCH:EXCEPTION_EXECUTE_HANDLER;}
using Callback=void(*)(void*);
inline DWORD invoke(Callback callback,void* context) {
    __try {callback(context);return 0;}
    __except(filter(GetExceptionInformation())) {return GetExceptionCode();}
}
inline void receipt(const wchar_t* path,DWORD fault) {
    const auto file=CreateFileW(path,GENERIC_WRITE,0,nullptr,CREATE_ALWAYS,FILE_ATTRIBUTE_NORMAL,nullptr);
    if(file==INVALID_HANDLE_VALUE)return;
    char buffer[256]{};
    const auto count=std::snprintf(buffer,sizeof(buffer),"{\"status\":\"unknown\",\"reason\":\"AUTOSYNC|native|hardware_fault|0x%08lx:%s:pc_%llx\",\"completionUnknown\":true}",static_cast<unsigned long>(fault),stage,static_cast<unsigned long long>(faultPc));
    if(count>0 && static_cast<std::size_t>(count)<sizeof(buffer)){DWORD written=0;WriteFile(file,buffer,static_cast<DWORD>(count),&written,nullptr);}
    CloseHandle(file);
}
template<class Callable> auto guarded(Callable callback,const wchar_t* output) {
    return [callback=std::move(callback),path=std::wstring(output)]()mutable {
        const auto fault=invoke([](void* context){(*static_cast<Callable*>(context))();},&callback);
        if(fault)receipt(path.c_str(),fault);
    };
}
template<class Callable,class Failure> auto guarded(Callable callback,const wchar_t* output,Failure failure) {
    return [callback=std::move(callback),path=std::wstring(output),failure=std::move(failure)]()mutable {
        const auto fault=invoke([](void* context){(*static_cast<Callable*>(context))();},&callback);
        if(fault){receipt(path.c_str(),fault);failure(fault);}
    };
}
}
