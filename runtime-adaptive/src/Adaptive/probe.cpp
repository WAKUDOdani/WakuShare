#include "symbols.h"
#include <fstream>

struct AdaptiveProbeRequest {unsigned size,version;wchar_t output[1024];ExplorerSymbols::Seed symbols;};
static DWORD inspectSymbols(void* memory) {
    AdaptiveProbeRequest request{};SIZE_T copied=0;
    if(!memory || !ReadProcessMemory(GetCurrentProcess(),memory,&request,sizeof(request),&copied) || copied!=sizeof(request) || request.size!=sizeof(request) || request.version!=1 || !std::wmemchr(request.output,0,1024))return 2;
    try {
        const auto start=GetTickCount64();
        ExplorerSymbols::initialize(request.symbols);
        const auto result=ExplorerSymbols::Json{{"readOnly",true},{"editorCommands",0},{"qtVersion",qVersion()},{"symbols",ExplorerSymbols::inspect()},{"elapsedMs",GetTickCount64()-start}};
        std::ofstream output(request.output,std::ios::binary|std::ios::trunc);output<<result.dump(2);output.close();
        return output.fail()?3:0;
    }catch(...){return 4;}
}
// A diagnostic boundary must report a hardware fault rather than terminate its
// host process. This wrapper contains no C++ objects requiring unwinding.
extern "C" __declspec(dllexport) DWORD WINAPI CapSync_AdaptiveProbeThread(void* memory) {
    __try {return inspectSymbols(memory);}
    __except(EXCEPTION_EXECUTE_HANDLER) {
        AdaptiveProbeRequest request{};SIZE_T copied=0;
        if(memory && ReadProcessMemory(GetCurrentProcess(),memory,&request,sizeof(request),&copied) && copied==sizeof(request) && std::wmemchr(request.output,0,1024)) {
            const auto file=CreateFileW(request.output,GENERIC_WRITE,0,nullptr,CREATE_ALWAYS,FILE_ATTRIBUTE_NORMAL,nullptr);
            if(file!=INVALID_HANDLE_VALUE) {
                const char report[]="{\"readOnly\":true,\"editorCommands\":0,\"error\":\"AUTOSYNC_NATIVE_READ_FAULT\"}";DWORD written=0;
                WriteFile(file,report,sizeof(report)-1,&written,nullptr);CloseHandle(file);
            }
        }
        return 5;
    }
}
