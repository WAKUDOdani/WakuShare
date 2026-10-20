#include "material_limits.h"
// Complete SDK/bin agreement before observing manually removed owned cards.
#include "runtime_guard.h"
#include <QtCore/QFile>
#include <QtCore/QJsonArray>
#include <QtCore/QJsonObject>
#include <QtCore/QJsonDocument>
#include "../CapSync.NativeAdd/bin_snapshot.h"
#include <QtCore/QSaveFile>
#ifdef CAPSYNC_TITLE_EVENTS
#include "lab_scope.h"
#include <QtCore/QMetaMethod>
#endif
#ifdef CAPSYNC_TIMELINE_EVENTS
#include <QtCore/QPointer>
#include <QtGui/QGuiApplication>
#include <QtGui/QWindow>
#include <QtQml/QQmlContext>
#include <QtQml/QQmlEngine>
#endif
#ifdef CAPSYNC_TIMELINE_VISUAL_TREE
#include <QtQuick/QQuickItem>
#include <QtQuick/QQuickWindow>
#endif
#ifdef CAPSYNC_TIMELINE_MODEL_METADATA
#include <QtCore/QMetaProperty>
#endif
#ifdef CAPSYNC_LIVE_SOURCE_NAMES
#include "draft_snapshot.h"
#endif
#ifdef CAPSYNC_TIMELINE_LIFETIME_EVENTS
#include "timeline_events_v2.h"
#endif
struct Request {unsigned size,version;wchar_t output[1024];ExplorerRuntimeLease lease;};
namespace {
void perform(Request request) {
    QJsonObject result{{"status","rejected"},{"projectMutation",false}};
    try {
        ExplorerRuntime::check(request.lease);const auto identity=ExplorerSession::current();
#ifndef CAPSYNC_PRODUCT_RUNTIME
        if(identity.draftId!=QStringLiteral("582F1BF9-2B25-4CF2-B83F-3528F1B868B2"))throw std::runtime_error("outside laboratory");
#endif
        QFile file(identity.location+QStringLiteral("/draft_meta_info.json"));
        if(!file.open(QIODevice::ReadOnly) || file.size()>10*1024*1024)throw std::runtime_error("catalog unavailable");
        const auto document=QJsonDocument::fromJson(file.readAll()).object();
        if(document.value("draft_id").toString().toUpper()!=identity.draftId)throw std::runtime_error("different catalog project");
        const auto creator=reinterpret_cast<quintptr>(GetModuleHandleW(L"VECreator.dll"));
        BinSnapshot snapshot(creator,document);snapshot.verify();ExplorerRuntime::check(request.lease);
#ifdef CAPSYNC_LIVE_SOURCE_NAMES
        ExplorerDraftSnapshot::Snapshot liveDraft;
        QFile content(identity.location+QStringLiteral("/draft_content.json"));if(!content.open(QIODevice::ReadOnly) || content.size()>64*1024*1024)throw std::runtime_error("saved Draft identity unavailable");
        const auto savedDraft=QJsonDocument::fromJson(content.readAll()).object(),live=liveDraft.object();
        if(live.isEmpty() || live.value("id").toString().isEmpty() || live.value("id")!=savedDraft.value("id"))throw std::runtime_error("live Draft identity differs from saved lab");
#endif
        QJsonArray materials;
        for(const auto group:document.value("draft_materials").toArray())for(const auto row:group.toObject().value("value").toArray())materials.append(row);
#ifdef CAPSYNC_TITLE_EVENTS
        // Subscribe to the actual model signal. No recurring catalog reads or
        // timers; the observer's existing queued snapshot wakes the worker.
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
#else
        const auto host=GetModuleHandleW(L"CapSync.ExplorerRuntimeEventsV2.dll");
#endif
        QObject* target=nullptr;
        for(auto* child:QCoreApplication::instance()->children())if(!std::strcmp(child->metaObject()->className(),"Events")){
            HMODULE owner=nullptr;
            if(GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS|GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,reinterpret_cast<LPCWSTR>(child->metaObject()),&owner) && owner==host){if(target)throw std::runtime_error("multiple title event hosts");target=child;}
        }
        if(!target || target->metaObject()->indexOfSlot("signal()")<0)throw std::runtime_error("title event host absent");
        result.insert("phase","grid");ExplorerLab::grid();const auto service=ExplorerLab::read<quintptr>(creator+0xec16c18),current=ExplorerLab::read<quintptr>(service+0x70);
        auto* tree=ExplorerLab::object(ExplorerLab::read<quintptr>(current+0x30),"FileMetaDataTree");
        QMap<QString,QObject*> nodes;QList<QObject*> pending=tree->children();
        while(!pending.isEmpty()){
            auto* node=pending.takeLast();result.insert("phase","treeNode");ExplorerLab::object(reinterpret_cast<quintptr>(node),"FileMetaDataNode");const auto id=ExplorerLab::nodeId(node);
            if(static_cast<std::size_t>(nodes.size())>=ExplorerLimits::materialCount || nodes.contains(id))throw std::runtime_error("title tree bounds changed");nodes.insert(id,node);
            for(auto* child:node->children())pending.append(child);
        }
        using Manager=quintptr(__fastcall*)();using Model=quintptr(__fastcall*)(quintptr,QObject*);
        const auto manager=reinterpret_cast<Manager>(creator+0x1bf3d80)();if(!manager)throw std::runtime_error("title resource manager absent");
        const auto slot=target->metaObject()->method(target->metaObject()->indexOfSlot("signal()"));int watched=0;
        for(const auto entry:materials){
            const auto row=entry.toObject();if(!QStringList{QStringLiteral("photo"),QStringLiteral("gif"),QStringLiteral("music"),QStringLiteral("video")}.contains(row.value("metetype").toString()))continue;
            auto* node=nodes.value(row.value("id").toString());if(!node || !node->children().isEmpty())throw std::runtime_error("title leaf absent");
            result.insert("phase","resourceModel");result.insert("materialId",row.value("id"));const auto address=reinterpret_cast<Model>(creator+0x1bf3e30)(manager,node);
            const auto data=ExplorerLab::read<quintptr>(address+8);
            if(ExplorerLab::read<quintptr>(data+8)!=address || (ExplorerLab::read<unsigned>(data+48)&0x0c))throw std::runtime_error("title model lifetime changed");
            auto* view=reinterpret_cast<QObject*>(address);result.insert("modelClass",QString::fromLatin1(view->metaObject()->className()));
            if(view->thread()!=QThread::currentThread() || QDir::cleanPath(view->property("filePath").toString()).compare(QDir::cleanPath(row.value("file_Path").toString()),Qt::CaseInsensitive))throw std::runtime_error("title model owns a different path");
            const auto index=view->metaObject()->indexOfSignal("titleChanged()");
            if(index<0)throw std::runtime_error("title signal absent");
            QObject::connect(view,view->metaObject()->method(index),target,slot,static_cast<Qt::ConnectionType>(Qt::QueuedConnection|Qt::UniqueConnection));++watched;
        }
        snapshot.verify();ExplorerRuntime::check(request.lease);result.insert("titleWatchers",watched);result.insert("periodicTimers",0);result.insert("phase","subscribed");
#ifdef CAPSYNC_TIMELINE_LIFETIME_EVENTS
        auto* relay=static_cast<ExplorerTimelineEventsV2*>(target->findChild<QObject*>(QStringLiteral("WakuShareTimelineEventsV2"),Qt::FindDirectChildrenOnly));
        if(!relay)if(auto* old=target->findChild<QObject*>(QStringLiteral("WakuShareTimelineEventsV1"),Qt::FindDirectChildrenOnly)){
            const auto table=ExplorerProject::read<quintptr>(reinterpret_cast<quintptr>(old));HMODULE owner=nullptr;
            if(!GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS|GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,reinterpret_cast<LPCWSTR>(table),&owner) || owner!=GetModuleHandleW(L"CapSync.ExplorerProductCatalogV5.dll"))throw std::runtime_error("old timeline observer ownership differs");
            delete old;result.insert("oldLifetimeObserverRetired",true);
        }
        if(!relay){relay=new ExplorerTimelineEventsV2(target);try{relay->start();}catch(...){delete relay;throw;}}
#ifdef CAPSYNC_TIMELINE_HEALTH
        if(!relay->healthy())throw std::runtime_error("timeline lifetime observation settling or capacity exceeded");
#endif
        result.insert("timelineChildRelay",true);result.insert("timelineRelayVersion",2);result.insert("timelineRecoveries",relay->recoveries());result.insert("timelineLifetimeWatchers",relay->watched());
#endif
#ifdef CAPSYNC_TIMELINE_EVENTS
        // Structural draft updates, never playback/cursor/frame notifications.
        // Connections belong to the existing host and disappear with its lease.
        QList<QPointer<QObject>> objects{QCoreApplication::instance()};
        for(auto* window:QGuiApplication::allWindows())objects.append(window);
        QSet<QObject*> seen;QSet<QQmlContext*> contexts;QJsonArray timelineClasses;int timelineWatchers=0;
#ifdef CAPSYNC_TIMELINE_VISUAL_TREE
        QMap<QString,int> encountered;
#endif
#ifdef CAPSYNC_TIMELINE_MODEL_METADATA
        QJsonArray modelMetadata;
#endif
        while(!objects.isEmpty() && seen.size()<50000){
            auto* object=objects.takeLast().data();
            if(!object || seen.contains(object) || object->thread()!=QThread::currentThread())continue;
            seen.insert(object);
#ifdef CAPSYNC_TIMELINE_VISUAL_TREE
            const auto className=QString::fromLatin1(object->metaObject()->className());
            if(className.contains(QStringLiteral("timeline"),Qt::CaseInsensitive))++encountered[className];
            if(auto* window=qobject_cast<QQuickWindow*>(object))objects.append(window->contentItem());
            if(auto* item=qobject_cast<QQuickItem*>(object))for(auto* child:item->childItems())objects.append(child);
#endif
#ifdef CAPSYNC_TIMELINE_MODEL_METADATA
            if(className==QStringLiteral("MainTimeLineViewModel") || className==QStringLiteral("MainTimeLineTrackViewModel") || className==QStringLiteral("MainTimeLineMainTrackViewModel")){
                const auto* meta=object->metaObject();QJsonArray properties,methods;
                for(int i=0;i<meta->propertyCount();++i){const auto p=meta->property(i);properties.append(QJsonObject{{"name",p.name()},{"type",p.typeName()}});}
                for(int i=0;i<meta->methodCount();++i){const auto m=meta->method(i);if(m.methodType()==QMetaMethod::Signal)methods.append(QString::fromLatin1(m.methodSignature()));}
                modelMetadata.append(QJsonObject{{"class",className},{"properties",properties},{"signals",methods}});
            }
#endif
            if(object->inherits("timeline::ITimelineModel")){
                const auto* meta=object->metaObject();const auto index=meta->indexOfSignal("draftUpdated()");
                if(index<0)throw std::runtime_error("timeline structural signal absent");
                QObject::connect(object,meta->method(index),target,slot,static_cast<Qt::ConnectionType>(Qt::QueuedConnection|Qt::UniqueConnection));
                ++timelineWatchers;timelineClasses.append(QString::fromLatin1(meta->className()));
            }
            for(auto* child:object->children())objects.append(child);
            if(auto* engine=qobject_cast<QQmlEngine*>(object))objects.append(engine->rootContext());
            auto* context=qobject_cast<QQmlContext*>(object);if(!context)context=QQmlEngine::contextForObject(object);
            int depth=0;
            while(context && !contexts.contains(context) && depth++<64 && context->thread()==QThread::currentThread()){
                contexts.insert(context);if(auto* model=context->contextObject())objects.append(model);
                objects.append(context);context=context->parentContext();
            }
        }
        if(!objects.isEmpty())throw std::runtime_error("timeline object scope overflow");
        result.insert("timelineWatchers",timelineWatchers);result.insert("timelineClasses",timelineClasses);
        result.insert("timelineObjectsVisited",seen.size());
#ifdef CAPSYNC_TIMELINE_VISUAL_TREE
        QJsonObject inventory;for(auto i=encountered.cbegin();i!=encountered.cend();++i)inventory.insert(i.key(),i.value());
        result.insert("timelineObjectClasses",inventory);
#endif
#ifdef CAPSYNC_TIMELINE_MODEL_METADATA
        result.insert("timelineModelMetadata",modelMetadata);
#endif
#endif
#endif
#ifdef CAPSYNC_LIVE_SOURCE_NAMES
        QJsonArray sourceNames;QSet<QString> sourceIds;
        for(const auto& group:{QStringLiteral("videos"),QStringLiteral("audios")})for(const auto entry:live.value("materials").toObject().value(group).toArray()){
            const auto row=entry.toObject();const auto id=row.value("id").toString(),path=row.value("path").toString();if(path.isEmpty())continue;
            const auto nameField=group==QStringLiteral("audios")?QStringLiteral("name"):QStringLiteral("material_name");const auto name=row.value(nameField).toString();
            if(static_cast<std::size_t>(sourceNames.size())>=ExplorerLimits::materialCount || id.isEmpty() || sourceIds.contains(id) || path.size()>1024 || name.size()>4096)throw std::runtime_error("live source-name bounds changed");sourceIds.insert(id);
            sourceNames.append(QJsonObject{{"id",id},{"path",path},{"name",name},{"group",group},{"field",nameField},{"type",row.value("type")},{"localMaterialId",row.value("local_material_id")}});
        }
        liveDraft.verify();result.insert("liveSourceNames",sourceNames);result.insert("wholeSdkDraftUnchanged",true);
#ifdef CAPSYNC_LIVE_DRAFT_SIDECAR
        const auto sidecar=QString::fromWCharArray(request.output)+QStringLiteral(".draft.json");
        if(QFileInfo(sidecar).exists())throw std::runtime_error("live Draft sidecar already exists");
        QSaveFile draftOutput(sidecar);if(!draftOutput.open(QIODevice::WriteOnly) || draftOutput.write(liveDraft.text.data(),static_cast<qint64>(liveDraft.text.size()))!=static_cast<qint64>(liveDraft.text.size()) || !draftOutput.commit())throw std::runtime_error("live Draft sidecar unavailable");
        result.insert("liveDraftSidecar",sidecar);
#endif
#endif
        result.insert("status","read");result.insert("draftId",identity.draftId);result.insert("location",identity.location);
        result.insert("materials",materials);result.insert("wholeSdkBinExact",true);
    }catch(const std::exception& error){result.insert("reason",QString::fromLatin1(error.what()));}
    QSaveFile output(QString::fromWCharArray(request.output));const auto bytes=QJsonDocument(result).toJson(QJsonDocument::Indented);
    if(output.open(QIODevice::WriteOnly) && output.write(bytes)==bytes.size())output.commit();
}
}
extern "C" __declspec(dllexport) DWORD WINAPI CapSync_CatalogReadThread(LPVOID raw) {
    const auto* r=static_cast<const Request*>(raw);if(!r || r->size!=sizeof(Request) || r->version!=1 || !std::wmemchr(r->output,0,1024))return 2;
    auto* app=QCoreApplication::instance();if(!app || std::strcmp(qVersion(),"6.2.2"))return 3;
    const QFileInfo output(QString::fromWCharArray(r->output));if(!output.isAbsolute() || !output.dir().exists() || output.exists())return 4;
    HMODULE pinned=nullptr;if(!GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS|GET_MODULE_HANDLE_EX_FLAG_PIN,reinterpret_cast<LPCWSTR>(&CapSync_CatalogReadThread),&pinned))return 5;
    const Request copy=*r;return QMetaObject::invokeMethod(app,[copy]{perform(copy);},Qt::QueuedConnection)?1:6;
}
BOOL WINAPI DllMain(HINSTANCE instance,DWORD reason,LPVOID){if(reason==DLL_PROCESS_ATTACH)DisableThreadLibraryCalls(instance);return TRUE;}
