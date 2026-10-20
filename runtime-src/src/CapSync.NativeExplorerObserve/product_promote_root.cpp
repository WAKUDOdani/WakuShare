// Promote a proven legacy synchronized folder, retaining every child/SDK ID.
#include "runtime_guard.h"
#include "../CapSync.NativeAdd/bin_snapshot.h"
#include "draft_snapshot.h"
#include <QtCore/QCoreApplication>
#include <QtCore/QJsonArray>
#include <QtCore/QSaveFile>
#include <QtCore/QMetaMethod>
#include <QtCore/QPointer>
#include <QtGui/QGuiApplication>
#include <vector>
struct Request{unsigned size,version;wchar_t output[1024],name[81];char folderId[37],parentId[37];ExplorerRuntimeLease lease;};
namespace {
void perform(Request r){
    QJsonObject result{{"status","rejected"}};bool dispatched=false;
    try{
        ExplorerRuntime::check(r.lease);const auto identity=ExplorerSession::current();auto* grid=ExplorerProject::grid();
        const auto creator=reinterpret_cast<quintptr>(GetModuleHandleW(L"VECreator.dll"));
        const auto service=ExplorerProject::read<quintptr>(creator+0xec16c18),current=ExplorerProject::read<quintptr>(service+0x70),drop=ExplorerProject::read<quintptr>(service+0x78);
        auto* tree=ExplorerProject::object(ExplorerProject::read<quintptr>(current+0x30),"FileMetaDataTree");
        QObject* folder=nullptr;QObject* root=nullptr;QObject* parent=nullptr;QList<QObject*> pending=tree->children();
        while(!pending.isEmpty()){
            auto* node=pending.takeLast();const auto id=ExplorerProject::nodeId(node);
            if(id==QString::fromLatin1(r.folderId))folder=node;
            if(id==QString::fromLatin1(r.parentId))parent=node;
            if(id.isEmpty() && node->parent()==tree)root=node;
            for(auto* child:node->children())pending.append(child);
        }
        if(!folder || !root || !parent || folder==parent || parent->parent()!=root || folder->parent()!=parent)throw std::runtime_error("legacy folder ancestry differs");
        const auto data=ExplorerProject::read<quintptr>(reinterpret_cast<quintptr>(folder)+0x10),parentData=ExplorerProject::read<quintptr>(reinterpret_cast<quintptr>(parent)+0x10);
        if(ExplorerProject::read<unsigned>(data+0x138)!=4 || ExplorerProject::read<unsigned>(parentData+0x138)!=4 ||
           ExplorerProject::nativeText(data+0x98,4096)!=QString::fromWCharArray(r.name) || ExplorerProject::nativeText(parentData+0x98,4096)!=QStringLiteral("WakuShare"))throw std::runtime_error("legacy folder identity differs");
        if((GetAsyncKeyState(VK_LBUTTON)&0x8000)||(GetAsyncKeyState(VK_RBUTTON)&0x8000))throw std::runtime_error("active pointer interaction");
        BinSnapshot sdk(creator,ExplorerProject::document(identity.location,QStringLiteral("draft_meta_info.json")));ExplorerDraftSnapshot::Snapshot draft;
        const auto focus=QGuiApplication::focusObject();const auto foreground=GetForegroundWindow();QPointer<QObject> stable(folder);
        const auto metadata=*reinterpret_cast<const std::shared_ptr<void>*>(reinterpret_cast<quintptr>(folder)+0x10);
        const std::vector<QObject*> moving{folder};using Move=void(__fastcall*)(QObject*,const std::vector<QObject*>&);
        dispatched=true;reinterpret_cast<Move>(creator+0x5e0ece0)(root,moving);
        if(!stable || folder->parent()!=root)throw std::runtime_error("root promotion unconfirmed");
        using Save=void(__fastcall*)(quintptr);reinterpret_cast<Save>(creator+0x5e121e0)(service);
        if(!QMetaObject::invokeMethod(grid,"onFileMetaTreeUpdated",Qt::DirectConnection))throw std::runtime_error("stock save unavailable");
        bool removed=false;
        if(parent!=reinterpret_cast<QObject*>(current) && parent->children().isEmpty()){
            const auto manager=reinterpret_cast<quintptr(__fastcall*)()>(creator+0x1bf3d80)();
            if(!manager || !reinterpret_cast<quintptr(__fastcall*)(quintptr,QObject*)>(creator+0x1bf3e30)(manager,parent))throw std::runtime_error("empty legacy container model unavailable");
            const auto index=grid->metaObject()->indexOfMethod("onRemoveSelectedChildNodes(std::vector<QPointer<FileMetaDataNode>>)");
            if(index<0)throw std::runtime_error("stock empty folder removal unavailable");
            std::vector<QPointer<QObject>> selected{QPointer<QObject>(parent)};
            if(!grid->metaObject()->method(index).invoke(grid,Qt::DirectConnection,QGenericArgument("std::vector<QPointer<FileMetaDataNode>>",&selected)))throw std::runtime_error("empty container removal unconfirmed");
            removed=true;
        }
        using Rebuild=void(__fastcall*)(QObject*);reinterpret_cast<Rebuild>(creator+0x29e1e20)(grid);
        sdk.verify();draft.verify();ExplorerRuntime::check(r.lease);
        result.insert("status","promoted");result.insert("removedEmptyLegacyContainer",removed);result.insert("sdkBinUnchanged",true);result.insert("sdkDraftUnchanged",true);
        result.insert("navigationUnchanged",ExplorerProject::read<quintptr>(service+0x70)==current && ExplorerProject::read<quintptr>(service+0x78)==drop);
        result.insert("focusUnchanged",focus==QGuiApplication::focusObject());result.insert("foregroundUnchanged",foreground==GetForegroundWindow());
    }catch(const std::exception& e){result.insert("status",dispatched?"unknown":"rejected");result.insert("reason",e.what());}
    QSaveFile file(QString::fromWCharArray(r.output));if(file.open(QIODevice::WriteOnly)){file.write(QJsonDocument(result).toJson());file.commit();}
}
}
extern "C" __declspec(dllexport) DWORD WINAPI CapSync_ProductPromoteRootThread(LPVOID raw){
    auto* r=static_cast<Request*>(raw);
    if(!r || r->size!=sizeof(Request) || r->version!=1 || !std::wmemchr(r->output,0,1024) || !std::wmemchr(r->name,0,81) || !std::memchr(r->folderId,0,37) || !std::memchr(r->parentId,0,37))return 2;
    auto* app=QCoreApplication::instance();if(!app || QFileInfo(QString::fromWCharArray(r->output)).exists())return 3;
    HMODULE pinned=nullptr;if(!GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS|GET_MODULE_HANDLE_EX_FLAG_PIN,reinterpret_cast<LPCWSTR>(&CapSync_ProductPromoteRootThread),&pinned))return 4;
    const auto copy=*r;return QMetaObject::invokeMethod(app,[copy]{perform(copy);},Qt::QueuedConnection)?1:5;
}
BOOL WINAPI DllMain(HINSTANCE instance,DWORD reason,LPVOID){if(reason==DLL_PROCESS_ATTACH)DisableThreadLibraryCalls(instance);return TRUE;}
