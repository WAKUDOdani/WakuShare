// Final lab acceptance of the offline-proven SDK source operations.
// The V15 container interpretation is not used; the holder indirection is
// validated against the exact native-owner read and SDK Draft vtable.
#include "../CapSync.NativeProbe/qt62_compat.h"
#include <Windows.h>
#include <QtCore/QCoreApplication>
#include <QtCore/QFile>
#include <QtCore/QThread>
#include <QtCore/QSaveFile>
#include <memory>
#include <vector>
#include <string>
#include <cwchar>
#include <filesystem>
#include <fstream>
#include <algorithm>
#include <cwctype>
#include "../../vendor/nlohmann-3.10.5/json.hpp"
#include "../CapSync.NativeRelink/sdk_exports.h"
#ifdef CAPSYNC_MEDIA_PATH
#include "../CapSync.NativeExplorerObserve/media_formats.h"
#endif
#ifdef CAPSYNC_EXPLORER_RUNTIME
#include "../CapSync.NativeExplorerObserve/runtime_guard.h"
#endif
using Json=nlohmann::json;
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
        const auto sourceId=job.at("sourceId").get<std::string>();
#ifdef CAPSYNC_MEDIA_PATH
        const auto mediaGroup=job.at("mediaGroup").get<std::string>();
        if(mediaGroup!="audios" && mediaGroup!="videos")throw std::runtime_error("unknown media group");
        const bool isAudio=mediaGroup=="audios";
#else
        const bool isAudio=false; // Two existing still-image controls only.
#endif
#ifdef CAPSYNC_PRODUCT_RUNTIME
        if(QString::fromStdString(job.at("projectId").get<std::string>()).toUpper()!=ExplorerSession::current().draftId)throw std::runtime_error("different active project");
#else
        if(job.at("projectId")!="582F1BF9-2B25-4cf2-B83F-3528F1B868B2")throw std::runtime_error("not lab project");
#endif
#ifndef CAPSYNC_GENERAL_PHOTO_PATH
        if(!isAudio && sourceId!="1AAA761D-0CAD-41D3-A0F1-2ED4EE845DC7" && sourceId!="92AA99ED-8EF3-45E7-8EEC-AD9EB27C6A53")throw std::runtime_error("isolated accepted source controls only");
#endif
        const char* group=isAudio?"audios":"videos";
        const char* nameField=isAudio?"name":"material_name";
        std::ifstream metadata(std::filesystem::u8path(job.at("metaPath").get<std::string>()));Json meta;metadata>>meta;
        if(meta.at("draft_id")!=job.at("projectId"))throw std::runtime_error("not lab");
#ifdef CAPSYNC_PRODUCT_RUNTIME
        const auto metadataText=meta.dump();
        ExplorerProject::metadata(QJsonDocument::fromJson(QByteArray::fromStdString(metadataText)).object(),QString::fromStdString(job.at("metaPath").get<std::string>()));
#endif
        const auto source=std::filesystem::u8path(job.at("newPath").get<std::string>());
        if(!std::filesystem::is_regular_file(source))throw std::runtime_error("source file absent");
#ifndef CAPSYNC_GENERAL_PHOTO_PATH
        if(source.filename().u8string().find("metadata-path-control-")!=0)throw std::runtime_error("control file absent");
#endif
        const auto priorPath=std::filesystem::u8path(job.at("restoreProperties").at("path").get<std::string>());
#ifdef CAPSYNC_GENERAL_PHOTO_PATH
        const auto bindingRoot=std::filesystem::weakly_canonical(std::filesystem::u8path(job.at("rootPath").get<std::string>()));
        const auto insideRoot=[&](const std::filesystem::path& path,const std::filesystem::path& selectedRoot){
            const auto rel=std::filesystem::weakly_canonical(path).lexically_relative(selectedRoot);
            return !rel.empty() && !rel.is_absolute() && *rel.begin()!=L".." && rel!=L".";
        };
#ifdef CAPSYNC_PRODUCT_RUNTIME
        const auto destinationRoot=std::filesystem::weakly_canonical(std::filesystem::u8path(job.at("destinationRootPath").get<std::string>()));
        if(!std::filesystem::is_directory(bindingRoot) || !std::filesystem::is_directory(destinationRoot) || !insideRoot(source,destinationRoot))throw std::runtime_error("destination outside selected binding");
