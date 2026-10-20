#pragma once
#include "session_identity.h"
#include <cwchar>
#ifdef CAPSYNC_PRODUCT_RUNTIME
#include "project_scope.h"
#endif

struct ExplorerRuntimeLease {
    unsigned processId,reserved;
    quint64 viewEpoch;
    wchar_t location[1024];
    char draftId[37],token[65];
};
namespace ExplorerRuntime {
inline void check(const ExplorerRuntimeLease& lease) {
    if(lease.reserved || lease.processId!=GetCurrentProcessId() || !lease.viewEpoch ||
       !std::wmemchr(lease.location,0,1024) || !std::memchr(lease.draftId,0,37) || !std::memchr(lease.token,0,65))
        throw std::runtime_error("invalid runtime lease");
#ifdef CAPSYNC_PRODUCT_RUNTIME
#if CAPSYNC_PRODUCT_GENERATION >= 5
        const auto host=GetModuleHandleW(L"CapSync.ExplorerProductEventsV5.dll");
#elif CAPSYNC_PRODUCT_GENERATION >= 4
    const auto host=GetModuleHandleW(L"CapSync.ExplorerProductEventsV4.dll");
#elif CAPSYNC_PRODUCT_GENERATION >= 3
    const auto host=GetModuleHandleW(L"CapSync.ExplorerProductEventsV3.dll");
#elif CAPSYNC_PRODUCT_GENERATION >= 2
    const auto host=GetModuleHandleW(L"CapSync.ExplorerProductEventsV2.dll");
#else
    const auto host=GetModuleHandleW(L"CapSync.ExplorerProductEventsV1.dll");
#endif
#elif defined(CAPSYNC_EXPLORER_RUNTIME_V2)
    const auto host=GetModuleHandleW(L"CapSync.ExplorerRuntimeEventsV2.dll");
#else
    const auto host=GetModuleHandleW(L"CapSync.ExplorerRuntimeEvents.dll");
#endif
    using Check=bool(__cdecl*)(const ExplorerRuntimeLease*);
    const auto validate=host?reinterpret_cast<Check>(GetProcAddress(host,"CapSync_ExplorerCheckLease")):nullptr;
    if(!validate || !validate(&lease))throw std::runtime_error("runtime session lease revoked");
#ifdef CAPSYNC_PRODUCT_RUNTIME
    ExplorerProject::grid();
#endif
}
}
