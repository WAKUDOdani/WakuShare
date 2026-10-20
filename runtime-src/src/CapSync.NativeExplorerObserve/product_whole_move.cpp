// Stock grouped tree moves for one mass import across the directory forest; no SDK setters.
#include "runtime_guard.h"
#include "../CapSync.NativeAdd/bin_snapshot.h"
#include "draft_snapshot.h"
#include <QtCore/QCoreApplication>
#include <QtCore/QJsonArray>
#include <QtCore/QSaveFile>
#include <QtGui/QGuiApplication>
#include <map>
struct Request{unsigned size,version;wchar_t output[1024],manifest[1024];ExplorerRuntimeLease lease;};
namespace {
void perform(Request r){QJsonObject result{{"status","rejected"}};bool dispatched=false;
#ifdef CAPSYNC_BATCH_STABLE_POST_LEASE
result.insert("mutationDispatched",false);
#endif
try{
 ExplorerRuntime::check(r.lease);const auto identity=ExplorerSession::current();auto* grid=ExplorerProject::grid();const auto creator=reinterpret_cast<quintptr>(GetModuleHandleW(L"VECreator.dll"));
 const auto service=ExplorerProject::read<quintptr>(creator+0xec16c18),current=ExplorerProject::read<quintptr>(service+0x70),drop=ExplorerProject::read<quintptr>(service+0x78);
 auto* tree=ExplorerProject::object(ExplorerProject::read<quintptr>(current+0x30),"FileMetaDataTree");std::map<QString,QObject*> nodes;QList<QObject*> pending=tree->children();while(!pending.isEmpty()){auto* n=pending.takeLast();if(!nodes.emplace(ExplorerProject::nodeId(n),n).second || nodes.size()>ExplorerLimits::materialCount)throw std::runtime_error("tree identities ambiguous");for(auto* c:n->children())pending.append(c);}
 QFile f(QString::fromWCharArray(r.manifest));if(!f.open(QIODevice::ReadOnly) || f.size()>8*1024*1024)throw std::runtime_error("batch move manifest unavailable");const auto input=QJsonDocument::fromJson(f.readAll()).object();const auto rows=input.value("materials").toArray();const auto origin=input.value("originId").toString();
 if(rows.isEmpty() || rows.size()>static_cast<int>(ExplorerLimits::materialCount) || nodes.count(origin)!=1)throw std::runtime_error("mass origin unavailable");
 std::map<QString,std::vector<QObject*>> groups;std::map<QObject*,QObject*> destinations;

 BinSnapshot sdk(creator,ExplorerProject::document(identity.location,QStringLiteral("draft_meta_info.json")));ExplorerDraftSnapshot::Snapshot draft;std::vector<QObject*> moving;std::vector<std::shared_ptr<void>> held;QSet<QString> unique;
 for(const auto item:rows){const auto row=item.toObject();const auto id=row.value("id").toString();if(unique.contains(id) || nodes.count(id)!=1)throw std::runtime_error("batch card absent or duplicate");unique.insert(id);auto* n=nodes.at(id);const auto data=ExplorerProject::read<quintptr>(reinterpret_cast<quintptr>(n)+0x10);if(!n->children().isEmpty() || n->parent()!=nodes.at(origin) || QDir::cleanPath(ExplorerProject::nativeText(data+0x58,4096)).compare(QDir::cleanPath(row.value("path").toString()),Qt::CaseInsensitive))throw std::runtime_error("batch card ownership differs");const auto targetId=row.value("targetId").toString();if(targetId.isEmpty() || nodes.count(targetId)!=1)throw std::runtime_error("mass destination absent");auto* target=nodes.at(targetId);const auto targetData=ExplorerProject::read<quintptr>(reinterpret_cast<quintptr>(target)+0x10);if(ExplorerProject::read<unsigned>(targetData+0x138)!=4)throw std::runtime_error("mass destination is not a folder");if(targetId!=origin)groups[targetId].push_back(n);destinations.emplace(n,target);moving.push_back(n);held.push_back(*reinterpret_cast<const std::shared_ptr<void>*>(reinterpret_cast<quintptr>(n)+0x10));}
 if((GetAsyncKeyState(VK_LBUTTON)&0x8000)||(GetAsyncKeyState(VK_RBUTTON)&0x8000))throw std::runtime_error("active pointer interaction");const auto focus=QGuiApplication::focusObject();const auto foreground=GetForegroundWindow();ExplorerRuntime::check(r.lease);
 dispatched=true;
#ifdef CAPSYNC_BATCH_STABLE_POST_LEASE
 result.insert("mutationDispatched",true);
#endif
 for(const auto& group:groups)reinterpret_cast<void(__fastcall*)(QObject*,const std::vector<QObject*>&)>(creator+0x5e0ece0)(nodes.at(group.first),group.second);
 for(auto* n:moving)if(n->parent()!=destinations.at(n))throw std::runtime_error("mass tree placement unconfirmed");
 reinterpret_cast<void(__fastcall*)(quintptr)>(creator+0x5e121e0)(service);if(!QMetaObject::invokeMethod(grid,"onFileMetaTreeUpdated",Qt::DirectConnection))throw std::runtime_error("stock batch save unavailable");reinterpret_cast<void(__fastcall*)(QObject*)>(creator+0x29e1e20)(grid);
 sdk.verify();draft.verify();
#ifdef CAPSYNC_BATCH_STABLE_POST_LEASE
 // The same callback has just queued the stock serializer. Validate the
 // live lease/SDK owner/tree directly; the serializer may hold its own files.
 // Complete durable documents are independently checked after it settles.
 using Check=bool(__cdecl*)(const ExplorerRuntimeLease*);const auto host=GetModuleHandleW(L"CapSync.ExplorerProductEventsV5.dll");const auto check=host?reinterpret_cast<Check>(GetProcAddress(host,"CapSync_ExplorerCheckLease")):nullptr;
 const auto after=ExplorerSession::current();if(!check || !check(&r.lease) || after.project!=identity.project || after.store!=identity.store || after.draftId!=identity.draftId || after.location!=identity.location || ExplorerProject::read<quintptr>(current+0x30)!=reinterpret_cast<quintptr>(tree) || tree->parent()!=grid)throw std::runtime_error("post-move live project lease changed");
#else
 ExplorerRuntime::check(r.lease);
#endif
 result.insert("status","moved");result.insert("count",static_cast<int>(moving.size()));result.insert("sdkBinUnchanged",true);result.insert("sdkDraftUnchanged",true);result.insert("navigationUnchanged",ExplorerProject::read<quintptr>(service+0x70)==current && ExplorerProject::read<quintptr>(service+0x78)==drop);result.insert("focusUnchanged",focus==QGuiApplication::focusObject());result.insert("foregroundUnchanged",foreground==GetForegroundWindow());
}catch(const std::exception& e){result.insert("status",dispatched?"unknown":"rejected");result.insert("reason",e.what());}QSaveFile f(QString::fromWCharArray(r.output));if(f.open(QIODevice::WriteOnly)){f.write(QJsonDocument(result).toJson());f.commit();}}
}
extern "C" __declspec(dllexport) DWORD WINAPI CapSync_ProductBatchMove(LPVOID raw){auto* r=static_cast<Request*>(raw);if(!r || r->size!=sizeof(Request) || r->version!=1 || !std::wmemchr(r->output,0,1024) || !std::wmemchr(r->manifest,0,1024))return 2;auto* app=QCoreApplication::instance();if(!app || QFileInfo(QString::fromWCharArray(r->output)).exists())return 3;HMODULE pin=nullptr;if(!GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS|GET_MODULE_HANDLE_EX_FLAG_PIN,reinterpret_cast<LPCWSTR>(&CapSync_ProductBatchMove),&pin))return 4;const auto copy=*r;return QMetaObject::invokeMethod(app,[copy]{perform(copy);},Qt::QueuedConnection)?1:5;}
BOOL WINAPI DllMain(HINSTANCE instance,DWORD reason,LPVOID){if(reason==DLL_PROCESS_ATTACH)DisableThreadLibraryCalls(instance);return TRUE;}
