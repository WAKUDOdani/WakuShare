// Explicit timeline persistence through the exported SDK StoreWrapper API.
// No source setters, bin relink, navigation, cache work or project JSON writer.
#include "runtime_guard.h"
#include "../CapSync.NativeRelink/sdk_exports.h"
#include <QtCore/QSaveFile>
#include <QtGui/QGuiApplication>
#include <fstream>
#include <filesystem>
#include <functional>
#include "../../vendor/nlohmann-3.10.5/json.hpp"
using Json=nlohmann::json;
namespace draft_store {class WriteDraftJsonResult;}
struct Request {unsigned size,version;wchar_t input[1024],output[1024];ExplorerRuntimeLease lease;};
namespace {
template<class T>T read(quintptr p){T v{};SIZE_T n=0;if(p<0x10000 || !ReadProcessMemory(GetCurrentProcess(),reinterpret_cast<LPCVOID>(p),&v,sizeof v,&n) || n!=sizeof v)throw std::runtime_error("unreadable SDK owner");return v;}
template<class T>T entry(HMODULE sdk,const Json& key){
    const auto address=GetProcAddress(sdk,key.at("name").get<std::string>().c_str());
    if(!address || reinterpret_cast<quintptr>(address)!=reinterpret_cast<quintptr>(sdk)+std::stoull(key.at("rva").get<std::string>(),nullptr,16))throw std::runtime_error("SDK export mismatch");
    return reinterpret_cast<T>(address);
}
void perform(Request r){
    Json result={{"status","rejected"},{"mutationDispatched",false},{"sourceSetters",0}};
    try{
        ExplorerRuntime::check(r.lease);
        std::ifstream input(std::filesystem::path(r.input));Json job;input>>job;result["jobId"]=job.at("id");
        const auto identity=ExplorerSession::current();
        if(
#ifndef CAPSYNC_PRODUCT_RUNTIME
           identity.draftId!=QStringLiteral("582F1BF9-2B25-4CF2-B83F-3528F1B868B2") ||
#endif
           QString::fromStdString(job.at("projectId").get<std::string>()).toUpper()!=identity.draftId)throw std::runtime_error("different active lab");
        const auto creator=reinterpret_cast<quintptr>(GetModuleHandleW(L"VECreator.dll"));const auto sdk=GetModuleHandleW(L"videoeditor.dll");
        using Get=std::shared_ptr<void>*(__fastcall*)(std::shared_ptr<void>*,int);
        using OwnerGet=void*(__fastcall*)(quintptr,std::shared_ptr<void>*);
        std::shared_ptr<void> manager,opaque;reinterpret_cast<Get>(creator+0x63d59b0)(&manager,1);
        if(!manager)throw std::runtime_error("manager absent");const auto address=reinterpret_cast<quintptr>(manager.get());
        const auto getter=read<quintptr>(read<quintptr>(address)+0x70);
        if(getter<creator || getter>=creator+0x7000000)throw std::runtime_error("owner getter bounds");
        reinterpret_cast<OwnerGet>(getter)(address,&opaque);if(!opaque)throw std::runtime_error("owner absent");
        const auto container=reinterpret_cast<quintptr>(opaque.get());const auto begin=read<quintptr>(container+8),end=read<quintptr>(container+0x10);
        if(end-begin!=16)throw std::runtime_error("exactly one timeline required");
        const auto holder=read<quintptr>(begin),root=read<quintptr>(holder);
        if(read<quintptr>(root)!=reinterpret_cast<quintptr>(sdk)+job.at("draftVtableRva").get<quintptr>())throw std::runtime_error("SDK Draft vtable differs");
        const auto owner=*reinterpret_cast<const std::shared_ptr<void>*>(holder);
        using Serialize=std::string*(__fastcall*)(std::string*,const std::shared_ptr<void>&);
        const auto serializer=entry<Serialize>(sdk,job.at("exports").at("saveDraft"));
        const auto serialize=[&](){std::string text;serializer(&text,owner);return Json::parse(text);};
        const auto before=serialize();if(before!=job.at("expectedTimeline"))throw std::runtime_error("live SDK differs from complete expected timeline");
#ifdef CAPSYNC_DRAFT_READ_ONLY
        ExplorerRuntime::check(r.lease);
        if(serialize()!=before)throw std::runtime_error("SDK draft changed during read");
        result["wholeSdkDraftExact"]=true;result["status"]="read";result["projectMutation"]=false;
#else
        using Completion=std::function<void(const draft_store::WriteDraftJsonResult&)>;
        static_assert(sizeof(Completion)==64,"unsupported function ABI");
        using Save=void(__fastcall*)(quintptr,const std::shared_ptr<void>&,bool,Completion);
        const auto save=entry<Save>(sdk,job.at("storeSaveExport"));
        const auto service=read<quintptr>(creator+0xec16c18),current=read<quintptr>(service+0x70),drop=read<quintptr>(service+0x78);
        POINT cursor{};GetCursorPos(&cursor);const auto foreground=GetForegroundWindow();auto* focus=QGuiApplication::focusObject();
        result["mutationDispatched"]=true;result["status"]="unknown";
        // Use the SDK's runtime-Draft overload, not a caller-created JSON blob.
        save(reinterpret_cast<quintptr>(identity.store.get()),owner,true,Completion{});
        result["wholeSdkDraftExact"]=serialize()==before;
        ExplorerRuntime::check(r.lease);
        POINT after{};GetCursorPos(&after);
        result["focusUnchanged"]=focus==QGuiApplication::focusObject();result["foregroundUnchanged"]=foreground==GetForegroundWindow();
        result["cursorUnchanged"]=cursor.x==after.x && cursor.y==after.y;
        result["navigationUnchanged"]=current==read<quintptr>(service+0x70) && drop==read<quintptr>(service+0x78);
        if(!result["wholeSdkDraftExact"].get<bool>())throw std::runtime_error("SDK save changed timeline values");
        result["status"]="submitted";
#endif
    }catch(const std::exception& error){result["reason"]=error.what();}
    QSaveFile output(QString::fromWCharArray(r.output));if(output.open(QIODevice::WriteOnly)){const auto text=result.dump(2);output.write(text.data(),static_cast<qint64>(text.size()));output.commit();}
}
}
extern "C" __declspec(dllexport) DWORD WINAPI CapSync_StoreSaveThread(LPVOID raw){
    const auto* r=static_cast<const Request*>(raw);
    if(!r || r->size!=sizeof(Request) || r->version!=1 || !std::wmemchr(r->input,0,1024) || !std::wmemchr(r->output,0,1024))return 2;
    auto* app=QCoreApplication::instance();if(!app || std::strcmp(qVersion(),"6.2.2"))return 3;
    HMODULE pinned=nullptr;if(!GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS|GET_MODULE_HANDLE_EX_FLAG_PIN,reinterpret_cast<LPCWSTR>(&CapSync_StoreSaveThread),&pinned))return 4;
    const Request copy=*r;return QMetaObject::invokeMethod(app,[copy]{perform(copy);},Qt::QueuedConnection)?1:5;
}
BOOL WINAPI DllMain(HINSTANCE instance,DWORD reason,LPVOID){if(reason==DLL_PROCESS_ATTACH)DisableThreadLibraryCalls(instance);return TRUE;}
