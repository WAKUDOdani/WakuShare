#include "../CapSync.NativeExplorerObserve/material_limits.h"
// Isolated lab: preserve identities of explicit aliases of one exact source path.
#include "../CapSync.NativeProbe/qt62_compat.h"
#include <Windows.h>
#include <QtCore/QCoreApplication>
#include <QtCore/QThread>
#include <QtCore/QFile>
#include <QtCore/QFileInfo>
#include <QtCore/QDir>
#include <QtCore/QJsonDocument>
#include <QtCore/QJsonObject>
#include <QtCore/QJsonArray>
#include <QtCore/QSaveFile>
#include <QtCore/QPointer>
#ifdef CAPSYNC_STOCK_BIN_TITLES
#include <QtCore/QMetaProperty>
#endif
#include <QtCore/QFuture>
#include <QtCore/QMap>
#include <QtCore/QCryptographicHash>
#include <QtGui/QGuiApplication>
#include <cstring>
#include <cwchar>
#include <string>
#include <map>
#include <set>
#include <memory>
#include <vector>
#include <stdexcept>
#include <functional>
#ifdef CAPSYNC_EXPLORER_RUNTIME
#include "../CapSync.NativeExplorerObserve/runtime_guard.h"
#endif
#include "../CapSync.NativeRelink/sdk_exports.h"
#ifdef CAPSYNC_MEDIA_PATH
#include "../CapSync.NativeExplorerObserve/media_formats.h"
#endif
#ifdef CAPSYNC_PRESERVE_BIN_LABELS
#include "../CapSync.NativeAdd/bin_snapshot.h"
#endif


