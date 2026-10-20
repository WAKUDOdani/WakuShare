#pragma once
#include "session_identity.h"
#include <QtCore/QFile>
#include <QtCore/QJsonDocument>
#include <QtCore/QJsonObject>
#include <QtCore/QJsonArray>
#include <QtCore/QSet>
#include "stock_service_scope.h"
#include "material_limits.h"

// A project is owned by its live SDK identity and complete tree, never its name.
namespace ExplorerProject {
template<class T>T read(quintptr address){
    T value{};SIZE_T count=0;
    if(address<0x10000 || !ReadProcessMemory(GetCurrentProcess(),reinterpret_cast<void*>(address),&value,sizeof value,&count) || count!=sizeof value)throw std::runtime_error("project scope unreadable");
    return value;
}
inline QObject* object(quintptr address,const char* type){
    const auto data=read<quintptr>(address+8);
    if(read<quintptr>(data+8)!=address || (read<unsigned>(data+48)&0x0c))throw std::runtime_error("project object lifetime changed");
    auto* object=reinterpret_cast<QObject*>(address);
    if(object->thread()!=QThread::currentThread() || std::strcmp(object->metaObject()->className(),type))throw std::runtime_error("project object type changed");
    return object;
}
inline QJsonObject document(const QString& location,const QString& name){
    QFile file(location+QLatin1Char('/')+name);
    if(QFileInfo(file.fileName()).canonicalPath().compare(location,Qt::CaseInsensitive) || !file.open(QIODevice::ReadOnly) || file.size()>32*1024*1024)throw std::runtime_error("project document unavailable");
    const auto parsed=QJsonDocument::fromJson(file.readAll());
    if(!parsed.isObject())throw std::runtime_error("project document invalid");return parsed.object();
}
inline void metadata(const QJsonObject& meta,const QString& path){
    const auto current=ExplorerSession::current();
    if(meta.value("draft_id").toString().toUpper()!=current.draftId || QFileInfo(path).canonicalPath().compare(current.location,Qt::CaseInsensitive) || QFileInfo(path).fileName()!=QStringLiteral("draft_meta_info.json"))throw std::runtime_error("metadata belongs to another active project");
}
inline QString nativeText(quintptr data,quintptr bound){
    const auto length=read<quintptr>(data+16),capacity=read<quintptr>(data+24);
    if(length>bound || capacity<length || capacity>1024*1024)throw std::runtime_error("project node text invalid");
    QByteArray value(static_cast<qsizetype>(length),'\0');SIZE_T count=0;
    if(length && (!ReadProcessMemory(GetCurrentProcess(),reinterpret_cast<void*>(capacity<16?data:read<quintptr>(data)),value.data(),length,&count) || count!=length))throw std::runtime_error("project node identity unreadable");
    return QString::fromUtf8(value);
}
inline QString nodeId(QObject* node){return nativeText(read<quintptr>(reinterpret_cast<quintptr>(node)+0x10),64);}
inline QObject* grid(){
    const auto identity=ExplorerSession::current();
    const auto meta=document(identity.location,QStringLiteral("draft_meta_info.json"));metadata(meta,identity.location+QStringLiteral("/draft_meta_info.json"));
    const bool implicitStore=!QFileInfo::exists(identity.location+QStringLiteral("/draft_virtual_store.json"));
    const auto store=implicitStore?QJsonObject():document(identity.location,QStringLiteral("draft_virtual_store.json"));
    QSet<QString> expected,optional;
    for(const auto group:meta.value("draft_materials").toArray())for(const auto entry:group.toObject().value("value").toArray()){
        const auto row=entry.toObject();const auto id=row.value("id").toString();
        if(id.isEmpty() || expected.contains(id) || optional.contains(id))throw std::runtime_error("project registry identity duplicated");
        if(row.value("metetype").toString()==QStringLiteral("none") && row.value("file_Path").toString().isEmpty())optional.insert(id);else expected.insert(id);
    }
    bool rootSeen=false;
    for(const auto group:store.value("draft_virtual_store").toArray())if(group.toObject().value("type").toInt(-1)==0)for(const auto entry:group.toObject().value("value").toArray()){
        const auto row=entry.toObject();const auto id=row.value("id").toString();
        if(id.isEmpty()){if(rootSeen || !row.value("display_name").toString().isEmpty())throw std::runtime_error("project virtual root changed");rootSeen=true;optional.insert(id);continue;}
        if(expected.contains(id))throw std::runtime_error("project folder identity duplicated");expected.insert(id);
    }
    if(implicitStore && (!expected.isEmpty() || !optional.isEmpty()))throw std::runtime_error("nonempty project hierarchy unavailable");
    const auto creator=reinterpret_cast<quintptr>(GetModuleHandleW(L"VECreator.dll"));const auto service=read<quintptr>(creator+0xec16c18),current=read<quintptr>(service+0x70);
    object(current,"FileMetaDataNode");auto* tree=object(read<quintptr>(current+0x30),"FileMetaDataTree");auto* grid=object(reinterpret_cast<quintptr>(tree->parent()),"LocalMediaInfoGridViewModel");
    QList<QObject*> pending=tree->children();QSet<QString> seen;
    while(!pending.isEmpty()){
        auto* node=pending.takeLast();object(reinterpret_cast<quintptr>(node),"FileMetaDataNode");const auto id=nodeId(node);
        if(static_cast<std::size_t>(seen.size())>=ExplorerLimits::materialCount || seen.contains(id) || read<quintptr>(reinterpret_cast<quintptr>(node)+0x30)!=reinterpret_cast<quintptr>(tree))throw std::runtime_error("project media tree ownership changed");
#if CAPSYNC_PRODUCT_GENERATION >= 5
        if(!expected.contains(id) && !optional.contains(id)){
            const auto data=read<quintptr>(reinterpret_cast<quintptr>(node)+0x10);
            auto* parent=node->parent();
            const bool root=parent==tree || (parent && nodeId(object(reinterpret_cast<quintptr>(parent),"FileMetaDataNode")).isEmpty());
            if(ExplorerStockService::empty(id,read<unsigned>(data+0x138),nativeText(data+0x58,8192),nativeText(data+0x98,4096),root,node->children().isEmpty()))optional.insert(id);
            if(implicitStore && ExplorerStockService::root(id,read<unsigned>(data+0x138),nativeText(data+0x58,8192),nativeText(data+0x98,4096),parent==tree))optional.insert(id);
        }
#endif
        seen.insert(id);for(auto* child:node->children())pending.append(child);
    }
    const auto missing=expected-seen,extra=seen-expected-optional;
    if(implicitStore && !seen.contains(QString()))throw std::runtime_error("implicit project root absent");
    if(!missing.isEmpty() || !extra.isEmpty())throw std::runtime_error((QStringLiteral("active tree differs from project registry; missing=")+QStringList(missing.values()).join(',')+QStringLiteral("; extra=")+QStringList(extra.values()).join(',')).toStdString());
    const auto after=ExplorerSession::current();if(after.project!=identity.project || after.store!=identity.store)throw std::runtime_error("project changed during tree validation");
    return grid;
}
}
