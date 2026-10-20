// Read-only complete SDK/saved graph proof for the user's current empty project.
#include "project_scope.h"
#include "runtime_guard.h"
#include "../CapSync.NativeAdd/bin_snapshot.h"
#include "draft_snapshot.h"
#include <QtCore/QSaveFile>
#include <QtCore/QJsonArray>
#include <QtGui/QGuiApplication>
#include <QtCore/QCoreApplication>
struct Request{unsigned size,version;wchar_t output[1024];ExplorerRuntimeLease lease;};
namespace {
void perform(Request r){QJsonObject result{{"status","rejected"},{"projectMutation",false}};try{
 ExplorerRuntime::check(r.lease);const auto identity=ExplorerSession::current();
 const auto meta=ExplorerProject::document(identity.location,QStringLiteral("draft_meta_info.json"));ExplorerProject::metadata(meta,identity.location+QStringLiteral("/draft_meta_info.json"));
 auto* grid=ExplorerProject::grid();const auto creator=reinterpret_cast<quintptr>(GetModuleHandleW(L"VECreator.dll"));const auto service=ExplorerProject::read<quintptr>(creator+0xec16c18),current=ExplorerProject::read<quintptr>(service+0x70);auto* tree=ExplorerProject::object(ExplorerProject::read<quintptr>(current+0x30),"FileMetaDataTree");
 const auto focus=QGuiApplication::focusObject();const auto foreground=GetForegroundWindow();BinSnapshot bin(creator,meta);ExplorerDraftSnapshot::Snapshot draft;const auto saved=ExplorerProject::document(identity.location,QStringLiteral("draft_content.json"));
 const bool exact=draft.object()==saved;result.insert("wholeSdkDraftEqualsSaved",exact);QSaveFile sidecar(QString::fromWCharArray(r.output)+QStringLiteral(".draft.json"));if(!sidecar.open(QIODevice::WriteOnly))throw std::runtime_error("read-only evidence unavailable");sidecar.write(draft.text.data(),static_cast<qint64>(draft.text.size()));sidecar.commit();
 QJsonArray edges;QList<QObject*> pending=tree->children();while(!pending.isEmpty()){auto* node=pending.takeLast();if(node->parent()!=tree)edges.append(QJsonObject{{"child_id",ExplorerProject::nodeId(node)},{"parent_id",ExplorerProject::nodeId(node->parent())}});for(auto* child:node->children())pending.append(child);}
 bin.verify();draft.verify();ExplorerRuntime::check(r.lease);const auto after=ExplorerSession::current();if(after.project!=identity.project || after.store!=identity.store || tree->parent()!=grid)throw std::runtime_error("SDK project changed during read");result.insert("status","read");result.insert("draftId",identity.draftId);result.insert("location",identity.location);result.insert("sdkBinCount",static_cast<int>(bin.before.size()));result.insert("completeSdkBinEqualsSaved",true);result.insert("wholeSdkDraftUnchanged",true);result.insert("nativeEdges",edges);result.insert("focusUnchanged",focus==QGuiApplication::focusObject());result.insert("foregroundUnchanged",foreground==GetForegroundWindow());
 }catch(const std::exception& e){result.insert("reason",e.what());}QSaveFile f(QString::fromWCharArray(r.output));if(f.open(QIODevice::WriteOnly)){f.write(QJsonDocument(result).toJson());f.commit();}}
}
extern "C" __declspec(dllexport) DWORD WINAPI CapSync_ProductSavedRead(LPVOID raw){auto* r=static_cast<Request*>(raw);if(!r || r->size!=sizeof(Request) || r->version!=1 || !std::wmemchr(r->output,0,1024))return 2;auto* app=QCoreApplication::instance();if(!app || QFileInfo(QString::fromWCharArray(r->output)).exists())return 3;HMODULE pin=nullptr;if(!GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS|GET_MODULE_HANDLE_EX_FLAG_PIN,reinterpret_cast<LPCWSTR>(&CapSync_ProductSavedRead),&pin))return 4;const auto copy=*r;return QMetaObject::invokeMethod(app,[copy]{perform(copy);},Qt::QueuedConnection)?1:5;}
BOOL WINAPI DllMain(HINSTANCE instance,DWORD reason,LPVOID){if(reason==DLL_PROCESS_ATTACH)DisableThreadLibraryCalls(instance);return TRUE;}