struct Request {
    unsigned size,version,action;
    wchar_t oldPath[1024],newPath[1024],root[1024],meta[1024],output[1024];
    char jobId[37],materialId[37],sha256[65];
    char aliasesJson[1024];
#ifdef CAPSYNC_EXPLORER_RUNTIME
    ExplorerRuntimeLease lease;
#endif
#ifdef CAPSYNC_EXPLICIT_BIN_LABELS
    char desiredLabelsJson[16384];
#endif
#ifdef CAPSYNC_PRODUCT_RUNTIME
    wchar_t previousRoot[1024];
#endif
};
namespace {
template<class T>T read(quintptr address){
    T value{};SIZE_T copied=0;
    if(address<0x10000 || !ReadProcessMemory(GetCurrentProcess(),reinterpret_cast<LPCVOID>(address),&value,sizeof(value),&copied) || copied!=sizeof(value))
        throw std::runtime_error("memory changed");
    return value;
}
QObject* object(quintptr address,const char* type){
    const auto data=read<quintptr>(address+8);
    if(read<quintptr>(data+8)!=address || (read<unsigned>(data+48)&0x0c))throw std::runtime_error("object lifetime changed");
    auto* result=reinterpret_cast<QObject*>(address);
    if(std::strcmp(result->metaObject()->className(),type))throw std::runtime_error("object type mismatch");
    return result;
}
QByteArray string(quintptr address){
    const auto length=read<quintptr>(address+16),capacity=read<quintptr>(address+24);
    if(length>4096 || capacity<length || capacity>1024*1024)throw std::runtime_error("invalid native string");
    QByteArray result(static_cast<qsizetype>(length),'\0');SIZE_T copied=0;
    if(length && (!ReadProcessMemory(GetCurrentProcess(),reinterpret_cast<LPCVOID>(capacity<16?address:read<quintptr>(address)),result.data(),length,&copied) || copied!=length))
        throw std::runtime_error("string unreadable");
    return result;
}
QByteArray id(QObject* node){return string(read<quintptr>(reinterpret_cast<quintptr>(node)+0x10));}
QString normalized(const QString& value){return QDir::cleanPath(QFileInfo(value).absoluteFilePath());}
template<class T>T sdkExport(HMODULE module,const char* name,quintptr rva){
    const auto entry=GetProcAddress(module,name);
    if(!entry || reinterpret_cast<quintptr>(entry)!=reinterpret_cast<quintptr>(module)+rva)throw std::runtime_error("SDK export mismatch");
    return reinterpret_cast<T>(entry);
}
void save(const Request& request,QJsonObject result){
    result.insert("jobId",QString::fromLatin1(request.jobId));
    QSaveFile file(QString::fromWCharArray(request.output));
    if(file.open(QIODevice::WriteOnly)){file.write(QJsonDocument(result).toJson());file.commit();}
}
void perform(Request request){
    bool mutated=false;
    try{
        if(QThread::currentThread()!=QCoreApplication::instance()->thread())throw std::runtime_error("wrong thread");
#ifdef CAPSYNC_EXPLORER_RUNTIME
        ExplorerRuntime::check(request.lease);
#endif
        const auto oldPath=normalized(QString::fromWCharArray(request.oldPath)),newPath=normalized(QString::fromWCharArray(request.newPath));
        const auto root=QFileInfo(QString::fromWCharArray(request.root)).canonicalFilePath();
#ifdef CAPSYNC_PRODUCT_RUNTIME
        const auto previousRoot=QFileInfo(QString::fromWCharArray(request.previousRoot)).canonicalFilePath();
        if(previousRoot.isEmpty() || !oldPath.startsWith(previousRoot+QLatin1Char('/'),Qt::CaseInsensitive))throw std::runtime_error("previous path outside selected source binding");
#endif
        // V13 also follows the stock source relink command for used timelines.
        // No direct metadata/SDK path assignments are performed.
        // Existing conflicted materials and
        // the production watcher cannot use this new write path.
        const auto control=QByteArray(request.materialId);
#ifdef CAPSYNC_GENERAL_PHOTO_PATH
        if(
#ifdef CAPSYNC_STOCK_BIN_TITLES
           (request.action!=0 && request.action!=3) ||
#else
           request.action!=3 ||
#endif
           control.size()!=36 ||
           QFileInfo(oldPath).suffix().compare(QFileInfo(newPath).suffix(),Qt::CaseInsensitive) ||
#ifdef CAPSYNC_MEDIA_PATH
           ExplorerMedia::kind(QFileInfo(newPath).suffix()).isEmpty())
#else
           !(QStringList{QStringLiteral("png"),QStringLiteral("jpg"),QStringLiteral("jpeg")}.contains(QFileInfo(newPath).suffix().toLower())))
#endif
            throw std::runtime_error("owned same-format lab photo paths only");
#elif defined(CAPSYNC_SINGLE_PNG_MOVE)
        if(request.action!=3 || control!="4195482C-1347-423E-8A4A-34771C25E21E" ||
           oldPath.compare(root+QStringLiteral("/ReleaseCheck/metadata-path-control-still-png-renamed.png"),Qt::CaseInsensitive) ||
           newPath.compare(root+QStringLiteral("/NestedAlpha/Shared/metadata-path-control-still-png-renamed.png"),Qt::CaseInsensitive))
            throw std::runtime_error("isolated single-card PNG folder move only");
#elif defined(CAPSYNC_PNG_MOVE)
        if(request.action!=3 || control!="c024b416-3002-4de9-9ab8-7e39d7148523" ||
           oldPath.compare(root+QStringLiteral("/ReleaseCheck/Shared/metadata-path-control-still-png-renamed.png"),Qt::CaseInsensitive) ||
           newPath.compare(root+QStringLiteral("/ReleaseCheck/metadata-path-control-still-png-renamed.png"),Qt::CaseInsensitive))
            throw std::runtime_error("isolated Shared-to-ReleaseCheck PNG move only");
#elif defined(CAPSYNC_SAME_PATH_JPEG)
        if(request.action!=3 || control!="92AA99ED-8EF3-45E7-8EEC-AD9EB27C6A53" ||
           oldPath.compare(newPath,Qt::CaseInsensitive) ||
           !newPath.endsWith(QStringLiteral("/research/fixtures/AutoAddLab/ReleaseCheck/Shared/metadata-path-control-root-jpeg-synced.jpg"),Qt::CaseInsensitive))
            throw std::runtime_error("isolated same-path JPEG refresh only");
#else
        if(request.action!=3 || (control!="c024b416-3002-4de9-9ab8-7e39d7148523" && control!="92AA99ED-8EF3-45E7-8EEC-AD9EB27C6A53") ||
           !QFileInfo(newPath).fileName().startsWith(QStringLiteral("metadata-path-control-still-")) ||
           QFileInfo(oldPath).suffix()!=QFileInfo(newPath).suffix())
            throw std::runtime_error("isolated same-format still controls only");
#endif
        if(root.isEmpty() ||
#ifndef CAPSYNC_PRODUCT_RUNTIME
            !root.endsWith(QStringLiteral("/research/fixtures/AutoAddLab"),Qt::CaseInsensitive) || !oldPath.startsWith(root+QLatin1Char('/'),Qt::CaseInsensitive) ||
#endif
            !newPath.startsWith(root+QLatin1Char('/'),Qt::CaseInsensitive) ||
#if !defined(CAPSYNC_PNG_MOVE) && !defined(CAPSYNC_SINGLE_PNG_MOVE) && !defined(CAPSYNC_GENERAL_PHOTO_PATH)
            QFileInfo(oldPath).dir().absolutePath()!=QFileInfo(newPath).dir().absolutePath() ||
#endif
#ifdef CAPSYNC_MEDIA_PATH
            ExplorerMedia::kind(QFileInfo(newPath).suffix()).isEmpty())
#else
            !(QStringList{QStringLiteral("png"),QStringLiteral("jpg"),QStringLiteral("jpeg"),QStringLiteral("gif"),
                QStringLiteral("wav"),QStringLiteral("mp3"),QStringLiteral("mp4"),QStringLiteral("mov")}.contains(QFileInfo(newPath).suffix().toLower())))
#endif
            throw std::runtime_error("outside same-directory lab source scope");
        QFile source(newPath);
#ifdef CAPSYNC_PRESERVE_BIN_LABELS
        QCryptographicHash sourceHash(QCryptographicHash::Sha256);
        if(!source.open(QIODevice::ReadOnly) ||
#ifdef CAPSYNC_STOCK_BIN_TITLES
           (request.action!=0 &&
#endif
           (!sourceHash.addData(&source) || sourceHash.result().toHex()!=QByteArray(request.sha256).toLower())
#ifdef CAPSYNC_STOCK_BIN_TITLES
           )
#endif
          )
#else
        if(!source.open(QIODevice::ReadOnly) || QCryptographicHash::hash(source.readAll(),QCryptographicHash::Sha256).toHex()!=QByteArray(request.sha256).toLower())
#endif
            throw std::runtime_error("new source changed");
        QFile file(QString::fromWCharArray(request.meta));if(!file.open(QIODevice::ReadOnly))throw std::runtime_error("metadata missing");
        const auto meta=QJsonDocument::fromJson(file.readAll()).object();
#ifdef CAPSYNC_PRODUCT_RUNTIME
        ExplorerProject::metadata(meta,QString::fromWCharArray(request.meta));
#else
        if(meta.value("draft_id").toString()!=QStringLiteral("582F1BF9-2B25-4cf2-B83F-3528F1B868B2"))throw std::runtime_error("not lab project");
#endif
        QJsonObject row;int matches=0;
        for(const auto& group:meta.value("draft_materials").toArray())for(const auto& value:group.toObject().value("value").toArray()){
            const auto item=value.toObject();
            if(item.value("id").toString()==QString::fromLatin1(request.materialId)){row=item;++matches;}
        }
        if(matches!=1 || normalized(row.value("file_Path").toString()).compare(oldPath,Qt::CaseInsensitive))throw std::runtime_error("registry ownership mismatch");
        const auto creator=reinterpret_cast<quintptr>(GetModuleHandleW(L"VECreator.dll"));wchar_t image[1024]{};
        if(!GetModuleFileNameW(reinterpret_cast<HMODULE>(creator),image,1024) || QFileInfo(QString::fromWCharArray(image)).dir().dirName()!=QStringLiteral("9.6.0.4097"))
            throw std::runtime_error("unsupported build");
        const auto service=read<quintptr>(creator+0xec16c18),current=read<quintptr>(service+0x70),drop=read<quintptr>(service+0x78);
        object(current,"FileMetaDataNode");auto* tree=object(read<quintptr>(current+0x30),"FileMetaDataTree");
        auto* grid=object(reinterpret_cast<quintptr>(tree->parent()),"LocalMediaInfoGridViewModel");
        std::map<QByteArray,QObject*> nodes;std::vector<QObject*> pending;
        for(auto* node:tree->children())pending.push_back(node);
        while(!pending.empty()){
            auto* node=pending.back();pending.pop_back();object(reinterpret_cast<quintptr>(node),"FileMetaDataNode");
            if(read<quintptr>(reinterpret_cast<quintptr>(node)+0x30)!=reinterpret_cast<quintptr>(tree) || static_cast<std::size_t>(nodes.size())>ExplorerLimits::materialCount || !nodes.emplace(id(node),node).second)
                throw std::runtime_error("tree ownership invalid");
            for(auto* child:node->children())pending.push_back(child);
        }
#ifndef CAPSYNC_PRODUCT_RUNTIME
        for(const auto key:{"963b593d-fae8-4af9-a487-29f0e73c8be5","f3fd343f-a805-42f7-9109-49e1dc8da258","9fa014be-4728-46ff-aedc-3327a8cc6b63"})
            if(!nodes.count(key))throw std::runtime_error("different active tree");
#endif
        const auto selected=nodes.find(request.materialId);if(selected==nodes.end() || !selected->second->children().isEmpty())throw std::runtime_error("own leaf absent");
        auto* node=selected->second;
#ifndef CAPSYNC_EXPLORER_RUNTIME
        bool owned=false;
        for(auto* parent=node->parent();parent && parent!=tree;parent=parent->parent())if(id(parent)=="f3fd343f-a805-42f7-9109-49e1dc8da258")owned=true;
        if(!owned)throw std::runtime_error("leaf outside ManagedB");
#endif
        const auto data=read<quintptr>(reinterpret_cast<quintptr>(node)+0x10);
        const auto nativeOldPath=QString::fromUtf8(string(data+0x58)),oldName=QString::fromUtf8(string(data+0x98));
        const bool assigned=normalized(nativeOldPath).compare(newPath,Qt::CaseInsensitive)==0 && oldName==QFileInfo(newPath).fileName();
        if(normalized(nativeOldPath).compare(oldPath,Qt::CaseInsensitive) || oldName!=row.value("extra_info").toString())throw std::runtime_error("native metadata mismatch");
        (void)assigned;
        const auto sdk=GetModuleHandleW(L"videoeditor.dll");if(!sdk)throw std::runtime_error("SDK absent");
        using SharedGet=void*(__fastcall*)(quintptr,std::shared_ptr<void>*);
        std::shared_ptr<void> project,store,material;
        reinterpret_cast<SharedGet>(creator+0x4bbaf60)(creator+0xebb65b0,&project);
        if(!project)throw std::runtime_error("active project absent");
        reinterpret_cast<SharedGet>(creator+0x2730010)(reinterpret_cast<quintptr>(project.get()),&store);
        if(!store)throw std::runtime_error("active store absent");
        const auto wrapper=reinterpret_cast<quintptr>(store.get());
        using TextGet=std::string*(__fastcall*)(quintptr,std::string*);
        std::string storeId;
        sdkExport<TextGet>(sdk,sdkStoreIdName,sdkStoreIdRva)(wrapper,&storeId);
#ifdef CAPSYNC_PRODUCT_RUNTIME
        if(QString::fromStdString(storeId).toUpper()!=ExplorerSession::current().draftId){
#else
        if(storeId!="582F1BF9-2B25-4cf2-B83F-3528F1B868B2"){
#endif
            save(request,{{"status","rejected"},{"reason","active SDK store is not the lab"},{"sdkStoreId",QString::fromStdString(storeId)}});return;
        }
        using MaterialMap=std::map<int,std::vector<std::shared_ptr<void>>>;
        using QueryAll=MaterialMap*(__fastcall*)(quintptr,MaterialMap*);
        static_assert(sizeof(MaterialMap)==16,"unsupported map ABI");
        MaterialMap allMaterials;
        sdkExport<QueryAll>(sdk,sdkQueryAllName,sdkQueryAllRva)(wrapper,&allMaterials);
        if(allMaterials.empty() || allMaterials.size()>32)throw std::runtime_error("incomplete full material map");
        std::map<QByteArray,QJsonObject> registry;
        for(const auto& group:meta.value("draft_materials").toArray())for(const auto& value:group.toObject().value("value").toArray()){
            const auto item=value.toObject();
            if(!registry.emplace(item.value("id").toString().toLatin1(),item).second)throw std::runtime_error("duplicate registry ID");
        }
        std::set<QByteArray> completeIds;
        for(const auto& group:allMaterials)for(const auto& entry:group.second){
            if(!entry || completeIds.size()>=ExplorerLimits::materialCount)throw std::runtime_error("invalid full material map");
            const auto address=reinterpret_cast<quintptr>(entry.get());std::string identifier;
            sdkExport<TextGet>(sdk,sdkMaterialIdName,sdkMaterialIdRva)(address,&identifier);
            const auto identifierBytes=QByteArray::fromStdString(identifier);
            const auto saved=registry.find(identifierBytes);
#if defined(CAPSYNC_PRODUCT_RUNTIME) && CAPSYNC_PRODUCT_GENERATION >= 5
            if(identifierBytes=="cd484075-d92a-4bc9-b45c-d093d2f9e71b" && saved==registry.end()){
                if(group.first!=0 || !string(address).isEmpty() || !string(address+0xd0).isEmpty() || !completeIds.insert(identifierBytes).second)throw std::runtime_error("stock service SDK shape changed");
                continue;
            }
#endif
            if(!completeIds.insert(identifierBytes).second || saved==registry.end() || saved->second.value("type").toInt(-1)!=group.first ||
               normalized(QString::fromUtf8(string(address))).compare(normalized(saved->second.value("file_Path").toString()),Qt::CaseInsensitive) ||
               QString::fromUtf8(string(address+0xd0))!=saved->second.value("extra_info").toString())throw std::runtime_error("full SDK map differs from saved registry");
        }
#if defined(CAPSYNC_PRODUCT_RUNTIME) && CAPSYNC_PRODUCT_GENERATION >= 5
        const QByteArray serviceId("cd484075-d92a-4bc9-b45c-d093d2f9e71b");const auto savedService=registry.find(serviceId);
        const bool savedEmpty=savedService!=registry.end() && savedService->second.value("type").toInt(-1)==0 && savedService->second.value("metetype").toString()==QStringLiteral("none") && savedService->second.value("file_Path").toString().isEmpty() && savedService->second.value("extra_info").toString().isEmpty();
        if(completeIds.size()-completeIds.count(serviceId)!=registry.size()-(savedEmpty?1:0))throw std::runtime_error("full SDK map is missing saved entries");
#else
        if(completeIds.size()!=registry.size())throw std::runtime_error("full SDK map is missing saved entries");
#endif
        const int kind=row.value("type").toInt(-1);if(kind!=0)throw std::runtime_error("unsupported bin material type");
        const std::string key(request.materialId);
        using Query=void*(__fastcall*)(quintptr,std::shared_ptr<void>*,const int&,const std::string&);
        sdkExport<Query>(sdk,sdkQueryName,sdkQueryRva)(wrapper,&material,kind,key);
        if(!material)throw std::runtime_error("persistent material absent");
        const auto persistent=reinterpret_cast<quintptr>(material.get());
        std::string materialId;sdkExport<TextGet>(sdk,sdkMaterialIdName,sdkMaterialIdRva)(persistent,&materialId);
        using TextRef=const std::string&(__fastcall*)(quintptr);
        const auto& persistedPath=sdkExport<TextRef>(sdk,sdkFilePathName,sdkFilePathRva)(persistent);
        const auto& persistedLabel=sdkExport<TextRef>(sdk,sdkLabelName,sdkLabelRva)(persistent);
        if(materialId!=key || normalized(QString::fromStdString(persistedPath)).compare(oldPath,Qt::CaseInsensitive) ||
            QString::fromStdString(persistedLabel)!=row.value("extra_info").toString())throw std::runtime_error("persistent material ownership mismatch");
        // Only aliases of this exact old source path, never equal names or hashes.
        const auto aliasDocument=QJsonDocument::fromJson(QByteArray(request.aliasesJson));
        if(!aliasDocument.isArray())throw std::runtime_error("alias identities missing");
        std::set<QByteArray> expectedAliases,actualAliases;
        for(const auto& value:aliasDocument.array()){
            const auto alias=value.toString().toLatin1();
            if(alias.size()!=36 || !expectedAliases.insert(alias).second)throw std::runtime_error("invalid alias identities");
        }
        if(expectedAliases.empty() || expectedAliases.size()>16 || !expectedAliases.count(request.materialId))throw std::runtime_error("invalid alias scope");
#ifdef CAPSYNC_EXPLICIT_BIN_LABELS
        const auto labelsDocument=QJsonDocument::fromJson(QByteArray(request.desiredLabelsJson));
        if(!labelsDocument.isObject() || labelsDocument.object().size()!=static_cast<int>(expectedAliases.size()))throw std::runtime_error("explicit title scope differs");
        const auto desiredLabels=labelsDocument.object();
        for(const auto& aliasKey:expectedAliases)if(!desiredLabels.contains(QString::fromLatin1(aliasKey)) || !desiredLabels.value(QString::fromLatin1(aliasKey)).isString())throw std::runtime_error("explicit title owner missing");
#endif
        struct Alias {std::string key,label;std::shared_ptr<void> material;QObject* node;quintptr data;
#ifdef CAPSYNC_PRESERVE_BIN_LABELS
            QString oldSpelling;
#endif
#ifdef CAPSYNC_STOCK_BIN_TITLES
            QPointer<QObject> view;
#endif
        };
        std::vector<Alias> aliases;
        for(const auto& group:meta.value("draft_materials").toArray())for(const auto& value:group.toObject().value("value").toArray()){
            const auto item=value.toObject();
            if(normalized(item.value("file_Path").toString()).compare(oldPath,Qt::CaseInsensitive))continue;
            const auto aliasId=item.value("id").toString().toLatin1();
            if(!actualAliases.insert(aliasId).second || item.value("type").toInt(-1)!=0 || item.value("metetype")!=row.value("metetype") ||
                !QStringList{QStringLiteral("photo"),QStringLiteral("gif"),QStringLiteral("music"),QStringLiteral("video")}.contains(item.value("metetype").toString()))
                throw std::runtime_error("shared source alias type or ID invalid");
            if(item.value("width")!=row.value("width") || item.value("height")!=row.value("height"))throw std::runtime_error("alias dimensions differ");
            const auto aliasNode=nodes.find(aliasId);
            if(aliasNode==nodes.end() || !aliasNode->second->children().isEmpty())throw std::runtime_error("alias leaf absent");
            Alias alias;alias.key=aliasId.constData();alias.node=aliasNode->second;
            alias.data=read<quintptr>(reinterpret_cast<quintptr>(alias.node)+0x10);
#ifdef CAPSYNC_PRESERVE_BIN_LABELS
            alias.oldSpelling=QString::fromUtf8(string(alias.data+0x58));
#endif
            if(normalized(QString::fromUtf8(string(alias.data+0x58))).compare(oldPath,Qt::CaseInsensitive) ||
                QString::fromUtf8(string(alias.data+0x98))!=item.value("extra_info").toString())throw std::runtime_error("alias native ownership mismatch");
            sdkExport<Query>(sdk,sdkQueryName,sdkQueryRva)(wrapper,&alias.material,kind,alias.key);
            if(!alias.material)throw std::runtime_error("alias SDK material absent");
            const auto address=reinterpret_cast<quintptr>(alias.material.get());std::string actualId;
            sdkExport<TextGet>(sdk,sdkMaterialIdName,sdkMaterialIdRva)(address,&actualId);
            if(actualId!=alias.key || normalized(QString::fromStdString(sdkExport<TextRef>(sdk,sdkFilePathName,sdkFilePathRva)(address))).compare(oldPath,Qt::CaseInsensitive) ||
                QString::fromStdString(sdkExport<TextRef>(sdk,sdkLabelName,sdkLabelRva)(address))!=item.value("extra_info").toString())throw std::runtime_error("alias SDK ownership mismatch");
            const auto label=item.value("extra_info").toString();
#ifdef CAPSYNC_PRESERVE_BIN_LABELS
            if(label.size()>4096)throw std::runtime_error("display label exceeds bounds");
            alias.label=(label==QFileInfo(item.value("file_Path").toString()).fileName()?QFileInfo(newPath).fileName():label).toUtf8().toStdString();
#ifdef CAPSYNC_EXPLICIT_BIN_LABELS
            const auto desired=desiredLabels.value(QString::fromLatin1(aliasId)).toString();
            if(desired.isEmpty() || desired.size()>4096 || (label!=QFileInfo(item.value("file_Path").toString()).fileName() && desired!=label))throw std::runtime_error("a newer custom title differs from the observed title");
            alias.label=desired.toUtf8().toStdString();
#endif
#elif defined(CAPSYNC_LINKED_ALIAS_PHOTO)
            if(label.compare(QFileInfo(oldPath).fileName(),Qt::CaseInsensitive))throw std::runtime_error("linked alias requires an ordinary source label");
            alias.label=QFileInfo(newPath).fileName().toUtf8().constData();
#else
            if(label!=QFileInfo(oldPath).fileName())throw std::runtime_error("stock control requires ordinary source labels");
            alias.label=(label==QFileInfo(oldPath).fileName()?QFileInfo(newPath).fileName():label).toUtf8().constData();
#endif
            aliases.push_back(std::move(alias));
        }
        if(actualAliases!=expectedAliases)throw std::runtime_error("shared source alias scope changed");
#ifdef CAPSYNC_PRESERVE_BIN_LABELS
        BinSnapshot completeBefore(creator,meta);
#endif
#ifdef CAPSYNC_GENERAL_PHOTO_PATH
#ifdef CAPSYNC_MEDIA_PATH
        if(actualAliases.empty() || row.value("metetype").toString()!=ExplorerMedia::kind(QFileInfo(newPath).suffix()))throw std::runtime_error("explicit media type differs from accepted extension");
#elif defined(CAPSYNC_LINKED_ALIAS_PHOTO)
        if(actualAliases.size()<2 || row.value("metetype").toString()!=QStringLiteral("photo"))throw std::runtime_error("linked photo requires explicit multiple aliases");
#else
        if(actualAliases!=std::set<QByteArray>{control} || row.value("metetype").toString()!=QStringLiteral("photo"))
            throw std::runtime_error("general photo path requires one independently owned photo card");
#endif
#endif
        POINT before{},after{};GetCursorPos(&before);const auto foreground=GetForegroundWindow();auto* focus=QGuiApplication::focusObject();
        QJsonObject result{{"status",request.action==0 || request.action==2?"ready":"changed"},{"materialId",QString::fromLatin1(request.materialId)},
            {"oldPath",nativeOldPath},{"oldName",oldName},{"newPath",newPath},{"newName",QFileInfo(newPath).fileName()},
            {"sdkStoreId",QString::fromStdString(storeId)},{"persistentPath",QString::fromStdString(persistedPath)},
            {"persistentLabel",QString::fromStdString(persistedLabel)}};
        result.insert("secondaryPathBefore",QString::fromUtf8(string(data+0x78)));
        result.insert("fullMapCount",static_cast<int>(completeIds.size()));
        result.insert("fullMapGroups",static_cast<int>(allMaterials.size()));
        // Bin-only: no timeline container interpretation or source relink.
        if(request.action==1 || request.action==3
#ifdef CAPSYNC_STOCK_BIN_TITLES
           || request.action==0
#endif
          ){
            QPointer<QObject> guardedNode(node);
            using StockRelink=void(__fastcall*)(quintptr,const QString&,const QString&);
            using StockSave=void(__fastcall*)(quintptr);
            if(read<int>(reinterpret_cast<quintptr>(grid)+0x3c8)!=0)throw std::runtime_error("stock grid is not the ordinary project bin");
            // Stock relink enumerates instantiated resource models. A folder
            // unopened since restart may have nodes but no resource models yet.
            // Resolve only the exact owned aliases using the bin serializer's
            // own model factory before enumerating them for the relink.
            using ResourceManagerGet=quintptr(__fastcall*)();
            using ResourceModelGet=quintptr(__fastcall*)(quintptr,QObject*);
            const auto resourceManager=reinterpret_cast<ResourceManagerGet>(creator+0x1bf3d80)();
            if(!resourceManager)throw std::runtime_error("resource manager absent");
            for(auto& alias:aliases){
                const auto modelAddress=reinterpret_cast<ResourceModelGet>(creator+0x1bf3e30)(resourceManager,alias.node);
                if(!modelAddress)
                    throw std::runtime_error("owned resource model absent");
#ifdef CAPSYNC_STOCK_BIN_TITLES
#ifdef CAPSYNC_TYPED_TITLE_MODELS
                const auto privateData=read<quintptr>(modelAddress+8);
                if(read<quintptr>(privateData+8)!=modelAddress || (read<unsigned>(privateData+48)&0x0c))throw std::runtime_error("owned title model lifetime changed");
                alias.view=reinterpret_cast<QObject*>(modelAddress);
                if(alias.view->thread()!=QThread::currentThread())throw std::runtime_error("owned title model belongs to another thread");
#else
                alias.view=object(modelAddress,"MediaInfoViewModel");
#endif
                const auto title=alias.view->metaObject()->indexOfProperty("title");
                if(title<0 || !alias.view->metaObject()->property(title).isWritable() ||
                   normalized(alias.view->property("filePath").toString()).compare(oldPath,Qt::CaseInsensitive) ||
                   alias.view->property("title").toString()!=QString::fromUtf8(string(alias.data+0x98)))throw std::runtime_error("owned cached title/path differs");
#endif
            }
#ifdef CAPSYNC_STOCK_BIN_TITLES
            if(request.action==0){
                completeBefore.verify();result.insert("status","ready");result.insert("wholeSdkBinExact",true);result.insert("stockTitleProperty",true);
                result.insert("navigationUnchanged",current==read<quintptr>(service+0x70) && drop==read<quintptr>(service+0x78));
                result.insert("foregroundUnchanged",foreground==GetForegroundWindow());result.insert("focusUnchanged",focus==QGuiApplication::focusObject());
                save(request,result);return;
            }
#endif
            mutated=true;
#ifdef CAPSYNC_PRESERVE_BIN_LABELS
            std::set<QString> exactSpellings;for(const auto& alias:aliases)exactSpellings.insert(alias.oldSpelling);
            for(const auto& spelling:exactSpellings)reinterpret_cast<StockRelink>(creator+0x29f2490)(reinterpret_cast<quintptr>(grid),spelling,newPath);
            result.insert("stockRelinkCalls",static_cast<int>(exactSpellings.size()));
#else
            reinterpret_cast<StockRelink>(creator+0x29f2490)(reinterpret_cast<quintptr>(grid),oldPath,newPath);
#endif
#ifdef CAPSYNC_PRESERVE_BIN_LABELS
            // Stock relink may replace a custom title with the new filename.
            // Restore only the captured title of each explicitly owned UUID.
            for(const auto& alias:aliases){
#ifdef CAPSYNC_STOCK_BIN_TITLES
                if(!alias.view || normalized(alias.view->property("filePath").toString()).compare(newPath,Qt::CaseInsensitive))throw std::runtime_error("relinked view lost its owned path");
                const auto expectedLabel=QString::fromUtf8(alias.label.data(),static_cast<qsizetype>(alias.label.size()));
#ifdef CAPSYNC_STOCK_RENAME_TRANSACTION
                using ApplyRename=void(__fastcall*)(void*,QObject*,const QString&);
                if(alias.view->property("title").toString()!=expectedLabel)reinterpret_cast<ApplyRename>(creator+0x29cce20)(nullptr,alias.view.data(),expectedLabel);
#else
#ifdef CAPSYNC_PERSISTENT_BIN_TITLE
                const auto labelData=read<quintptr>(reinterpret_cast<quintptr>(alias.node)+0x10);
                if(string(labelData)!=QByteArray::fromStdString(alias.key) || normalized(QString::fromUtf8(string(labelData+0x58))).compare(newPath,Qt::CaseInsensitive))throw std::runtime_error("relinked title node ownership changed");
                using AssignLabel=void(__fastcall*)(void*,const std::string&);
                reinterpret_cast<AssignLabel>(creator+0xb74f10)(reinterpret_cast<void*>(labelData+0x98),alias.label);
#endif
                if(alias.view->property("title").toString()!=expectedLabel && !alias.view->setProperty("title",expectedLabel))throw std::runtime_error("stock title restoration rejected");
#endif
                if(alias.view->property("title").toString()!=expectedLabel)throw std::runtime_error("stock title restoration unconfirmed");
#else
                auto* aliasNode=object(reinterpret_cast<quintptr>(alias.node),"FileMetaDataNode");
                const auto metadata=read<quintptr>(reinterpret_cast<quintptr>(aliasNode)+0x10);
                if(string(metadata)!=QByteArray::fromStdString(alias.key) || normalized(QString::fromUtf8(string(metadata+0x58))).compare(newPath,Qt::CaseInsensitive))throw std::runtime_error("relinked alias metadata changed ownership");
                std::shared_ptr<void> updated;
                sdkExport<Query>(sdk,sdkQueryName,sdkQueryRva)(wrapper,&updated,kind,alias.key);
                if(!updated)throw std::runtime_error("relinked alias disappeared");
                const auto address=reinterpret_cast<quintptr>(updated.get());
                const auto nativeLabel=QString::fromUtf8(string(metadata+0x98));
                const auto sdkLabel=QString::fromStdString(sdkExport<TextRef>(sdk,sdkLabelName,sdkLabelRva)(address));
                const auto expectedLabel=QString::fromUtf8(alias.label.data(),static_cast<qsizetype>(alias.label.size()));
                const auto ordinary=QFileInfo(newPath).fileName();
                if((nativeLabel!=expectedLabel && nativeLabel!=ordinary) || (sdkLabel!=expectedLabel && sdkLabel!=ordinary))throw std::runtime_error("stock relink changed a label unexpectedly");
                if(nativeLabel!=expectedLabel || sdkLabel!=expectedLabel){
                    using Assign=void(__fastcall*)(void*,const std::string&);
                    reinterpret_cast<Assign>(creator+0xb74f10)(reinterpret_cast<void*>(metadata+0x98),alias.label);
                    using SetLabel=void(__fastcall*)(quintptr,const std::string&);
                    sdkExport<SetLabel>(sdk,sdkSetLabelName,sdkSetLabelRva)(address,alias.label);
                    using Commit=bool(__fastcall*)(quintptr,const int&,const std::shared_ptr<void>&,const std::string&);
                    if(!sdkExport<Commit>(sdk,sdkCommitName,sdkCommitRva)(wrapper,kind,updated,alias.key))throw std::runtime_error("custom label persistence unconfirmed");
                }
#endif
            }
#endif
            reinterpret_cast<StockSave>(creator+0x29e1110)(reinterpret_cast<quintptr>(grid));
#ifdef CAPSYNC_PRESERVE_BIN_LABELS
            if(!QMetaObject::invokeMethod(grid,"onFileMetaTreeUpdated",Qt::DirectConnection))throw std::runtime_error("label view refresh unavailable");
            auto expected=completeBefore.before;
            for(const auto& alias:aliases){auto found=expected.find(alias.key);if(found==expected.end())throw std::runtime_error("expected alias missing");std::get<1>(found->second)=BinSnapshot::path(newPath);std::get<2>(found->second)=alias.label;}
            if(BinSnapshot::withoutStockService(completeBefore.capture())!=BinSnapshot::withoutStockService(expected))throw std::runtime_error("complete SDK bin differs beyond owned path/labels");
            result.insert("wholeSdkBinExact",true);result.insert("customLabelsPreserved",true);result.insert("sourceHashStreaming",true);
#endif
            if(!guardedNode)throw std::runtime_error("stock update changed node lifetime");
            object(reinterpret_cast<quintptr>(guardedNode.data()),"FileMetaDataNode");
            const auto updatedData=read<quintptr>(reinterpret_cast<quintptr>(guardedNode.data())+0x10);
            QJsonArray updatedAliases;
            for(const auto& alias:aliases){
                std::shared_ptr<void> updated;
                sdkExport<Query>(sdk,sdkQueryName,sdkQueryRva)(wrapper,&updated,kind,alias.key);
                if(!updated || normalized(QString::fromUtf8(string(reinterpret_cast<quintptr>(updated.get())))).compare(newPath,Qt::CaseInsensitive))
                    throw std::runtime_error("stock model did not persist the exact owned alias");
                updatedAliases.append(QString::fromStdString(alias.key));
            }
            result.insert("updatedAliasIds",updatedAliases);
            result.insert("persistentAssigned",true);
            result.insert("idPreserved",string(updatedData)==request.materialId);
            result.insert("pathAssigned",QString::fromUtf8(string(updatedData+0x58))==newPath);
            result.insert("secondaryPathAfter",QString::fromUtf8(string(updatedData+0x78)));
            result.insert("nameAssigned",QString::fromUtf8(string(updatedData+0x98))==QFileInfo(newPath).fileName());
            result.insert("nativeRoute","owned SDK source path setter and stock bin model save");
        }
        GetCursorPos(&after);result.insert("navigationUnchanged",current==read<quintptr>(service+0x70) && drop==read<quintptr>(service+0x78));
        result.insert("foregroundUnchanged",foreground==GetForegroundWindow());result.insert("focusUnchanged",focus==QGuiApplication::focusObject());
        result.insert("cursorUnchanged",before.x==after.x && before.y==after.y);save(request,result);
    }catch(const std::exception& error){save(request,{{"status",mutated?"unknown":"rejected"},{"reason",QString::fromLatin1(error.what())}});}
}
}
extern "C" __declspec(dllexport) DWORD WINAPI CapSync_RelinkCommandThread(LPVOID raw){
    try{
        const auto* r=static_cast<const Request*>(raw);
#ifdef CAPSYNC_PRODUCT_RUNTIME
        if(!r || !std::wmemchr(r->previousRoot,0,1024))return static_cast<DWORD>(-1);
#endif
        if(!r || r->size!=sizeof(Request) ||
#ifdef CAPSYNC_EXPLICIT_BIN_LABELS
            r->version!=3 || !std::memchr(r->desiredLabelsJson,'\0',16384) ||
#else
            r->version!=2 ||
#endif
#ifdef CAPSYNC_STOCK_BIN_TITLES
            (r->action!=0 && r->action!=3) ||
#else
            r->action!=3 ||
#endif
            !std::wmemchr(r->oldPath,L'\0',1024) || !std::wmemchr(r->newPath,L'\0',1024) ||
            !std::wmemchr(r->root,L'\0',1024) || !std::wmemchr(r->meta,L'\0',1024) || !std::wmemchr(r->output,L'\0',1024) ||
            !std::memchr(r->jobId,'\0',37) || !std::memchr(r->materialId,'\0',37) || !std::memchr(r->sha256,'\0',65) || !std::memchr(r->aliasesJson,'\0',1024))return static_cast<DWORD>(-1);
        const QFileInfo output(QString::fromWCharArray(r->output));
        if(!output.isAbsolute() || output.dir().dirName()!=QStringLiteral("evidence") || !output.dir().exists() || output.exists())return static_cast<DWORD>(-2);
        auto* app=QCoreApplication::instance();if(!app || std::strcmp(qVersion(),"6.2.2"))return static_cast<DWORD>(-3);
        HMODULE module=nullptr;if(!GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS|GET_MODULE_HANDLE_EX_FLAG_PIN,reinterpret_cast<LPCWSTR>(&CapSync_RelinkCommandThread),&module))return static_cast<DWORD>(-4);
        const Request copy=*r;return QMetaObject::invokeMethod(app,[copy]{perform(copy);},Qt::QueuedConnection)?1:static_cast<DWORD>(-5);
    }catch(...){return static_cast<DWORD>(-6);}
}
BOOL WINAPI DllMain(HINSTANCE instance,DWORD reason,LPVOID){if(reason==DLL_PROCESS_ATTACH)DisableThreadLibraryCalls(instance);return TRUE;}
