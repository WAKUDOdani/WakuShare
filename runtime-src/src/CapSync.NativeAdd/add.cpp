#include "../CapSync.NativeExplorerObserve/material_limits.h"
#include "../CapSync.NativeDrop/drop_events.h"
#include <Windows.h>
#include <QtCore/QCryptographicHash>
#include <QtCore/QFileInfo>
#include <QtCore/QDir>
#include <QtCore/QFile>
#include <QtCore/QJsonDocument>
#include <QtCore/QJsonObject>
#include <QtCore/QJsonArray>
#include <QtCore/QSaveFile>
#include <QtCore/QThread>
#include <QtCore/QVariant>
#include <QtQuick/QQuickItem>
#include <cstring>
#include <cwchar>
#include <stdexcept>
#include <vector>
#include <map>
#include <set>
#ifdef CAPSYNC_MEDIA_PATH
#include "../CapSync.NativeExplorerObserve/media_formats.h"
#endif
#ifdef CAPSYNC_EXPLORER_RUNTIME
#include "../CapSync.NativeExplorerObserve/runtime_guard.h"
#endif
#ifdef CAPSYNC_TREE_MOVE
#include <QtCore/QPointer>
#include <QtGui/QGuiApplication>
#include "bin_snapshot.h"
#endif

struct Request {
    unsigned size; unsigned version; unsigned action;
    wchar_t source[1024]; wchar_t root[1024]; wchar_t meta[1024]; wchar_t output[1024];
    char jobId[37]; char targetId[37]; char materialId[37]; char sha256[65];
#ifdef CAPSYNC_LINKED_PHOTO_MOVE
    char aliasesJson[1024];
#endif
#ifdef CAPSYNC_EXPLORER_RUNTIME
    ExplorerRuntimeLease lease;
#endif
};
namespace {
#ifndef CAPSYNC_PRODUCT_RUNTIME
constexpr const char* labId="582F1BF9-2B25-4cf2-B83F-3528F1B868B2";
#endif
std::set<QByteArray> acceptedDrops;
template<typename T> T read(quintptr address) {
    T value{}; SIZE_T actual=0;
    if (address<0x10000 || !ReadProcessMemory(GetCurrentProcess(),reinterpret_cast<LPCVOID>(address),
        &value,sizeof(value),&actual) || actual!=sizeof(value)) throw std::runtime_error("memory changed");
    return value;
}
#ifdef CAPSYNC_FOLDER_STORE_MOVE
#include "virtual_store.h"
#endif
QObject* object(quintptr address,const char* type) {
    const auto data=read<quintptr>(address+8);
    if (read<quintptr>(data+8)!=address || (read<unsigned>(data+48)&0x0c)) throw std::runtime_error("QObject lifetime changed");
    auto* node=reinterpret_cast<QObject*>(address);
    if (std::strcmp(node->metaObject()->className(),type)) throw std::runtime_error("wrong QObject type");
    return node;
}
QByteArray id(QObject* node) {
    const auto data=read<quintptr>(reinterpret_cast<quintptr>(node)+0x10);
    const auto size=read<quintptr>(data+16),capacity=read<quintptr>(data+24);
    if (size>64 || capacity<size || capacity>1024) throw std::runtime_error("metadata layout changed");
    QByteArray value(static_cast<qsizetype>(size),'\0'); SIZE_T copied=0;
    const auto text=capacity<16 ? data : read<quintptr>(data);
    if (size && (!ReadProcessMemory(GetCurrentProcess(),reinterpret_cast<LPCVOID>(text),value.data(),size,&copied)
        || copied!=size)) throw std::runtime_error("ID unavailable");
    return value;
}
void save(const QString& path,QJsonObject result,const Request& request) {
    result.insert("jobId",QString::fromLatin1(request.jobId));
    QSaveFile file(path);
    if (file.open(QIODevice::WriteOnly)) { file.write(QJsonDocument(result).toJson()); file.commit(); }
}
void perform(Request request) {
    const auto output=QString::fromWCharArray(request.output);
    bool invoked=false;
    try {
        if (QThread::currentThread()!=QCoreApplication::instance()->thread()) throw std::runtime_error("wrong thread");
#ifdef CAPSYNC_EXPLORER_RUNTIME
        ExplorerRuntime::check(request.lease);
#endif
        QFile file(QString::fromWCharArray(request.meta));
        if (!file.open(QIODevice::ReadOnly)) throw std::runtime_error("lab metadata unavailable");
        const auto meta=QJsonDocument::fromJson(file.readAll()).object();
#ifdef CAPSYNC_PRODUCT_RUNTIME
        ExplorerProject::metadata(meta,QString::fromWCharArray(request.meta));
#else
        if (meta.value("draft_id").toString()!=QLatin1String(labId) ||
            meta.value("draft_name").toString()!=QStringLiteral("CapSync-Lab-20261013-001")) throw std::runtime_error("not lab project");
#endif
        const auto source=QFileInfo(QString::fromWCharArray(request.source)).canonicalFilePath();
        const auto root=QFileInfo(QString::fromWCharArray(request.root)).canonicalFilePath();
        const auto suffix=QFileInfo(source).suffix().toLower();
#ifdef CAPSYNC_MEDIA_PATH
        const bool supported=!ExplorerMedia::kind(suffix).isEmpty();
#else
        const bool supported=suffix==QStringLiteral("png") || suffix==QStringLiteral("jpg") || suffix==QStringLiteral("jpeg")
            || suffix==QStringLiteral("gif") || suffix==QStringLiteral("wav") || suffix==QStringLiteral("mp3")
            || suffix==QStringLiteral("mp4") || suffix==QStringLiteral("mov");
#endif
        if (source.isEmpty() || root.isEmpty()
#ifndef CAPSYNC_PRODUCT_RUNTIME
            || !root.endsWith(QStringLiteral("/research/fixtures/AutoAddLab"),Qt::CaseInsensitive)
#endif
            || !source.startsWith(root+QLatin1Char('/'),Qt::CaseInsensitive) || !supported)
            throw std::runtime_error("outside the supported lab media source root");
        int pathMatches=0,materialMatches=0;
        for (const auto group : meta.value("draft_materials").toArray())
            for (const auto entry : group.toObject().value("value").toArray()) {
                const auto row=entry.toObject();
                if (QFileInfo(row.value("file_Path").toString()).canonicalFilePath()==source) {
                    ++pathMatches;
                    if (row.value("id").toString()==QLatin1String(request.materialId)) ++materialMatches;
                }
            }
#ifdef CAPSYNC_LINKED_PHOTO_MOVE
        const auto aliasDocument=QJsonDocument::fromJson(QByteArray(request.aliasesJson));
        if(request.action!=2 || !aliasDocument.isArray())throw std::runtime_error("explicit linked photo move only");
        std::set<QString> expectedAliases,actualAliases;
        for(const auto& value:aliasDocument.array()){
            const auto identifier=value.toString();
            if(identifier.size()!=36 || !expectedAliases.insert(identifier).second)throw std::runtime_error("invalid move alias ID");
        }
        if(expectedAliases.empty() || expectedAliases.size()>16 || !expectedAliases.count(QString::fromLatin1(request.materialId)))
            throw std::runtime_error("invalid move alias scope");
        for(const auto group:meta.value("draft_materials").toArray())for(const auto entry:group.toObject().value("value").toArray()){
            const auto row=entry.toObject();if(QFileInfo(row.value("file_Path").toString()).canonicalFilePath()!=source)continue;
            if(row.value("metetype").toString()!=
#ifdef CAPSYNC_MEDIA_PATH
               ExplorerMedia::kind(suffix) ||
#else
               QStringLiteral("photo") ||
#endif
               row.value("type").toInt(-1)!=0 ||
               !actualAliases.insert(row.value("id").toString()).second)throw std::runtime_error("invalid photo move alias");
        }
        if(actualAliases!=expectedAliases || materialMatches!=1 || pathMatches!=static_cast<int>(expectedAliases.size()))
            throw std::runtime_error("photo move alias ownership changed");
#elif defined(CAPSYNC_PNG_ALIAS_MOVE)
        if(request.action!=2 || QByteArray(request.materialId)!="c024b416-3002-4de9-9ab8-7e39d7148523" ||
           QByteArray(request.targetId)!="f5316979-608e-4530-9b92-6b8ddd1118bf" ||
           source.compare(root+QStringLiteral("/ReleaseCheck/metadata-path-control-still-png-renamed.png"),Qt::CaseInsensitive) ||
           pathMatches!=2 || materialMatches!=1)
            throw std::runtime_error("isolated PNG alias move only");
        std::set<QString> pathAliases;
        for(const auto group:meta.value("draft_materials").toArray())
            for(const auto entry:group.toObject().value("value").toArray()){
                const auto row=entry.toObject();
                if(QDir::cleanPath(row.value("file_Path").toString()).compare(source,Qt::CaseInsensitive)==0)
                    pathAliases.insert(row.value("id").toString());
            }
        if(pathAliases!=std::set<QString>{QStringLiteral("c024b416-3002-4de9-9ab8-7e39d7148523"),QStringLiteral("4195482C-1347-423E-8A4A-34771C25E21E")})
            throw std::runtime_error("PNG alias ownership changed");
#else
        if ((request.action==1 && pathMatches!=0) || (request.action==2 && (pathMatches!=1 || materialMatches!=1)))
            throw std::runtime_error("source registry ownership changed");
#endif
        const auto creator=reinterpret_cast<quintptr>(GetModuleHandleW(L"VECreator.dll"));
        wchar_t creatorPath[1024]{};
        if(!GetModuleFileNameW(reinterpret_cast<HMODULE>(creator),creatorPath,1024) ||
            QFileInfo(QString::fromWCharArray(creatorPath)).dir().dirName()!=QStringLiteral("9.6.0.4097"))
            throw std::runtime_error("add bridge requires release 9.6.0.4097");
        const auto service=read<quintptr>(creator+0xec16c18);
        const auto current=read<quintptr>(service+0x70),drop=read<quintptr>(service+0x78);
        object(current,"FileMetaDataNode");
        auto* tree=object(read<quintptr>(current+0x30),"FileMetaDataTree");
        auto* grid=object(reinterpret_cast<quintptr>(tree->parent()),"LocalMediaInfoGridViewModel");
        std::map<QByteArray,QObject*> nodes;
        std::vector<QObject*> pending;
        for(auto* child : tree->children()) pending.push_back(child);
        while(!pending.empty()) {
            auto* node=pending.back(); pending.pop_back();
            object(reinterpret_cast<quintptr>(node),"FileMetaDataNode");
            if (read<quintptr>(reinterpret_cast<quintptr>(node)+0x30)!=reinterpret_cast<quintptr>(tree)
                || static_cast<std::size_t>(nodes.size())>ExplorerLimits::materialCount || !nodes.emplace(id(node),node).second) throw std::runtime_error("invalid media tree");
            for(auto* child : node->children()) pending.push_back(child);
        }
        // The actual live tree, not only the on-disk name, must belong to this lab.
#ifndef CAPSYNC_PRODUCT_RUNTIME
        for (const auto key : {"963b593d-fae8-4af9-a487-29f0e73c8be5","f3fd343f-a805-42f7-9109-49e1dc8da258","9fa014be-4728-46ff-aedc-3327a8cc6b63"})
            if (!nodes.count(key)) throw std::runtime_error("different active project tree");
#endif
        const auto destination=nodes.find(request.targetId);
        if (destination==nodes.end()) throw std::runtime_error("target absent");
        // UUID presence and ancestry do not establish that a node is a folder.
        // Putting a child under a media leaf makes the stock serializer omit it.
        const auto destinationData=read<quintptr>(reinterpret_cast<quintptr>(destination->second)+0x10);
        if(read<unsigned>(destinationData+0x138)!=4)throw std::runtime_error("destination is not a folder");
        QFile hierarchyFile(QFileInfo(QString::fromWCharArray(request.meta)).dir().filePath(QStringLiteral("draft_virtual_store.json")));
        if(!hierarchyFile.open(QIODevice::ReadOnly))throw std::runtime_error("saved hierarchy absent");
        const auto hierarchy=QJsonDocument::fromJson(hierarchyFile.readAll()).object();int folderMatches=0;
        for(const auto group:hierarchy.value("draft_virtual_store").toArray())if(group.toObject().value("type").toInt(-1)==0)
            for(const auto item:group.toObject().value("value").toArray())
                if(item.toObject().value("id").toString()==QLatin1String(request.targetId))++folderMatches;
        if(folderMatches!=1)throw std::runtime_error("destination missing from typed folder registry");
#ifndef CAPSYNC_EXPLORER_RUNTIME
        bool ownedDestination=false;
        for(auto* node=destination->second;node && node!=tree;node=node->parent())
            if(id(node)=="f3fd343f-a805-42f7-9109-49e1dc8da258")ownedDestination=true;
        if(!ownedDestination)throw std::runtime_error("destination outside ManagedB");
#endif
        const HWND foreground=GetForegroundWindow(); POINT before{},after{}; GetCursorPos(&before);
#ifdef CAPSYNC_TREE_MOVE
        const auto* focus=QGuiApplication::focusObject();
#endif
        QJsonObject result;
        if (request.action==1) {
            if (acceptedDrops.count(request.jobId)) throw std::runtime_error("this job already dispatched a drop");
            auto* view=qobject_cast<QQuickItem*>(grid->property("collectionView").value<QObject*>());
            if (!view || std::strcmp(view->metaObject()->className(),"QUICollectionView") || !view->isVisible()
                || view->width()<50 || view->height()<50 || !view->window() || !view->window()->isVisible()
                || (GetAsyncKeyState(VK_LBUTTON)&0x8000) || (GetAsyncKeyState(VK_RBUTTON)&0x8000)) {
                save(output,{{"status","waiting"},{"reason","media view unavailable or user dragging"}},request); return;
            }
            QFile input(source);
            if (!input.open(QIODevice::ReadOnly) || QCryptographicHash::hash(input.readAll(),QCryptographicHash::Sha256).toHex()
                !=QByteArray(request.sha256).toLower()) throw std::runtime_error("source bytes changed");
            // Collection content may extend beyond the viewport when scrolled.
            // Address a point in its visible, ancestor-clipped scene area.
            auto visible=view->mapRectToScene(view->boundingRect()).intersected(QRectF(QPointF(),view->window()->size()));
            for(auto* ancestor=view->parentItem();ancestor;ancestor=ancestor->parentItem())
                if(ancestor->clip())visible=visible.intersected(ancestor->mapRectToScene(ancestor->boundingRect()));
            if(visible.width()<20 || visible.height()<20){
                save(output,{{"status","waiting"},{"reason","media viewport not visible"}},request);return;
            }
            const auto point=QPointF(visible.left()+visible.width()*0.85,visible.top()+visible.height()*0.85).toPoint();
            if (!view->contains(view->mapFromScene(point))) throw std::runtime_error("drop point outside collection");
            invoked=true;
            const auto delivered=deliverDrop(view->window(),point,QUrl::fromLocalFile(source));
            // Even a partially delivered event is never replayed by this module.
            acceptedDrops.insert(request.jobId);
            result={{"status",delivered.dropped?"delivered":"unknown"},{"dropAccepted",delivered.dropped},
                {"enterAccepted",delivered.entered},{"moveAccepted",delivered.moved}};
        } else {
#ifdef CAPSYNC_TREE_MOVE
#ifndef CAPSYNC_GENERAL_PHOTO_PATH
            if(QByteArray(request.materialId)!="4195482C-1347-423E-8A4A-34771C25E21E")
                throw std::runtime_error("Tree move restricted to the surviving lab PNG");
#else
            bool photo=false;
            for(const auto group:meta.value("draft_materials").toArray())for(const auto value:group.toObject().value("value").toArray()){
                const auto row=value.toObject();
                if(row.value("id").toString()==QLatin1String(request.materialId) &&
#ifdef CAPSYNC_MEDIA_PATH
                   row.value("metetype").toString()==ExplorerMedia::kind(suffix))photo=true;
#else
                   row.value("metetype").toString()==QStringLiteral("photo"))photo=true;
#endif
            }
            if(!photo)throw std::runtime_error("general tree move requires owned photo metadata");
#endif
            BinSnapshot sdkBefore(creator,meta);
#endif
            const auto item=nodes.find(request.materialId);
            if (item==nodes.end() || !item->second->children().isEmpty()) throw std::runtime_error("source node absent or not a leaf");
            auto* node=item->second;
#if defined(CAPSYNC_GENERAL_PHOTO_PATH) && !defined(CAPSYNC_EXPLORER_RUNTIME)
            bool sourceOwned=false;
            for(auto* ancestor=node->parent();ancestor && ancestor!=tree;ancestor=ancestor->parent())
                if(id(ancestor)=="f3fd343f-a805-42f7-9109-49e1dc8da258")sourceOwned=true;
            if(!sourceOwned)throw std::runtime_error("photo source outside ManagedB");
#endif
            if(read<unsigned>(read<quintptr>(reinterpret_cast<quintptr>(node)+0x10)+0x138)==4)
                throw std::runtime_error("source must be a media leaf");
#ifdef CAPSYNC_FOLDER_STORE_MOVE
            if(QByteArray(request.targetId)!="f0b64394-b8f2-4b9f-b740-4aa18c0b17b6" ||
               id(object(read<quintptr>(reinterpret_cast<quintptr>(node)+0x28),"FileMetaDataNode"))!=
                   "f5316979-608e-4530-9b92-6b8ddd1118bf")
                throw std::runtime_error("Folder-only route restricted to ReleaseCheck-to-NestedAlpha lab move");
            FolderStoreChange hierarchy(sdkBefore,QString::fromWCharArray(request.meta),request.materialId,request.targetId);
            if(request.action==0){
                sdkBefore.verify();
                save(output,{{"status","ready"},{"folderStoreMatches",true},{"fullSdkBinPreserved",true},
                    {"editorMutation",false}},request);return;
            }
#endif
            if (node->parent()!=destination->second) {
                static_assert(sizeof(std::vector<QObject*>)==3*sizeof(void*),"Unsupported vector ABI");
                const std::vector<QObject*> moving{node};
                using Move=void(__fastcall*)(QObject*,const std::vector<QObject*>&,QObject*);
#ifdef CAPSYNC_TREE_MOVE
                QPointer<QObject> stable(node);
                // Keep the exact native-owned FileMetaData alive. The stock
                // grid wrapper can rebuild its resource list during a move.
                const auto metadata=*reinterpret_cast<const std::shared_ptr<void>*>(reinterpret_cast<quintptr>(node)+0x10);
                if(!metadata)throw std::runtime_error("Metadata owner absent");
                using TreeMove=void(__fastcall*)(QObject*,const std::vector<QObject*>&);
                invoked=true;
                // Same operation called by the verified R4097 grid wrapper;
                // folder.cpp already uses the paired service persist/update.
                reinterpret_cast<TreeMove>(creator+0x5e0ece0)(destination->second,moving);
                if(!stable || node->parent()!=destination->second)throw std::runtime_error("Tree move lost its node");
#ifdef CAPSYNC_FOLDER_STORE_MOVE
                hierarchy.apply();
                sdkBefore.verify();
                // Save only the hierarchy through its own SDK store. Never
                // run grid save, which reconstructs/removes bin materials.
                if(!QMetaObject::invokeMethod(grid,"onFileMetaTreeUpdated",Qt::DirectConnection))
                    throw std::runtime_error("Tree update unavailable");
#else
                using Save=void(__fastcall*)(quintptr);
                reinterpret_cast<Save>(creator+0x5e121e0)(service);
                if(!QMetaObject::invokeMethod(grid,"onFileMetaTreeUpdated",Qt::DirectConnection))
                    throw std::runtime_error("Tree update unavailable");
                reinterpret_cast<Save>(creator+0x29e1110)(reinterpret_cast<quintptr>(grid));
#endif
                if(!stable || id(node)!=request.materialId)throw std::runtime_error("Tree save lost its node UUID");
#else
                invoked=true;
                reinterpret_cast<Move>(creator+0x29d3980)(grid,moving,destination->second);
#endif
            }
#ifdef CAPSYNC_TREE_MOVE
            sdkBefore.verify();
#endif
            result={{"status","moved"},{"materialId",QString::fromLatin1(request.materialId)},
                {"idPreserved",id(node)==request.materialId},
                {"parentUpdated",node->parent()==destination->second &&
                    read<quintptr>(reinterpret_cast<quintptr>(node)+0x28)==reinterpret_cast<quintptr>(destination->second)}};
#ifdef CAPSYNC_TREE_MOVE
            result.insert("fullSdkBinPreserved",true);
            result.insert("knownStockServiceChange",sdkBefore.stockServiceChanged);
#ifdef CAPSYNC_FOLDER_STORE_MOVE
            result.insert("folderStoreOnly",true);
#endif
#endif
        }
        GetCursorPos(&after);
        result.insert("navigationUnchanged",read<quintptr>(service+0x70)==current && read<quintptr>(service+0x78)==drop);
        result.insert("foregroundUnchanged",foreground==GetForegroundWindow());
        result.insert("cursorUnchanged",before.x==after.x && before.y==after.y);
#ifdef CAPSYNC_TREE_MOVE
        result.insert("focusUnchanged",focus==QGuiApplication::focusObject());
#endif
        save(output,result,request);
    } catch(const std::exception& error) {
        save(output,{{"status",invoked?"unknown":"rejected"},{"reason",QString::fromLatin1(error.what())}},request);
    }
}
}
extern "C" __declspec(dllexport) DWORD WINAPI CapSync_AddCommandThread(LPVOID raw) {
    try {
        const auto* request=static_cast<const Request*>(raw);
#ifdef CAPSYNC_LINKED_PHOTO_MOVE
        if(!request || request->size!=sizeof(Request) || !std::memchr(request->aliasesJson,'\0',1024))return static_cast<DWORD>(-1);
#endif
        if(!request || request->size!=sizeof(Request) || request->version!=1 ||
#ifdef CAPSYNC_FOLDER_STORE_MOVE
            (request->action!=0 && request->action!=2)
#else
            (request->action!=1 && request->action!=2)
#endif
            || !std::wmemchr(request->source,L'\0',1024) || !std::wmemchr(request->root,L'\0',1024)
            || !std::wmemchr(request->meta,L'\0',1024) || !std::wmemchr(request->output,L'\0',1024)
            || !std::memchr(request->jobId,'\0',37) || !std::memchr(request->targetId,'\0',37)
            || !std::memchr(request->materialId,'\0',37) || !std::memchr(request->sha256,'\0',65)) return static_cast<DWORD>(-1);
        const QFileInfo output(QString::fromWCharArray(request->output));
        if (!output.isAbsolute() || output.suffix()!=QStringLiteral("json") || output.dir().dirName()!=QStringLiteral("evidence")
            || !output.dir().exists() || output.exists()) return static_cast<DWORD>(-2);
        auto* app=QCoreApplication::instance();
        if(!app || std::strcmp(qVersion(),"6.2.2")) return static_cast<DWORD>(-3);
        HMODULE module=nullptr;
        if(!GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS|GET_MODULE_HANDLE_EX_FLAG_PIN,
            reinterpret_cast<LPCWSTR>(&CapSync_AddCommandThread),&module)) return static_cast<DWORD>(-4);
        const Request copy=*request;
        return QMetaObject::invokeMethod(app,[copy]{perform(copy);},Qt::QueuedConnection)?1:static_cast<DWORD>(-5);
    } catch(...) { return static_cast<DWORD>(-6); }
}
BOOL WINAPI DllMain(HINSTANCE instance,DWORD reason,LPVOID) {
    if(reason==DLL_PROCESS_ATTACH) DisableThreadLibraryCalls(instance);
    return TRUE;
}