#else
        if(bindingRoot.filename()!=L"AutoAddLab" || !insideRoot(source,bindingRoot))throw std::runtime_error("source outside laboratory root");
#endif
        const auto extension=[](const std::filesystem::path& path){auto value=path.extension().wstring();
            std::transform(value.begin(),value.end(),value.begin(),[](wchar_t c){return static_cast<wchar_t>(std::towlower(c));});return value;};
        const auto ext=extension(priorPath);
#ifdef CAPSYNC_MEDIA_PATH
        const auto mediaKind=ExplorerMedia::kind(QString::fromStdWString(ext));
        const auto sourceType=job.at("restoreProperties").at("type").get<std::string>();
#ifdef CAPSYNC_LOCAL_AUDIO_TYPES
        const auto localId=job.at("restoreProperties").value("local_material_id",std::string());bool ownedLocal=localId==job.at("materialId").get<std::string>();
#ifdef CAPSYNC_RETIRED_LOCAL_AUDIO
        const auto retired=job.value("ownedRetiredMaterialIds",Json::array());if(!retired.is_array() || retired.size()>16)throw std::runtime_error("retired local identity bound changed");
        for(const auto& id:retired){
            const auto identifier=id.get<std::string>();if(identifier.empty())throw std::runtime_error("empty retired local identity");
            for(const auto& binGroup:meta.at("draft_materials"))for(const auto& row:binGroup.at("value"))if(row.at("id")==identifier)throw std::runtime_error("retired local identity still has a bin owner");
            if(identifier==localId)ownedLocal=true;
        }
#endif
#endif
        const bool typedSource=(mediaKind==QStringLiteral("music") && isAudio && (sourceType=="music"
#ifdef CAPSYNC_LOCAL_AUDIO_TYPES
            || (sourceType=="extract_music" && ownedLocal)
#endif
            )) ||
            (mediaKind==QStringLiteral("photo") && !isAudio && sourceType=="photo") ||
            ((mediaKind==QStringLiteral("video") || mediaKind==QStringLiteral("gif")) && !isAudio && (sourceType=="video" || sourceType=="gif"));
        if(!insideRoot(priorPath,bindingRoot) || mediaKind.isEmpty() ||
           extension(source)!=ext || job.at("restoreProperties").at("id")!=sourceId || !typedSource)
#else
        if(!insideRoot(priorPath,bindingRoot) ||
           (ext!=L".png" && ext!=L".jpg" && ext!=L".jpeg") || extension(source)!=ext ||
           job.at("restoreProperties").at("id")!=sourceId || job.at("restoreProperties").at("type")!="photo")
#endif
            throw std::runtime_error("outside owned same-format lab photo paths");
        size_t binMatches=0,sourceMatches=0;
        const auto sameWindowsPath=[](const std::filesystem::path& left,const std::filesystem::path& right){
#ifdef CAPSYNC_WINDOWS_PATH_CASE
            const auto a=left.lexically_normal().wstring(),b=right.lexically_normal().wstring();
            return CompareStringOrdinal(a.c_str(),static_cast<int>(a.size()),b.c_str(),static_cast<int>(b.size()),TRUE)==CSTR_EQUAL;
#else
            return left.lexically_normal()==right.lexically_normal();
#endif
        };
        for(const auto& binGroup:meta.at("draft_materials"))for(const auto& item:binGroup.at("value"))
            if(item.at("id")==job.at("materialId")){
                if(
#ifdef CAPSYNC_MEDIA_PATH
                   item.at("metetype").get<std::string>()!=mediaKind.toStdString() ||
#else
                   item.at("metetype")!="photo" ||
#endif
                   !sameWindowsPath(std::filesystem::u8path(item.at("file_Path").get<std::string>()),priorPath))
                    throw std::runtime_error("photo bin ownership differs");
                ++binMatches;
            }
        for(const auto& item:job.at("baselineTimeline").at("materials").at(group))if(item.at("id")==sourceId){
            if(item!=job.at("restoreProperties"))throw std::runtime_error("general photo path cannot repair or reset source properties");
            ++sourceMatches;
        }
        if(binMatches!=1 || sourceMatches!=1)throw std::runtime_error("photo source or bin UUID absent or duplicated");
