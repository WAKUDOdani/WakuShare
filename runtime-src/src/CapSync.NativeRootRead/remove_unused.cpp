#include "../CapSync.NativeExplorerObserve/material_limits.h"
// Single stock removal of an explicitly unused and reserved laboratory WAV.
// The V15 container interpretation is not used; the holder indirection is
// validated against the exact native-owner read and SDK Draft vtable.
#include "../CapSync.NativeProbe/qt62_compat.h"
#include <Windows.h>
#include <QtCore/QCoreApplication>
#include <QtCore/QFile>
#include <QtCore/QThread>
#include <QtCore/QSaveFile>
#include <QtCore/QMetaMethod>
#include <QtCore/QPointer>
#include <QtCore/QFileInfo>
#include <QtCore/QDir>
#include <QtGui/QGuiApplication>
#include <memory>
#include <vector>
#include <string>
#include <cwchar>
#include <filesystem>
#include <fstream>
#include "../../vendor/nlohmann-3.10.5/json.hpp"
#include "../CapSync.NativeRelink/sdk_exports.h"
#ifdef CAPSYNC_EXPLORER_RUNTIME
#include <QtCore/QJsonDocument>
#include <QtCore/QJsonObject>
#include <QtCore/QJsonArray>
#include "../CapSync.NativeExplorerObserve/runtime_guard.h"
#include "../CapSync.NativeAdd/bin_snapshot.h"
#include "../CapSync.NativeExplorerObserve/media_formats.h"
#endif
using Json=nlohmann::json;
#ifdef CAPSYNC_USED_FIXTURE_REMOVAL
#include "used_fixture_guard.h"
#endif
using List=std::vector<std::shared_ptr<void>>;
struct Request {unsigned size,version;wchar_t input[1024],output[1024];
#ifdef CAPSYNC_EXPLORER_RUNTIME
    ExplorerRuntimeLease lease;
#endif
};
template<class T>T read(quintptr p){T v{};SIZE_T n=0;if(p<0x10000 || !ReadProcessMemory(GetCurrentProcess(),reinterpret_cast<LPCVOID>(p),&v,sizeof v,&n) || n!=sizeof v)throw std::runtime_error("unreadable");return v;}
template<class T>T entry(HMODULE sdk,const Json& keys,const char* key){
    const auto info=keys.at(key);const auto address=GetProcAddress(sdk,info.at("name").get<std::string>().c_str());
    if(!address || reinterpret_cast<quintptr>(address)!=reinterpret_cast<quintptr>(sdk)+std::stoull(info.at("rva").get<std::string>(),nullptr,16))throw std::runtime_error("SDK export mismatch");
    return reinterpret_cast<T>(address);
}
void perform(Request r){
    Json result={{"status","rejected"},{"mutationDispatched",false}};
    try{
        if(QThread::currentThread()!=QCoreApplication::instance()->thread())throw std::runtime_error("thread");
#ifdef CAPSYNC_EXPLORER_RUNTIME
        ExplorerRuntime::check(r.lease);
#endif
        std::ifstream input(std::filesystem::path(r.input));Json job;input>>job;
        result["jobId"]=job.at("id");
        const auto creator=reinterpret_cast<quintptr>(GetModuleHandleW(L"VECreator.dll"));
        const auto sdk=GetModuleHandleW(L"videoeditor.dll");
        if(!creator || !sdk)throw std::runtime_error("modules absent");
        const auto materialId=job.at("materialId").get<std::string>();
#ifdef CAPSYNC_PRODUCT_RUNTIME
        if(QString::fromStdString(job.at("projectId").get<std::string>()).toUpper()!=ExplorerSession::current().draftId)throw std::runtime_error("different active project");
#else
        if(job.at("projectId")!="582F1BF9-2B25-4cf2-B83F-3528F1B868B2"
#ifndef CAPSYNC_MEDIA_PATH
           || materialId!="feda0376-f183-40ba-8a95-246a4e783749"
#endif
          )
            throw std::runtime_error("isolated unused WAV control only");
#endif
        std::ifstream metadata(std::filesystem::u8path(job.at("metaPath").get<std::string>()));Json meta;metadata>>meta;
        if(meta.at("draft_id")!=job.at("projectId"))throw std::runtime_error("not lab");
#ifdef CAPSYNC_PRODUCT_RUNTIME
        ExplorerProject::metadata(QJsonDocument::fromJson(QByteArray::fromStdString(meta.dump())).object(),QString::fromStdString(job.at("metaPath").get<std::string>()));
        const auto currentLocation=ExplorerSession::current().location;
        if(QFileInfo(QString::fromStdString(job.at("storePath").get<std::string>())).canonicalFilePath().compare(currentLocation+QStringLiteral("/draft_virtual_store.json"),Qt::CaseInsensitive))throw std::runtime_error("different folder document");
        if(!job.value("requireMissing",true))throw std::runtime_error("product removal requires absent source");
#endif
        Json expectedMeta=job.at("baselineMeta"),comparable=meta;
        expectedMeta.erase("tm_draft_modified");comparable.erase("tm_draft_modified");
        if(comparable!=expectedMeta)throw std::runtime_error("saved registry changed");
        std::ifstream folderFile(std::filesystem::u8path(job.at("storePath").get<std::string>()));Json folders;folderFile>>folders;
        if(folders!=job.at("baselineStore"))throw std::runtime_error("saved folder map changed");
        const auto path=QString::fromStdString(job.at("expectedPath").get<std::string>());
        const auto diskRoot=QFileInfo(path).dir().canonicalPath();
#ifdef CAPSYNC_MEDIA_PATH
        const auto bindingRoot=QFileInfo(QString::fromStdString(job.at("rootPath").get<std::string>())).canonicalFilePath();
        const auto mediaKind=ExplorerMedia::kind(QFileInfo(path).suffix());
        const auto normalized=QDir::cleanPath(path);
        if(bindingRoot.isEmpty() ||
#ifndef CAPSYNC_PRODUCT_RUNTIME
           !bindingRoot.contains(QStringLiteral("/research/fixtures/AutoAddLab"),Qt::CaseInsensitive) ||
#endif
           (!diskRoot.startsWith(bindingRoot+QLatin1Char('/'),Qt::CaseInsensitive) && diskRoot.compare(bindingRoot,Qt::CaseInsensitive)) ||
           !normalized.startsWith(bindingRoot+QLatin1Char('/'),Qt::CaseInsensitive) || mediaKind.isEmpty())throw std::runtime_error("outside laboratory source binding");
        if(job.value("requireMissing",true)) {
            if(QFileInfo::exists(path))throw std::runtime_error("source returned before unused deletion");
        }
#ifdef CAPSYNC_FINAL_UNUSED_FIXTURE
        else if(!bindingRoot.endsWith(QStringLiteral("/ExplorerRuntime/FinalUsedChecks-20261020"),Qt::CaseInsensitive) || QFileInfo(path).fileName()!=QStringLiteral("verified-restored.wav") || materialId!="347c9658-7cc0-4e87-b688-581fe9bfc758" || !QFileInfo(path).isFile())throw std::runtime_error("final unused removal is exact restored WAV only");
#elif defined(CAPSYNC_USED_FIXTURE_REMOVAL)
        else if(!bindingRoot.endsWith(QStringLiteral("/ExplorerRuntime/FinalUsedChecks-20261020"),Qt::CaseInsensitive) || QFileInfo(path).fileName()!=QStringLiteral("verified-used.wav") || materialId!=UsedFixture::card || !QFileInfo(path).isFile())throw std::runtime_error("used removal is exact new WAV fixture only");
#else
        else if(!bindingRoot.endsWith(QStringLiteral("/ExplorerRuntime/RemovalChecks-20261020"),Qt::CaseInsensitive) || !QFileInfo(path).isFile())throw std::runtime_error("manual removal simulation is fixture-only");
#endif
        const auto parentId=job.at("parentId").get<std::string>();
#else
        if(QFileInfo(path).fileName()!=QStringLiteral("release-probe.wav") || !diskRoot.endsWith(QStringLiteral("/research/fixtures/AutoAddLab")) || QFileInfo::exists(path))
            throw std::runtime_error("unused source must be reserved outside the lab root first");
#endif
        int rowCount=0,aliases=0,edges=0;
        for(const auto& group:meta.at("draft_materials"))for(const auto& value:group.at("value")){
            if(value.value("file_Path",std::string())==job.at("expectedPath"))++aliases;
            if(value.at("id")==materialId){
                ++rowCount;
                if(value.at("type")!=0 || value.at("metetype")!=
#ifdef CAPSYNC_MEDIA_PATH
                   mediaKind.toStdString() ||
#else
                   "music" ||
#endif
                   value.at("file_Path")!=job.at("expectedPath"))throw std::runtime_error("control registry differs");
            }
        }
        for(const auto& group:folders.at("draft_virtual_store"))if(group.at("type")==1)for(const auto& edge:group.at("value"))
            if(edge.at("child_id")==materialId){if(edge.at("parent_id")!=
#ifdef CAPSYNC_MEDIA_PATH
                parentId
#else
                "f3fd343f-a805-42f7-9109-49e1dc8da258"
#endif
                )throw std::runtime_error("saved control folder changed");++edges;}
        if(rowCount!=1 || aliases!=1 || edges!=1)throw std::runtime_error("control ownership is ambiguous");
        // Exact active project SDK store identity, using the V14-proven route.
        using SharedGet=void*(__fastcall*)(quintptr,std::shared_ptr<void>*);
        using StoreIdGet=std::string*(__fastcall*)(quintptr,std::string*);
        std::shared_ptr<void> activeProject,activeStore;
        reinterpret_cast<SharedGet>(creator+0x4bbaf60)(creator+0xebb65b0,&activeProject);
        if(!activeProject)throw std::runtime_error("active project absent");
        reinterpret_cast<SharedGet>(creator+0x2730010)(reinterpret_cast<quintptr>(activeProject.get()),&activeStore);
        const auto storeIdEntry=GetProcAddress(sdk,sdkStoreIdName);
        if(!activeStore || reinterpret_cast<quintptr>(storeIdEntry)!=reinterpret_cast<quintptr>(sdk)+sdkStoreIdRva)throw std::runtime_error("store identity export mismatch");
        std::string activeId;
        reinterpret_cast<StoreIdGet>(storeIdEntry)(reinterpret_cast<quintptr>(activeStore.get()),&activeId);
        if(activeId!=job.at("projectId").get<std::string>())throw std::runtime_error("different active SDK project");
        using Get=std::shared_ptr<void>*(__fastcall*)(std::shared_ptr<void>*,int);
        using VirtualGet=void*(__fastcall*)(quintptr,std::shared_ptr<void>*);
        std::shared_ptr<void> manager,opaque;
        reinterpret_cast<Get>(creator+0x63d59b0)(&manager,1);
        if(!manager)throw std::runtime_error("manager absent");
        const auto address=reinterpret_cast<quintptr>(manager.get());
        const auto getter=read<quintptr>(read<quintptr>(address)+0x70);
        if(getter<creator || getter>=creator+0x7000000)throw std::runtime_error("getter bounds");
        reinterpret_cast<VirtualGet>(getter)(address,&opaque);
        if(!opaque)throw std::runtime_error("owner absent");
        const auto container=reinterpret_cast<quintptr>(opaque.get());
        const auto begin=read<quintptr>(container+8),end=read<quintptr>(container+0x10);
        if(end-begin!=16)throw std::runtime_error("exactly one lab timeline required");
        const auto holder=read<quintptr>(begin);
        const auto root=read<quintptr>(holder);
        if(read<quintptr>(root)!=reinterpret_cast<quintptr>(sdk)+job.at("draftVtableRva").get<quintptr>())throw std::runtime_error("not the proven SDK Draft type");
        const auto owner=*reinterpret_cast<const std::shared_ptr<void>*>(holder);
        using TextGet=const std::string&(__fastcall*)(void*);
        using ListGet=const List&(__fastcall*)(void*);
        using TypeGet=const int&(__fastcall*)(void*);
        using MaterialGet=const std::shared_ptr<void>&(__fastcall*)(void*);
        using SaveDraft=std::string*(__fastcall*)(std::string*,const std::shared_ptr<void>&);
        using FromJson=void(__fastcall*)(void*,const Json&);
        using TextSet=void(__fastcall*)(void*,const std::string&);
        const auto keys=job.at("exports");
        const auto getId=entry<TextGet>(sdk,keys,"nodeId");
        if(getId(owner.get())!=job.at("baselineTimeline").at("id").get<std::string>())throw std::runtime_error("root identity differs");
        const auto saveDraft=entry<SaveDraft>(sdk,keys,"saveDraft");
        const auto serialize=[&](){std::string text;saveDraft(&text,owner);return Json::parse(text);};
        const auto before=serialize();
        if(before!=job.at("baselineTimeline")){
            result["baselineDelta"]=Json::diff(job.at("baselineTimeline"),before);
            throw std::runtime_error("live SDK draft differs from saved baseline");
        }
#ifdef CAPSYNC_MEDIA_PATH
#ifdef CAPSYNC_USED_FIXTURE_REMOVAL
        const UsedFixture::Scope usedScope(before);
#else
        const auto serialized=QString::fromStdString(before.dump()).toCaseFolded();
        if(serialized.contains(QFileInfo(path).fileName().toCaseFolded()) || serialized.contains(QString::fromStdString(materialId).toCaseFolded()))throw std::runtime_error("source occurs in the live timeline; removal refused");
#endif
        const auto text=meta.dump();
        BinSnapshot sdkBin(creator,QJsonDocument::fromJson(QByteArray(text.data(),static_cast<qsizetype>(text.size()))).object());
#else
        if(before.dump().find("release-probe.wav")!=std::string::npos)throw std::runtime_error("source occurs in the live timeline; removal refused");
#endif
        const auto service=read<quintptr>(creator+0xec16c18),current=read<quintptr>(service+0x70);
        auto* tree=reinterpret_cast<QObject*>(read<quintptr>(current+0x30));
        if(!tree || std::string(tree->metaObject()->className())!="FileMetaDataTree")throw std::runtime_error("tree absent");
        auto* grid=tree->parent();
        if(!grid || std::string(grid->metaObject()->className())!="LocalMediaInfoGridViewModel" || read<int>(reinterpret_cast<quintptr>(grid)+0x3c8)!=0)
            throw std::runtime_error("ordinary bin grid absent");
        auto nodeId=[&](QObject* node){return *reinterpret_cast<const std::string*>(read<quintptr>(reinterpret_cast<quintptr>(node)+0x10));};
        std::vector<QObject*> pending;for(auto* n:tree->children())pending.push_back(n);
        QObject* target=nullptr;unsigned visited=0;
        while(!pending.empty()){
            auto* n=pending.back();pending.pop_back();
            if(++visited>ExplorerLimits::materialCount || std::string(n->metaObject()->className())!="FileMetaDataNode" || read<quintptr>(reinterpret_cast<quintptr>(n)+0x30)!=reinterpret_cast<quintptr>(tree))
                throw std::runtime_error("tree ownership differs");
            if(nodeId(n)==materialId){if(target)throw std::runtime_error("duplicate control node");target=n;}
            for(auto* child:n->children())pending.push_back(child);
        }
        if(!target || !target->children().isEmpty() || !target->parent() || nodeId(target->parent())!=
#ifdef CAPSYNC_MEDIA_PATH
           parentId
#else
           "f3fd343f-a805-42f7-9109-49e1dc8da258"
#endif
           )
            throw std::runtime_error("native control is outside its exact folder");
        const auto data=read<quintptr>(reinterpret_cast<quintptr>(target)+0x10);
        if(*reinterpret_cast<const std::string*>(data+0x58)!=job.at("expectedPath").get<std::string>())throw std::runtime_error("native control path changed");
        using Query=void*(__fastcall*)(quintptr,std::shared_ptr<void>*,const int&,const std::string&);
        auto query=reinterpret_cast<Query>(GetProcAddress(sdk,sdkQueryName));
        if(reinterpret_cast<quintptr>(query)!=reinterpret_cast<quintptr>(sdk)+sdkQueryRva)throw std::runtime_error("SDK query export differs");
        const int kind=0;std::shared_ptr<void> material;
        query(reinterpret_cast<quintptr>(activeStore.get()),&material,kind,materialId);
        if(!material)throw std::runtime_error("owned SDK bin material absent");
        int methodIndex=-1;
        for(int i=grid->metaObject()->methodOffset();i<grid->metaObject()->methodCount();++i){
            const auto m=grid->metaObject()->method(i);
            if(m.name()=="onRemoveSelectedChildNodes" && m.parameterTypes()==QList<QByteArray>{"std::vector<QPointer<FileMetaDataNode>>"}){
                if(methodIndex!=-1)throw std::runtime_error("remove method ambiguous");methodIndex=i;
            }
        }
        if(methodIndex<0)throw std::runtime_error("confirmed remove slot absent");
        result["wholeSdkDraftExact"]=true;result["scopeReady"]=true;
        if(job.at("action")=="preview"){result["status"]="ready";}
        else if(job.at("action")=="remove"){
            POINT cursorBefore{},cursorAfter{};GetCursorPos(&cursorBefore);
            const auto foreground=GetForegroundWindow();auto* focus=QGuiApplication::focusObject();
            using ResourceManagerGet=quintptr(__fastcall*)();
            using ResourceModelGet=quintptr(__fastcall*)(quintptr,QObject*);
            const auto resources=reinterpret_cast<ResourceManagerGet>(creator+0x1bf3d80)();
            if(!resources || !reinterpret_cast<ResourceModelGet>(creator+0x1bf3e30)(resources,target))throw std::runtime_error("owned resource model absent");
            std::vector<QPointer<QObject>> selected{QPointer<QObject>(target)};
            static_assert(sizeof(QPointer<QObject>)==16 && sizeof(selected)==24,"Qt/MSVC pointer-vector ABI differs");
            const auto method=grid->metaObject()->method(methodIndex);const auto parameter=method.parameterTypes().at(0);
#ifdef CAPSYNC_EXPLORER_RUNTIME
            ExplorerRuntime::check(r.lease);
#endif
            result["mutationDispatched"]=true;result["status"]="unknown";
            if(!method.invoke(grid,Qt::DirectConnection,QGenericArgument(parameter.constData(),&selected)))throw std::runtime_error("remove invocation failed");
#ifdef CAPSYNC_USED_FIXTURE_REMOVAL
            const auto after=serialize();result["wholeSdkDraftExact"]=usedScope.check(before,after);result["controlledUsedFixtureRemoval"]=true;result["afterTimeline"]=after;
#else
            result["wholeSdkDraftExact"]=serialize()==before;
#endif
            if(!result["wholeSdkDraftExact"].get<bool>())throw std::runtime_error("timeline changed during unused removal");
#ifdef CAPSYNC_MEDIA_PATH
            auto expectedBin=sdkBin.before;expectedBin.erase(materialId);
            if(BinSnapshot::withoutStockService(sdkBin.capture())!=BinSnapshot::withoutStockService(expectedBin))throw std::runtime_error("unrelated SDK bin material changed during unused removal");
            result["fullSdkBinPreserved"]=true;
#endif
            GetCursorPos(&cursorAfter);
            result["navigationUnchanged"]=current==read<quintptr>(service+0x70);
            result["foregroundUnchanged"]=foreground==GetForegroundWindow();result["focusUnchanged"]=focus==QGuiApplication::focusObject();
            result["cursorUnchanged"]=cursorBefore.x==cursorAfter.x && cursorBefore.y==cursorAfter.y;
            result["status"]="dispatched";result["route"]="onRemoveSelectedChildNodes explicit one-element vector";
        }else throw std::runtime_error("unsupported remove action");
    }catch(const std::exception& e){result["reason"]=e.what();}
    QSaveFile out(QString::fromWCharArray(r.output));
    if(out.open(QIODevice::WriteOnly)){const auto text=result.dump(2);out.write(text.data(),static_cast<qint64>(text.size()));out.commit();}
}
extern "C" __declspec(dllexport) DWORD WINAPI CapSync_SourcePath(LPVOID raw){
    const auto* r=static_cast<const Request*>(raw);
    if(!r || r->size!=sizeof(Request) || r->version!=1 || !std::wmemchr(r->input,0,1024) || !std::wmemchr(r->output,0,1024))return 2;
    auto* app=QCoreApplication::instance();if(!app)return 3;
    HMODULE pinned=nullptr;
    if(!GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS|GET_MODULE_HANDLE_EX_FLAG_PIN,reinterpret_cast<LPCWSTR>(&CapSync_SourcePath),&pinned))return 4;
    const Request copy=*r;
    return QMetaObject::invokeMethod(app,[copy]{perform(copy);},Qt::QueuedConnection)?1:5;
}
BOOL WINAPI DllMain(HINSTANCE instance,DWORD reason,LPVOID){if(reason==DLL_PROCESS_ATTACH)DisableThreadLibraryCalls(instance);return TRUE;}
