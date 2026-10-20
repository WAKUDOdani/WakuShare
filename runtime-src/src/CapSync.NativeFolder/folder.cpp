#include "../CapSync.NativeExplorerObserve/material_limits.h"
// Lab-only native-owned FileMetaData construction and addressed folder append.
#include "../CapSync.NativeProbe/qt62_compat.h"
#include <Windows.h>
#include <QtCore/QCoreApplication>
#include <QtCore/QFile>
#include <QtCore/QFileInfo>
#include <QtCore/QDir>
#include <QtCore/QDateTime>
#include <QtCore/QUuid>
#include <QtCore/QJsonDocument>
#include <QtCore/QJsonObject>
#include <QtCore/QSaveFile>
#include <QtCore/QThread>
#include <QtGui/QGuiApplication>
#include <cstring>
#include <cwchar>
#include <map>
#include <vector>
#include <string>
#include <stdexcept>
#ifdef CAPSYNC_EXPLORER_RUNTIME
#include "../CapSync.NativeExplorerObserve/runtime_guard.h"
#endif

struct Request {
    unsigned size,version,action;
    wchar_t source[1024],root[1024],meta[1024],output[1024];
    char jobId[37],folderId[37],parentId[37];
#ifdef CAPSYNC_EXPLORER_RUNTIME
    wchar_t name[81];ExplorerRuntimeLease lease;
#endif
};
namespace {
template<typename T> T read(quintptr address) {
    T value{}; SIZE_T copied=0;
    if(address<0x10000 || !ReadProcessMemory(GetCurrentProcess(),reinterpret_cast<LPCVOID>(address),&value,sizeof(value),&copied)
        || copied!=sizeof(value)) throw std::runtime_error("memory changed");
    return value;
}
QObject* object(quintptr address,const char* name) {
    const auto data=read<quintptr>(address+8);
    if(read<quintptr>(data+8)!=address || (read<unsigned>(data+48)&0x0c)) throw std::runtime_error("QObject lifetime changed");
    auto* result=reinterpret_cast<QObject*>(address);
    if(std::strcmp(result->metaObject()->className(),name)) throw std::runtime_error("wrong QObject type");
    return result;
}
QByteArray string(quintptr address) {
    const auto length=read<quintptr>(address+16),capacity=read<quintptr>(address+24);
    if(length>4096 || capacity<length || capacity>1024*1024) throw std::runtime_error("unknown string layout");
    QByteArray result(static_cast<qsizetype>(length),'\0'); SIZE_T copied=0;
    const auto text=capacity<16?address:read<quintptr>(address);
    if(length && (!ReadProcessMemory(GetCurrentProcess(),reinterpret_cast<LPCVOID>(text),result.data(),length,&copied) || copied!=length))
        throw std::runtime_error("string changed");
    return result;
}
QByteArray id(QObject* node) {return string(read<quintptr>(reinterpret_cast<quintptr>(node)+0x10));}
void save(const QString& path,QJsonObject result,const Request& request) {
    result.insert("jobId",QString::fromLatin1(request.jobId));
    QSaveFile file(path);if(file.open(QIODevice::WriteOnly)){file.write(QJsonDocument(result).toJson());file.commit();}
}
// Layout and construction exactly match newFolderRequest in this verified build:
// native allocation 0x2C8, control block 16 bytes, native ctor for remaining 0x2B8.
struct NativeMetadata {
    struct Pair {quintptr data,control;} pair{};
    explicit NativeMetadata(quintptr creator) {
        using Allocate=void*(__fastcall*)(size_t);
        using Construct=void(__fastcall*)(void*);
        auto* block=static_cast<unsigned char*>(reinterpret_cast<Allocate>(creator+0x6db4c20)(0x2c8));
        if(!block)throw std::bad_alloc();
        std::memset(block,0,0x2c8);
        *reinterpret_cast<quintptr*>(block)=creator+0xa1da828;
        *reinterpret_cast<LONG*>(block+8)=1;*reinterpret_cast<LONG*>(block+12)=1;
        pair={reinterpret_cast<quintptr>(block+16),reinterpret_cast<quintptr>(block)};
        reinterpret_cast<Construct>(creator+0x1532680)(block+16);
    }
    NativeMetadata(const NativeMetadata&)=delete;
    ~NativeMetadata() {
        if(!pair.control)return;
        using Release=void(__fastcall*)(void*);
        auto* block=reinterpret_cast<unsigned char*>(pair.control);
        if(InterlockedDecrement(reinterpret_cast<LONG*>(block+8))==0){
            const auto table=*reinterpret_cast<quintptr*>(block);
            reinterpret_cast<Release>(*reinterpret_cast<quintptr*>(table))(block);
            if(InterlockedDecrement(reinterpret_cast<LONG*>(block+12))==0)
                reinterpret_cast<Release>(*reinterpret_cast<quintptr*>(table+8))(block);
        }
    }
    void configure(quintptr creator,const QByteArray& identifier,const QByteArray& name) {
        static_assert(sizeof(std::string)==32,"Unsupported string ABI");
        using Assign=void(__fastcall*)(void*,const std::string&);
        const std::string key(identifier.constData(),static_cast<size_t>(identifier.size()));
        const std::string title(name.constData(),static_cast<size_t>(name.size()));
        reinterpret_cast<Assign>(creator+0xb74f10)(reinterpret_cast<void*>(pair.data),key);
        reinterpret_cast<Assign>(creator+0xb74f10)(reinterpret_cast<void*>(pair.data+0x98),title);
        *reinterpret_cast<unsigned*>(pair.data+0x138)=4;
        const auto ms=QDateTime::currentMSecsSinceEpoch();
        *reinterpret_cast<qint64*>(pair.data+0x40)=ms/1000;
        *reinterpret_cast<qint64*>(pair.data+0x48)=ms*1000;
        *reinterpret_cast<qint64*>(pair.data+0x50)=ms/1000;
    }
};
void perform(Request request) {
    const auto output=QString::fromWCharArray(request.output);bool appended=false;
    try {
        if(QThread::currentThread()!=QCoreApplication::instance()->thread())throw std::runtime_error("wrong thread");
#ifdef CAPSYNC_EXPLORER_RUNTIME
        ExplorerRuntime::check(request.lease);
#endif
        QFile file(QString::fromWCharArray(request.meta));if(!file.open(QIODevice::ReadOnly))throw std::runtime_error("metadata unavailable");
        const auto meta=QJsonDocument::fromJson(file.readAll()).object();
#ifdef CAPSYNC_PRODUCT_RUNTIME
        ExplorerProject::metadata(meta,QString::fromWCharArray(request.meta));
#else
        if(meta.value("draft_id").toString()!=QStringLiteral("582F1BF9-2B25-4cf2-B83F-3528F1B868B2") ||
            meta.value("draft_name").toString()!=QStringLiteral("CapSync-Lab-20261013-001"))throw std::runtime_error("not lab project");
#endif
        const auto root=QFileInfo(QString::fromWCharArray(request.root)).canonicalFilePath();
        const auto source=QFileInfo(QString::fromWCharArray(request.source)).canonicalFilePath();
        if(root.isEmpty() ||
#ifdef CAPSYNC_PRODUCT_RUNTIME
            (source.compare(root,Qt::CaseInsensitive) && !source.startsWith(root+QLatin1Char('/'),Qt::CaseInsensitive)) || !QFileInfo(root).isDir() || !QFileInfo(source).isDir())throw std::runtime_error("outside selected source root");
#else
            !root.endsWith(QStringLiteral("/research/fixtures/AutoAddLab"),Qt::CaseInsensitive) ||
            !source.startsWith(root+QLatin1Char('/'),Qt::CaseInsensitive) || !QFileInfo(source).isDir())throw std::runtime_error("outside source root");
#endif
#ifdef CAPSYNC_EXPLORER_RUNTIME
        if(!std::wmemchr(request.name,0,81))throw std::runtime_error("folder name absent");
        const auto name=QString::fromWCharArray(request.name);
#else
        const auto name=QFileInfo(source).fileName();
#endif
        if(name.isEmpty() || name==QStringLiteral(".") || name==QStringLiteral(".."))throw std::runtime_error("invalid directory name");
        const auto creator=reinterpret_cast<quintptr>(GetModuleHandleW(L"VECreator.dll"));
        wchar_t creatorPath[1024]{};
        if(!GetModuleFileNameW(reinterpret_cast<HMODULE>(creator),creatorPath,1024) ||
            QFileInfo(QString::fromWCharArray(creatorPath)).dir().dirName()!=QStringLiteral("9.6.0.4097"))
            throw std::runtime_error("folder bridge requires release 9.6.0.4097");
        const auto service=read<quintptr>(creator+0xec16c18),current=read<quintptr>(service+0x70),drop=read<quintptr>(service+0x78);
        object(current,"FileMetaDataNode");auto* tree=object(read<quintptr>(current+0x30),"FileMetaDataTree");
        auto* grid=object(reinterpret_cast<quintptr>(tree->parent()),"LocalMediaInfoGridViewModel");
        std::map<QByteArray,QObject*> nodes;std::vector<QObject*> pending;
        for(auto* node:tree->children())pending.push_back(node);
        while(!pending.empty()){
            auto* node=pending.back();pending.pop_back();object(reinterpret_cast<quintptr>(node),"FileMetaDataNode");
            if(read<quintptr>(reinterpret_cast<quintptr>(node)+0x30)!=reinterpret_cast<quintptr>(tree) || static_cast<std::size_t>(nodes.size())>ExplorerLimits::materialCount || !nodes.emplace(id(node),node).second)
                throw std::runtime_error("invalid media tree");
            for(auto* child:node->children())pending.push_back(child);
        }
#ifndef CAPSYNC_PRODUCT_RUNTIME
        for(const auto key:{"963b593d-fae8-4af9-a487-29f0e73c8be5","f3fd343f-a805-42f7-9109-49e1dc8da258","9fa014be-4728-46ff-aedc-3327a8cc6b63"})
            if(!nodes.count(key))throw std::runtime_error("different active project tree");
#endif
        const auto parent=nodes.find(request.parentId);if(parent==nodes.end())throw std::runtime_error("parent absent");
        if(nodes.count(request.folderId))throw std::runtime_error("folder ID already exists; reconcile instead");
#ifndef CAPSYNC_EXPLORER_RUNTIME
        bool ownedParent=false;
        for(auto* node=parent->second;node && node!=tree;node=node->parent())
            if(id(node)=="f3fd343f-a805-42f7-9109-49e1dc8da258")ownedParent=true;
        if(!ownedParent)throw std::runtime_error("parent outside ManagedB");
#endif
        const HWND foreground=GetForegroundWindow();POINT before{},after{};GetCursorPos(&before);
        auto* focus=QGuiApplication::focusObject();
        QJsonObject result;
        {
            NativeMetadata data(creator);data.configure(creator,request.folderId,name.toUtf8());
            if(string(data.pair.data)!=request.folderId || string(data.pair.data+0x98)!=name.toUtf8() || read<unsigned>(data.pair.data+0x138)!=4)
                throw std::runtime_error("native metadata construction failed");
            result={{"metadataConstructed",true},{"nativeSharedCount",static_cast<int>(read<unsigned>(data.pair.control+8))}};
            if(request.action==1){
#ifdef CAPSYNC_EXPLORER_RUNTIME
                ExplorerRuntime::check(request.lease);
#endif
                using Append=QObject*(__fastcall*)(const NativeMetadata::Pair*,QObject*);
                appended=true;
                auto* node=reinterpret_cast<Append>(creator+0x5e124a0)(&data.pair,parent->second);
                if(!node || id(node)!=request.folderId || node->parent()!=parent->second)throw std::runtime_error("folder append unverified");
                using Persist=void(__fastcall*)(quintptr);
                reinterpret_cast<Persist>(creator+0x5e121e0)(service);
                if(!QMetaObject::invokeMethod(grid,"onFileMetaTreeUpdated",Qt::DirectConnection))throw std::runtime_error("tree refresh unavailable");
                result.insert("folderAppended",true);
            }
        } // Native destructor/control block release is exercised before receipt.
        GetCursorPos(&after);
        result.insert("status",request.action==0?"smoke-ok":"created");
        result.insert("folderId",QString::fromLatin1(request.folderId));result.insert("name",name);
        result.insert("navigationUnchanged",read<quintptr>(service+0x70)==current && read<quintptr>(service+0x78)==drop);
        result.insert("foregroundUnchanged",foreground==GetForegroundWindow());result.insert("focusUnchanged",focus==QGuiApplication::focusObject());
        result.insert("cursorUnchanged",before.x==after.x && before.y==after.y);
        save(output,result,request);
    }catch(const std::exception& error){save(output,{{"status",appended?"unknown":"rejected"},{"reason",QString::fromLatin1(error.what())}},request);}
}
}
extern "C" __declspec(dllexport) DWORD WINAPI CapSync_FolderCommandThread(LPVOID raw) {
    try {
        const auto* r=static_cast<const Request*>(raw);
        if(!r || r->size!=sizeof(Request) || r->version!=1 || r->action>1 || !std::wmemchr(r->source,L'\0',1024)
            || !std::wmemchr(r->root,L'\0',1024) || !std::wmemchr(r->meta,L'\0',1024) || !std::wmemchr(r->output,L'\0',1024)
            || !std::memchr(r->jobId,'\0',37) || !std::memchr(r->folderId,'\0',37) || !std::memchr(r->parentId,'\0',37))return static_cast<DWORD>(-1);
        if(QUuid(QString::fromLatin1(r->folderId)).isNull() || QUuid(QString::fromLatin1(r->jobId)).isNull())return static_cast<DWORD>(-2);
        const QFileInfo output(QString::fromWCharArray(r->output));
        if(!output.isAbsolute() || output.dir().dirName()!=QStringLiteral("evidence") || !output.dir().exists() || output.exists())return static_cast<DWORD>(-3);
        auto* app=QCoreApplication::instance();if(!app || std::strcmp(qVersion(),"6.2.2"))return static_cast<DWORD>(-4);
        HMODULE module=nullptr;if(!GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS|GET_MODULE_HANDLE_EX_FLAG_PIN,
            reinterpret_cast<LPCWSTR>(&CapSync_FolderCommandThread),&module))return static_cast<DWORD>(-5);
        const Request copy=*r;return QMetaObject::invokeMethod(app,[copy]{perform(copy);},Qt::QueuedConnection)?1:static_cast<DWORD>(-6);
    }catch(...){return static_cast<DWORD>(-7);}
}
BOOL WINAPI DllMain(HINSTANCE instance,DWORD reason,LPVOID){if(reason==DLL_PROCESS_ATTACH)DisableThreadLibraryCalls(instance);return TRUE;}