#elif defined(CAPSYNC_SINGLE_PNG_MOVE)
        const auto base=priorPath.parent_path().parent_path();
        if(sourceId!="1AAA761D-0CAD-41D3-A0F1-2ED4EE845DC7" ||
           priorPath.filename()!=L"metadata-path-control-still-png-renamed.png" ||
           priorPath.parent_path().filename()!=L"ReleaseCheck" || base.filename()!=L"AutoAddLab" ||
           source.lexically_normal()!=(base/L"NestedAlpha"/L"Shared"/priorPath.filename()).lexically_normal())
            throw std::runtime_error("isolated single-card PNG folder move only");
#elif defined(CAPSYNC_PNG_MOVE)
        if(sourceId!="1AAA761D-0CAD-41D3-A0F1-2ED4EE845DC7" ||
           priorPath.filename()!=L"metadata-path-control-still-png-renamed.png" ||
           priorPath.parent_path().filename()!=L"Shared" ||
           priorPath.parent_path().parent_path().filename()!=L"ReleaseCheck" ||
           priorPath.parent_path().parent_path().parent_path().filename()!=L"AutoAddLab" ||
           source.lexically_normal()!=(priorPath.parent_path().parent_path()/priorPath.filename()).lexically_normal())
            throw std::runtime_error("isolated Shared-to-ReleaseCheck PNG move only");
#elif defined(CAPSYNC_JPEG_MOVE)
        if(sourceId!="92AA99ED-8EF3-45E7-8EEC-AD9EB27C6A53" ||
           priorPath.filename()!=L"metadata-path-control-root-jpeg-synced.jpg" ||
           priorPath.parent_path().filename()!=L"AutoAddLab" ||
           source.lexically_normal()!=(priorPath.parent_path()/L"ReleaseCheck"/L"Shared"/priorPath.filename()).lexically_normal())
            throw std::runtime_error("isolated root-to-Shared JPEG move only");
#else
        if(priorPath.parent_path()!=source.parent_path() || priorPath.extension()!=source.extension())throw std::runtime_error("same-folder same-format control required");
#endif
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
        std::shared_ptr<void> target;
        for(const auto& track:entry<ListGet>(sdk,keys,"draftTracks")(owner.get())){
            if(entry<TypeGet>(sdk,keys,"trackType")(track.get())!=(isAudio?2:1))continue;
            for(const auto& segment:entry<ListGet>(sdk,keys,"trackSegments")(track.get())){
                const auto& material=entry<MaterialGet>(sdk,keys,isAudio?"audioMaterial":"videoMaterial")(segment.get());
                if(material && getId(material.get())==job.at("sourceId").get<std::string>()){
                    if(target && target!=material)throw std::runtime_error("source alias differs");
                    target=material;
                }
            }
        }
        if(!target)throw std::runtime_error("owned source absent");
        Json expected=before;
#ifndef CAPSYNC_GENERAL_PHOTO_PATH
        for(auto& item:expected["materials"][group])
            if(item["id"]==job.at("sourceId"))item=job.at("restoreProperties");
        result["mutationDispatched"]=true;result["status"]="unknown";
        entry<FromJson>(sdk,keys,isAudio?"audioFromJson":"videoFromJson")(target.get(),job.at("restoreProperties"));
        if(serialize()!=expected)throw std::runtime_error("source repair differs");
        result["sourceRepairExact"]=true;
#else
        // Exact current properties were checked above. No FromJSON/template
        // repair is needed or allowed for a generic owned path update.
        result["mutationDispatched"]=true;result["status"]="unknown";
        result["sourceRepairSkipped"]=true;
#endif
        entry<TextSet>(sdk,keys,isAudio?"audioSetPath":"videoSetPath")(target.get(),job.at("newPath").get<std::string>());
        const auto newName=job.at("newName").get<std::string>();
        entry<TextSet>(sdk,keys,isAudio?"audioSetName":"videoSetName")(target.get(),newName);
        for(auto& item:expected["materials"][group])
            if(item["id"]==job.at("sourceId")){item["path"]=job.at("newPath");item[nameField]=newName;}
        const auto after=serialize();
        result["wholeSdkDraftExact"]=after==expected;
        if(after!=expected){result["delta"]=Json::diff(expected,after);throw std::runtime_error("narrow path change differs");}
        result["status"]="changed";
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
