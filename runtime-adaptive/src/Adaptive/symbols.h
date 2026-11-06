#pragma once
#include <Windows.h>
#include <QtCore/qglobal.h>
#include <algorithm>
#include <cstdint>
#include <cstring>
#include <map>

#include <set>
#include <stdexcept>
#include <string>
#include <cwchar>
#include <vector>
#include "../../vendor/nlohmann-3.10.5/json.hpp"
#include "symbol_profile.h"
#include "fault_boundary.h"
extern "C" IMAGE_DOS_HEADER __ImageBase;

// Resolution is structural. CapCut's marketing/build number is diagnostic data,
// never an authorization to call a stale address.
namespace ExplorerSymbols {
using Json=nlohmann::json;
inline constexpr unsigned symbolCount=20;
struct Seed {quint64 rvas[symbolCount],proofs[symbolCount*3];};
struct RecursiveLock {
    CRITICAL_SECTION value;
    RecursiveLock(){InitializeCriticalSection(&value);}
    ~RecursiveLock(){DeleteCriticalSection(&value);}
    RecursiveLock(const RecursiveLock&)=delete;
    RecursiveLock& operator=(const RecursiveLock&)=delete;
};
struct LockGuard {
    RecursiveLock& lock;
    explicit LockGuard(RecursiveLock& value):lock(value){EnterCriticalSection(&lock.value);}
    ~LockGuard(){LeaveCriticalSection(&lock.value);}
};
struct ResolvedState {bool initialized=false;RecursiveLock mutex;std::map<quintptr,quintptr> cache;};
inline ResolvedState& resolvedState(){static ResolvedState value;return value;}
struct Span {quintptr begin,end;};
inline std::vector<Span> sections(HMODULE module,bool code) {
    if(!module)throw std::runtime_error("AUTOSYNC_MODULE_MISSING");
    const auto base=reinterpret_cast<quintptr>(module);
    const auto* dos=reinterpret_cast<const IMAGE_DOS_HEADER*>(base);
    if(dos->e_magic!=IMAGE_DOS_SIGNATURE || dos->e_lfanew<=0 || dos->e_lfanew>1024*1024)
        throw std::runtime_error("AUTOSYNC_IMAGE_INVALID");
    const auto* nt=reinterpret_cast<const IMAGE_NT_HEADERS64*>(base+static_cast<unsigned>(dos->e_lfanew));
    if(nt->Signature!=IMAGE_NT_SIGNATURE || nt->OptionalHeader.Magic!=IMAGE_NT_OPTIONAL_HDR64_MAGIC || nt->FileHeader.NumberOfSections>96)
        throw std::runtime_error("AUTOSYNC_IMAGE_INVALID");
    std::vector<Span> result;
    const auto* header=IMAGE_FIRST_SECTION(nt);
    for(unsigned i=0;i<nt->FileHeader.NumberOfSections;++i) {
        if(!(header[i].Characteristics&IMAGE_SCN_MEM_READ) || bool(header[i].Characteristics&IMAGE_SCN_MEM_EXECUTE)!=code)continue;
        const auto size=header[i].Misc.VirtualSize;
        if(!size || header[i].VirtualAddress>nt->OptionalHeader.SizeOfImage || size>nt->OptionalHeader.SizeOfImage-header[i].VirtualAddress)
            throw std::runtime_error("AUTOSYNC_IMAGE_BOUNDS");
        result.push_back({base+header[i].VirtualAddress,base+header[i].VirtualAddress+size});
    }
    return result;
}
inline bool contains(const std::vector<Span>& spans,quintptr value,std::size_t size=1) {
    return std::any_of(spans.begin(),spans.end(),[&](const Span& s){return value>=s.begin && value<s.end && size<=s.end-value;});
}
inline bool executable(HMODULE module,quintptr value) {return contains(sections(module,true),value);}
inline bool ownedModule(HMODULE module) {
    wchar_t image[4096]{},owner[4096]{};
    if(!module || !GetModuleFileNameW(module,image,4096) || !GetModuleFileNameW(nullptr,owner,4096))return false;
    auto* a=std::wcsrchr(image,L'\\');auto* b=std::wcsrchr(owner,L'\\');
    if(!a || !b)return false;*a=0;*b=0;return !_wcsicmp(image,owner);
}
inline std::string buildLabel() {
    wchar_t path[4096]{};if(!GetModuleFileNameW(GetModuleHandleW(L"VECreator.dll"),path,4096))return "unknown";
    auto* end=std::wcsrchr(path,L'\\');if(!end)return "unknown";*end=0;const auto* start=std::wcsrchr(path,L'\\');
    if(!start)return "unknown";std::string result;for(++start;*start;++start)result.push_back(*start<128?static_cast<char>(*start):'?');return result;
}
inline quintptr sdkData(const char* name) {
    const auto module=GetModuleHandleW(L"videoeditor.dll");
    const auto value=reinterpret_cast<quintptr>(GetProcAddress(module,name));
    if(!value || !contains(sections(module,false),value,sizeof(quintptr)))throw std::runtime_error("AUTOSYNC_SDK_DATA_MISSING");
    return value;
}
inline std::vector<unsigned char> unhex(const std::string& text) {
    if(text.size()%2 || text.size()>4096)throw std::runtime_error("AUTOSYNC_PROFILE_INVALID");
    std::vector<unsigned char> result;
    for(std::size_t i=0;i<text.size();i+=2)result.push_back(static_cast<unsigned char>(std::stoul(text.substr(i,2),nullptr,16)));
    return result;
}
inline std::vector<quintptr> matches(HMODULE module,const Json& mark) {
    const auto bytes=unhex(mark.at("bytes").get<std::string>()),mask=unhex(mark.at("mask").get<std::string>());
    if(bytes.size()!=mask.size() || bytes.size()<12)throw std::runtime_error("AUTOSYNC_PROFILE_INVALID");
    std::size_t anchor=0,length=0;
    for(std::size_t i=0;i<mask.size();) {
        if(!mask[i]){++i;continue;}
        auto end=i;while(end<mask.size() && mask[end])++end;
        if(end-i>length){anchor=i;length=end-i;}i=end;
    }
    if(length<3)throw std::runtime_error("AUTOSYNC_PROFILE_WEAK");
    std::vector<quintptr> result;
    for(const auto span:sections(module,true)) {
        // Image section flags do not prove that every mapped page is readable.
        // Copy readable regions through the OS; a protected page is unavailable,
        // never a reason to dereference it or alter its protection.
        auto region=span.begin;
        while(region<span.end) {
            MEMORY_BASIC_INFORMATION info{};
            if(!VirtualQuery(reinterpret_cast<const void*>(region),&info,sizeof(info)))break;
            const auto end=std::min(span.end,reinterpret_cast<quintptr>(info.BaseAddress)+info.RegionSize);
            if(end<=region)break;
            if(info.State!=MEM_COMMIT || info.Protect&(PAGE_NOACCESS|PAGE_GUARD)){region=end;continue;}
            std::vector<unsigned char> copy(static_cast<std::size_t>(end-region));SIZE_T copied=0;
            if(!ReadProcessMemory(GetCurrentProcess(),reinterpret_cast<const void*>(region),copy.data(),copy.size(),&copied) || copied!=copy.size()){region=end;continue;}
            std::size_t cursor=0;
            while(cursor+bytes.size()<=copy.size()) {
            const auto count=copy.size()-cursor-bytes.size()+1;
            const auto* found=static_cast<const unsigned char*>(std::memchr(copy.data()+cursor+anchor,bytes[anchor],count));
            if(!found)break;
            const auto candidate=static_cast<std::size_t>(found-copy.data())-anchor;cursor=candidate+1;
            if(std::memcmp(found,bytes.data()+anchor,length))continue;
            bool same=true;
            for(std::size_t i=0;i<bytes.size();++i)if(mask[i] && copy[candidate+i]!=bytes[i]){same=false;break;}
            if(same){result.push_back(region+candidate);if(result.size()>32)return {};}
            }
            region=end;
        }
    }
    return result;
}
inline quintptr creator(quintptr key) {
    auto& state=resolvedState();
    const LockGuard guard(state.mutex);
    auto& cache=state.cache;
    if(const auto found=cache.find(key);found!=cache.end())return found->second;
    const auto host=GetModuleHandleW(L"CapSync.AdaptiveEventsV4.dll");
    if(host && host!=reinterpret_cast<HMODULE>(&__ImageBase)) {
        using Resolve=quintptr(__cdecl*)(quintptr);
        const auto resolve=reinterpret_cast<Resolve>(GetProcAddress(host,"CapSync_AdaptiveResolve"));
        const auto value=resolve?resolve(key):0;
        if(!value)throw std::runtime_error("AUTOSYNC_SHARED_INTERFACE_UNAVAILABLE");
        cache[key]=value;return value;
    }
    if(state.initialized)throw std::runtime_error("AUTOSYNC_SHARED_INTERFACE_UNAVAILABLE");
    const auto module=GetModuleHandleW(L"VECreator.dll");
    static const auto profile=Json::parse(adaptiveSymbolProfile);
    const Json* descriptor=nullptr;
    for(const auto& item:profile.at("symbols"))if(std::stoull(item.at("key").get<std::string>(),nullptr,16)==key){descriptor=&item;break;}
    if(!descriptor)throw std::runtime_error("AUTOSYNC_SYMBOL_UNDECLARED");
    const auto& item=*descriptor;const auto name=item.at("name").get<std::string>(),kind=item.at("kind").get<std::string>();
    std::map<quintptr,unsigned> votes;
    if(kind=="returnedGlobal") {
        const auto fn=creator(static_cast<quintptr>(std::stoull(item.at("functionKey").get<std::string>(),nullptr,16)));
        unsigned char body[128]{};SIZE_T copied=0;
        if(!ReadProcessMemory(GetCurrentProcess(),reinterpret_cast<const void*>(fn),body,sizeof(body),&copied) || copied!=sizeof(body))
            throw std::runtime_error("AUTOSYNC_CODE_READ_UNAVAILABLE");
        for(std::size_t i=0;i<112;++i) {
            if(!contains(sections(module,true),fn+i,13))break;
            const auto* p=body+i;
            if(p[0]!=0x48 || p[1]!=0x8d || p[2]!=0x05 || p[7]!=0x48 || p[8]!=0x83 || p[9]!=0xc4 || p[11]!=0x5b || p[12]!=0xc3)continue;
            std::int32_t displacement=0;std::memcpy(&displacement,p+3,4);
            const auto value=static_cast<quintptr>(static_cast<std::intptr_t>(fn+i+7)+displacement);
            if(contains(sections(module,false),value,128))votes[value]=2;
        }
    } else {
        for(const auto& mark:item.at("marks")) {
            const auto found=matches(module,mark);
            if(found.size()!=1)continue;
            quintptr value=0;
            if(kind=="function") {
                const auto offset=mark.at("oldOffset").get<unsigned>();
                if(found[0]<offset)continue;value=found[0]-offset;
                if(!executable(module,value))continue;
            } else if(kind=="rip") {
                const auto reference=found[0]+mark.at("referenceOffset").get<unsigned>();
                std::int32_t displacement=0;
                std::memcpy(&displacement,reinterpret_cast<const void*>(reference+mark.at("displacementOffset").get<unsigned>()),4);
                value=static_cast<quintptr>(static_cast<std::intptr_t>(reference+mark.at("instructionLength").get<unsigned>())+displacement);
                if(!contains(sections(module,false),value,sizeof(quintptr)))continue;
            } else throw std::runtime_error("AUTOSYNC_PROFILE_INVALID");
            ++votes[value];
        }
    }
    std::vector<quintptr> accepted;
    for(const auto [value,count]:votes)if(count>=2)accepted.push_back(value);
    if(accepted.size()!=1)throw std::runtime_error("AUTOSYNC_SYMBOL_UNAVAILABLE:"+name);
    if(kind=="function") {
        DWORD64 imageBase=0;const auto* unwind=RtlLookupFunctionEntry(static_cast<DWORD64>(accepted[0]),&imageBase,nullptr);
        if(unwind && (imageBase!=reinterpret_cast<DWORD64>(module) || imageBase+unwind->BeginAddress!=accepted[0]))
            throw std::runtime_error("AUTOSYNC_FUNCTION_ENTRY_CHANGED:"+name);
    }
    cache.emplace(key,accepted[0]);return accepted[0];
}
inline bool checkLandmark(HMODULE module,quintptr address,const Json& mark) {
    const auto bytes=unhex(mark.at("bytes").get<std::string>()),mask=unhex(mark.at("mask").get<std::string>());
    if(bytes.size()!=mask.size() || !contains(sections(module,true),address,bytes.size()))return false;
    std::vector<unsigned char> observed(bytes.size());SIZE_T copied=0;
    if(!ReadProcessMemory(GetCurrentProcess(),reinterpret_cast<const void*>(address),observed.data(),observed.size(),&copied) || copied!=observed.size())return false;
    for(std::size_t i=0;i<bytes.size();++i)if(mask[i] && observed[i]!=bytes[i])return false;
    return true;
}
inline void initialize(const Seed& seed) {
    const auto module=GetModuleHandleW(L"VECreator.dll");const auto base=reinterpret_cast<quintptr>(module);
    const auto profile=Json::parse(adaptiveSymbolProfile);
    if(profile.at("symbols").size()!=symbolCount)throw std::runtime_error("AUTOSYNC_PROFILE_INVALID");
    auto& state=resolvedState();const LockGuard guard(state.mutex);
    for(unsigned index=0;index<symbolCount;++index) {
        const auto& item=profile.at("symbols")[index];const auto key=static_cast<quintptr>(std::stoull(item.at("key").get<std::string>(),nullptr,16));
        if(!seed.rvas[index])continue;
        const auto candidate=base+seed.rvas[index];unsigned verified=0;
        const auto kind=item.at("kind").get<std::string>();
        if(kind=="returnedGlobal") {
            if(creator(key)==candidate)verified=2;
        } else {
            for(unsigned i=0;i<item.at("marks").size();++i) {
                const auto& mark=item.at("marks")[i];const auto proof=seed.proofs[index*3+i];
                if(!proof)continue;const auto address=base+proof;
                if(!checkLandmark(module,address,mark))continue;
                if(kind=="function") {
                    if(address-mark.at("oldOffset").get<unsigned>()==candidate && executable(module,candidate))++verified;
                } else if(kind=="rip") {
                    const auto reference=address+mark.at("referenceOffset").get<unsigned>();std::int32_t displacement=0;SIZE_T copied=0;
                    if(!ReadProcessMemory(GetCurrentProcess(),reinterpret_cast<const void*>(reference+mark.at("displacementOffset").get<unsigned>()),&displacement,4,&copied) || copied!=4)continue;
                    const auto target=static_cast<quintptr>(static_cast<std::intptr_t>(reference+mark.at("instructionLength").get<unsigned>())+displacement);
                    if(target==candidate && contains(sections(module,false),candidate,sizeof(quintptr)))++verified;
                }
            }
        }
        if(kind=="function") {
            DWORD64 image=0;const auto* entry=RtlLookupFunctionEntry(static_cast<DWORD64>(candidate),&image,nullptr);
            if(entry && (image!=base || image+entry->BeginAddress!=candidate))throw std::runtime_error("AUTOSYNC_FUNCTION_ENTRY_CHANGED");
        }
        if(verified<2)throw std::runtime_error("AUTOSYNC_LOADED_INTERFACE_CHANGED:"+item.at("name").get<std::string>());
        state.cache[key]=candidate;
    }
    state.initialized=true;
}
inline Json inspect() {
    const auto profile=Json::parse(adaptiveSymbolProfile);Json result=Json::array();
    for(const auto& symbol:profile.at("symbols")) {
        try {const auto address=creator(static_cast<quintptr>(std::stoull(symbol.at("key").get<std::string>(),nullptr,16)));result.push_back({{"name",symbol.at("name")},{"available",true},{"rva",address-reinterpret_cast<quintptr>(GetModuleHandleW(L"VECreator.dll"))}});}
        catch(const std::exception& e){result.push_back({{"name",symbol.at("name")},{"available",false},{"reason",e.what()}});}
    }
    return result;
}
}
