#include "../Adaptive/fault_boundary.h"
// Read only saved documents through the current StoreWrapper. No save or editor command.
#include "runtime_guard.h"
#include "saved_document.h"
#include <QtCore/QSaveFile>
#include <QtCore/QCryptographicHash>
#include <QtCore/QCoreApplication>
#include <QtGui/QGuiApplication>
struct Request { unsigned size,version; wchar_t output[1024]; ExplorerRuntimeLease lease; };
namespace {
void perform(const Request& r){
 QJsonObject result{{"status","rejected"},{"projectMutation",false}};
 try{
  ExplorerRuntime::check(r.lease);const auto identity=ExplorerSession::current();
  const auto focus=QGuiApplication::focusObject();const auto foreground=GetForegroundWindow();
  QJsonObject documents,hashes;QMap<QString,QByteArray> originals;
  const QStringList names={"draft_content.json","draft_meta_info.json","draft_virtual_store.json","template-2.tmp"};
  for(const auto& name:names){
   const auto path=identity.location+QLatin1Char('/')+name;QFile file(path);
   if(!file.exists()){if(name==names[0] || name==names[1])throw std::runtime_error("project documents unavailable");hashes.insert(name,QJsonValue::Null);continue;}
   if(!file.open(QIODevice::ReadOnly) || file.size()>64*1024*1024)throw std::runtime_error("project document unavailable");
   const auto raw=file.readAll();file.close();originals.insert(name,raw);
   documents.insert(name,ExplorerSavedDocument::parse(raw,path).object());
   hashes.insert(name,QString::fromLatin1(QCryptographicHash::hash(raw,QCryptographicHash::Sha256).toHex()));
  }
  for(const auto& name:names){QFile file(identity.location+QLatin1Char('/')+name);
   if(file.exists()!=originals.contains(name) || (originals.contains(name) && (!file.open(QIODevice::ReadOnly) || file.readAll()!=originals.value(name))))throw std::runtime_error("project changed during document read");}
  ExplorerRuntime::check(r.lease);const auto after=ExplorerSession::current();
  if(identity.project!=after.project || identity.store!=after.store)throw std::runtime_error("project changed during document read");
  result.insert("status","read");result.insert("draftId",identity.draftId);result.insert("location",identity.location);
  result.insert("documents",documents);result.insert("hashes",hashes);
  result.insert("focusUnchanged",focus==QGuiApplication::focusObject());result.insert("foregroundUnchanged",foreground==GetForegroundWindow());
 }catch(const std::exception& e){result.insert("reason",e.what());}
 QSaveFile file(QString::fromWCharArray(r.output));if(file.open(QIODevice::WriteOnly)){file.write(QJsonDocument(result).toJson());file.commit();}
}
}
extern "C" __declspec(dllexport) DWORD WINAPI CapSync_ProductDocumentRead(LPVOID raw){
 auto* r=static_cast<Request*>(raw);if(!r || r->size!=sizeof(Request) || r->version!=1 || !std::wmemchr(r->output,0,1024))return 2;
 auto* app=QCoreApplication::instance();if(!app || QFileInfo(QString::fromWCharArray(r->output)).exists())return 3;
 HMODULE pin=nullptr;if(!GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS|GET_MODULE_HANDLE_EX_FLAG_PIN,reinterpret_cast<LPCWSTR>(&CapSync_ProductDocumentRead),&pin))return 4;
 const auto copy=*r;return QMetaObject::invokeMethod(app,ExplorerFaultBoundary::guarded([copy]{perform(copy);},copy.output),Qt::QueuedConnection)?1:5;
}
BOOL WINAPI DllMain(HINSTANCE instance,DWORD reason,LPVOID){if(reason==DLL_PROCESS_ATTACH)DisableThreadLibraryCalls(instance);return TRUE;}
