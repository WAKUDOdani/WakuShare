// One guarded refresh of the current media collection, never navigation/input.
#include "runtime_guard.h"
#include "../CapSync.NativeAdd/bin_snapshot.h"
#include <QtCore/QCoreApplication>
#include <QtCore/QJsonDocument>
#include <QtCore/QJsonObject>
#include <QtCore/QSaveFile>
#include <QtCore/QTimer>
#include <QtQuick/QQuickItem>
#include <QtQuick/QQuickWindow>
#include <QtGui/QGuiApplication>
#include <QtGui/QImage>
struct Request{unsigned size,version;wchar_t output[1024];ExplorerRuntimeLease lease;};
namespace {
void write(const Request& r,const QJsonObject& result){QSaveFile f(QString::fromWCharArray(r.output));if(f.open(QIODevice::WriteOnly)){f.write(QJsonDocument(result).toJson());f.commit();}}
QJsonObject state(QObject* grid,QQuickItem* view){return {{"resources",grid->property("resourceInfoCount").toInt()},{"visible",grid->property("visibleItemCount").toInt()},{"contentY",view->property("contentY").toDouble()},{"contentHeight",view->property("contentHeight").toDouble()}};}
void perform(Request r){
    QJsonObject result{{"status","rejected"},{"projectMutation",false}};
    try{
        ExplorerRuntime::check(r.lease);const auto identity=ExplorerSession::current();
        auto* grid=ExplorerProject::grid();
        auto* view=qobject_cast<QQuickItem*>(grid->property("collectionView").value<QObject*>());
        if(!view || !view->window())throw std::runtime_error("collection unavailable");
        if((GetAsyncKeyState(VK_LBUTTON)&0x8000)||(GetAsyncKeyState(VK_RBUTTON)&0x8000))throw std::runtime_error("active pointer interaction");
        const auto creator=reinterpret_cast<quintptr>(GetModuleHandleW(L"VECreator.dll"));
        const auto service=ExplorerProject::read<quintptr>(creator+0xec16c18),current=ExplorerProject::read<quintptr>(service+0x70),drop=ExplorerProject::read<quintptr>(service+0x78);
        const auto focus=QGuiApplication::focusObject();const auto foreground=GetForegroundWindow();
        BinSnapshot sdk(creator,ExplorerProject::document(identity.location,QStringLiteral("draft_meta_info.json")));
        result.insert("before",state(grid,view));
        using Rebuild=void(__fastcall*)(QObject*);
        reinterpret_cast<Rebuild>(creator+0x29e1e20)(grid);
        sdk.verify();ExplorerRuntime::check(r.lease);result.insert("sdkBinUnchanged",true);
        if(!QMetaObject::invokeMethod(view,"setContentY",Qt::DirectConnection,Q_ARG(double,0.0)) ||
           !QMetaObject::invokeMethod(view,"reload",Qt::DirectConnection))throw std::runtime_error("stock refresh unavailable");
        view->polish();view->update();view->window()->update();
        result.insert("after",state(grid,view));
        result.insert("navigationUnchanged",ExplorerProject::read<quintptr>(service+0x70)==current && ExplorerProject::read<quintptr>(service+0x78)==drop);
        result.insert("focusUnchanged",focus==QGuiApplication::focusObject());result.insert("foregroundUnchanged",foreground==GetForegroundWindow());
        result.insert("status","refreshed");write(r,result);

    }catch(const std::exception& e){result.insert("reason",e.what());write(r,result);}
}
}
extern "C" __declspec(dllexport) DWORD WINAPI CapSync_ProductMediaViewThread(LPVOID raw){
    auto* r=static_cast<Request*>(raw);if(!r || r->size!=sizeof(Request) || r->version!=1 || !std::wmemchr(r->output,0,1024))return 2;
    auto* app=QCoreApplication::instance();if(!app || QFileInfo(QString::fromWCharArray(r->output)).exists())return 3;
    HMODULE pinned=nullptr;if(!GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS|GET_MODULE_HANDLE_EX_FLAG_PIN,reinterpret_cast<LPCWSTR>(&CapSync_ProductMediaViewThread),&pinned))return 4;
    const auto copy=*r;return QMetaObject::invokeMethod(app,[copy]{perform(copy);},Qt::QueuedConnection)?1:5;
}
BOOL WINAPI DllMain(HINSTANCE instance,DWORD reason,LPVOID){if(reason==DLL_PROCESS_ATTACH)DisableThreadLibraryCalls(instance);return TRUE;}
