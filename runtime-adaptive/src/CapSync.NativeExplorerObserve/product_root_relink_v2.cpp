#include "../Adaptive/fault_boundary.h"
#include "../Adaptive/symbols.h"
// Explicit, owned root relocation. Preflight every source before any setter;
// preserve every field except the exact paths named in the private manifest.
#include "runtime_guard.h"
#include "draft_snapshot.h"
#include "../CapSync.NativeAdd/bin_snapshot.h"
#include "../../vendor/nlohmann-3.10.5/json.hpp"
#include <QtCore/QSaveFile>
#include <QtGui/QGuiApplication>
#include <map>
#include <set>
#include <functional>
#include <cstdio>
#include <QtCore/QPointer>
#include <QtCore/QMetaProperty>
namespace draft_store { struct WriteDraftJsonResult; }
using Json=nlohmann::json;
using List=std::vector<std::shared_ptr<void>>;
struct Request {unsigned size,version,action;wchar_t manifest[1024],output[1024];ExplorerRuntimeLease lease;};
namespace {
template<class T>T entry(HMODULE sdk,const Json& keys,const char* key){
 const auto info=keys.at(key);const auto address=GetProcAddress(sdk,info.at("name").get<std::string>().c_str());
 if(!address || reinterpret_cast<quintptr>(address)!=reinterpret_cast<quintptr>(sdk)+std::stoull(info.at("rva").get<std::string>(),nullptr,16))throw std::runtime_error("SDK export mismatch");
 return reinterpret_cast<T>(address);
}
std::string key(const QString& path){return QDir::cleanPath(QFileInfo(path).absoluteFilePath()).toCaseFolded().toStdString();}
bool inside(const QString& root,const QString& path){return key(path).rfind(key(root)+"/",0)==0;}
struct LockedFile {
 HANDLE handle=INVALID_HANDLE_VALUE;
 explicit LockedFile(const QString& path){handle=CreateFileW(reinterpret_cast<LPCWSTR>(path.utf16()),GENERIC_READ,FILE_SHARE_READ,nullptr,OPEN_EXISTING,FILE_FLAG_OPEN_REPARSE_POINT,nullptr);if(handle==INVALID_HANDLE_VALUE)throw std::runtime_error("source changed or is being written");}
 ~LockedFile(){if(handle!=INVALID_HANDLE_VALUE)CloseHandle(handle);}
 void verify(const Json& proof){BY_HANDLE_FILE_INFORMATION info{};if(!GetFileInformationByHandle(handle,&info) || info.dwFileAttributes&(FILE_ATTRIBUTE_REPARSE_POINT|FILE_ATTRIBUTE_DIRECTORY) || info.nNumberOfLinks!=1)throw std::runtime_error("source identity unavailable");
  char id[40]{};std::snprintf(id,sizeof(id),"%08lX:%08lX%08lX",info.dwVolumeSerialNumber,info.nFileIndexHigh,info.nFileIndexLow);
  const auto bytes=(static_cast<quint64>(info.nFileSizeHigh)<<32)|info.nFileSizeLow;
  if(proof.at("identity").get<std::string>()!=id || proof.at("bytes").get<quint64>()!=bytes)throw std::runtime_error("source physical identity changed");
 }
};
void perform(Request request){
 QJsonObject result{{"status","rejected"},{"mutationDispatched",false}};
 try{
  if(request.action>2)throw std::runtime_error("unknown root relocation action");
  ExplorerRuntime::check(request.lease);const auto identity=ExplorerSession::current();
  QFile manifest(QString::fromWCharArray(request.manifest));if(!manifest.open(QIODevice::ReadOnly) || manifest.size()>32*1024*1024)throw std::runtime_error("relocation manifest unavailable");
  const auto bytes=manifest.readAll();const auto plan=Json::parse(bytes.constData(),bytes.constData()+bytes.size());
  if(request.action==2){
   [[maybe_unused]] const auto creator=reinterpret_cast<quintptr>(GetModuleHandleW(L"VECreator.dll"));
   BinSnapshot bin(creator,ExplorerProject::document(identity.location,QStringLiteral("draft_meta_info.json")));ExplorerDraftSnapshot::Snapshot drafts;
   Json all=Json::object();for(const auto& value:drafts.snapshots){const auto parsed=Json::parse(value);all[parsed.at("id").get<std::string>()]=parsed;}
   if(plan.at("drafts")!=all)throw std::runtime_error("complete SDK timelines differ after relocation");
   bin.verify();drafts.verify();ExplorerRuntime::check(request.lease);result.insert("status","read");
   QSaveFile output(QString::fromWCharArray(request.output));if(!output.open(QIODevice::WriteOnly))throw std::runtime_error("read evidence unavailable");output.write(QJsonDocument(result).toJson());output.commit();return;
  }
  const auto oldRoot=QString::fromStdString(plan.at("oldRoot").get<std::string>()),newRoot=QString::fromStdString(plan.at("newRoot").get<std::string>());
  if(plan.at("draftId").get<std::string>()!=identity.draftId.toStdString() ||
    !QDir::isAbsolutePath(oldRoot) || !QDir::isAbsolutePath(newRoot) || key(oldRoot)==key(newRoot) ||
    inside(oldRoot,newRoot) || inside(newRoot,oldRoot) || QFileInfo(newRoot).canonicalFilePath().isEmpty() ||
    key(QFileInfo(newRoot).canonicalFilePath())!=key(newRoot))throw std::runtime_error("root relocation scope changed");
  [[maybe_unused]] const auto creator=reinterpret_cast<quintptr>(GetModuleHandleW(L"VECreator.dll"));const auto sdk=GetModuleHandleW(L"videoeditor.dll");
  const auto meta=ExplorerProject::document(identity.location,QStringLiteral("draft_meta_info.json"));
  BinSnapshot bin(creator,meta);ExplorerDraftSnapshot::Snapshot drafts;
  const auto& moves=plan.at("files");if(!moves.is_array() || moves.empty() || moves.size()>ExplorerLimits::materialCount)throw std::runtime_error("root relocation bounds changed");
  struct Move {QString oldPath,newPath;std::set<std::string> ids;std::unique_ptr<LockedFile> file;};
  std::map<std::string,Move> paths;std::set<std::string> allIds;
  for(const auto& item:moves){Move move;move.oldPath=QString::fromStdString(item.at("old").get<std::string>());move.newPath=QString::fromStdString(item.at("new").get<std::string>());
   if(!inside(oldRoot,move.oldPath) || !inside(newRoot,move.newPath) ||
     key(move.oldPath).substr(key(oldRoot).size())!=key(move.newPath).substr(key(newRoot).size()))throw std::runtime_error("relative source path changed");
   for(const auto& id:item.at("materialIds")){const auto value=id.get<std::string>();if(value.empty() || !move.ids.insert(value).second || !allIds.insert(value).second)throw std::runtime_error("duplicate material owner");}
   if(move.ids.empty())throw std::runtime_error("missing material owner");move.file=std::make_unique<LockedFile>(move.newPath);move.file->verify(item);
   if(!paths.emplace(key(move.oldPath),std::move(move)).second)throw std::runtime_error("duplicate source path");
  }
  auto expectedBin=bin.before;std::map<std::string,std::set<std::string>> actualIds;
  for(auto& row:expectedBin){const auto found=paths.find(std::get<1>(row.second));if(found==paths.end())continue;
   if(!found->second.ids.count(row.first))throw std::runtime_error("unlisted bin alias shares the original path");
   actualIds[found->first].insert(row.first);std::get<1>(row.second)=key(found->second.newPath);
  }
  for(const auto& pair:paths)if(actualIds[pair.first]!=pair.second.ids)throw std::runtime_error("source UUID set differs from SDK registry");
  const auto service=ExplorerProject::read<quintptr>(ExplorerSymbols::creator(0xec16c18)),current=ExplorerProject::read<quintptr>(service+0x70),drop=ExplorerProject::read<quintptr>(service+0x78);
  auto* grid=ExplorerProject::grid();auto* tree=ExplorerProject::object(ExplorerProject::read<quintptr>(current+0x30),"FileMetaDataTree");
  std::map<std::string,QObject*> nodes;QList<QObject*> pending=tree->children();
  while(!pending.isEmpty()){auto* node=pending.takeLast();const auto id=ExplorerProject::nodeId(node).toStdString();if(!nodes.emplace(id,node).second || nodes.size()>ExplorerLimits::materialCount)throw std::runtime_error("tree identities changed");for(auto* child:node->children())pending.append(child);}
  struct Alias {QObject* node;QPointer<QObject> model;QString path,label;};std::vector<Alias> aliases;
  using Manager=quintptr(__fastcall*)();using Model=quintptr(__fastcall*)(quintptr,QObject*);
  const auto manager=reinterpret_cast<Manager>(ExplorerSymbols::creator(0x1bf3d80))();if(!manager)throw std::runtime_error("resource manager unavailable");
  for(const auto& id:allIds){const auto found=nodes.find(id);if(found==nodes.end() || !found->second->children().isEmpty())throw std::runtime_error("owned leaf unavailable");
   const auto material=ExplorerProject::read<quintptr>(reinterpret_cast<quintptr>(found->second)+0x10);
   const auto oldPath=ExplorerProject::nativeText(material+0x58,4096),label=ExplorerProject::nativeText(material+0x98,4096);
   const auto expected=bin.before.find(id);if(expected==bin.before.end() || key(oldPath)!=std::get<1>(expected->second) || label.toStdString()!=std::get<2>(expected->second))throw std::runtime_error("native leaf differs from complete SDK registry");
   const auto address=reinterpret_cast<Model>(ExplorerSymbols::creator(0x1bf3e30))(manager,found->second);if(!address)throw std::runtime_error("owned model unavailable");
   const auto modelData=ExplorerProject::read<quintptr>(address+8);if(ExplorerProject::read<quintptr>(modelData+8)!=address || (ExplorerProject::read<unsigned>(modelData+48)&0x0c))throw std::runtime_error("owned model lifetime changed");
   auto* model=reinterpret_cast<QObject*>(address);const auto title=model->metaObject()->indexOfProperty("title");
   if(model->thread()!=QThread::currentThread() || title<0 || !model->metaObject()->property(title).isWritable() || key(model->property("filePath").toString())!=key(oldPath) || model->property("title").toString()!=label)throw std::runtime_error("owned view path/title changed");
   aliases.push_back({found->second,model,oldPath,label});
  }
  using TextGet=const std::string&(__fastcall*)(void*);using ListGet=const List&(__fastcall*)(void*);using TypeGet=const int&(__fastcall*)(void*);using MaterialGet=const std::shared_ptr<void>&(__fastcall*)(void*);using SetPath=void(__fastcall*)(void*,const std::string&);
  const auto keys=plan.at("exports");const auto getId=entry<TextGet>(sdk,keys,"nodeId");const auto tracks=entry<ListGet>(sdk,keys,"draftTracks");const auto segments=entry<ListGet>(sdk,keys,"trackSegments");
  const auto type=entry<TypeGet>(sdk,keys,"trackType");
  struct Source {std::shared_ptr<void> owner;SetPath set;std::string path;};std::map<void*,Source> sources;std::vector<Json> expectedDrafts;
  Json allDrafts=Json::object();for(const auto& snapshot:drafts.snapshots){const auto value=Json::parse(snapshot);allDrafts[value.at("id").get<std::string>()]=value;}
  QSaveFile preimage(QString::fromWCharArray(request.output)+QStringLiteral(".drafts-before.json"));if(!preimage.open(QIODevice::WriteOnly))throw std::runtime_error("SDK preimage unavailable");const auto preimageText=allDrafts.dump();preimage.write(preimageText.data(),static_cast<qint64>(preimageText.size()));if(!preimage.commit())throw std::runtime_error("SDK preimage commit failed");
  if(request.action==1 && !plan.contains("drafts"))throw std::runtime_error("prepared complete SDK baseline required");
  if(plan.contains("drafts") && plan.at("drafts").size()!=drafts.owners.size())throw std::runtime_error("live timeline set changed");
  for(std::size_t i=0;i<drafts.owners.size();++i){auto expected=Json::parse(drafts.snapshots[i]);const auto draftId=expected.at("id").get<std::string>();
   if(plan.contains("drafts") && plan.at("drafts").at(draftId)!=expected)throw std::runtime_error("complete live timeline differs from prepared baseline");
   std::map<std::string,std::string> wanted;
   for(const auto* group:{"videos","audios"})if(expected.at("materials").contains(group))for(auto& item:expected["materials"][group]){if(!item.contains("path") || !item["path"].is_string() || item["path"].get<std::string>().empty())continue;const auto found=paths.find(key(QString::fromStdString(item["path"].get<std::string>())));if(found==paths.end())continue;
    const auto id=item.at("id").get<std::string>(),target=found->second.newPath.toStdString();if(!wanted.emplace(id,target).second)throw std::runtime_error("duplicate timeline source UUID");item["path"]=target;
   }
   std::set<std::string> seen;
   for(const auto& track:tracks(drafts.owners[i].get())){const auto trackType=type(track.get());if(trackType!=1 && trackType!=2)continue;const bool audio=trackType==2;
    const auto materialGet=entry<MaterialGet>(sdk,keys,audio?"audioMaterial":"videoMaterial");const auto set=entry<SetPath>(sdk,keys,audio?"audioSetPath":"videoSetPath");
    for(const auto& segment:segments(track.get())){const auto& material=materialGet(segment.get());if(!material)continue;const auto id=getId(material.get());const auto desired=wanted.find(id);if(desired==wanted.end())continue;
     const auto previous=sources.find(material.get());if(previous!=sources.end() && (previous->second.path!=desired->second || previous->second.set!=set))throw std::runtime_error("SDK alias source differs");
     sources[material.get()]={material,set,desired->second};seen.insert(id);
    }
   }
   if(seen.size()!=wanted.size())throw std::runtime_error("a relocated source is not available through the proven SDK route");expectedDrafts.push_back(std::move(expected));
  }
  const auto foreground=GetForegroundWindow();auto* focus=QGuiApplication::focusObject();POINT cursor{};GetCursorPos(&cursor);ExplorerRuntime::check(request.lease);
  drafts.verify();bin.verify();result.insert("materials",static_cast<int>(allIds.size()));result.insert("sources",static_cast<int>(sources.size()));
  if(request.action==0){result.insert("status","ready");}
  else{
   if((GetAsyncKeyState(VK_LBUTTON)&0x8000)||(GetAsyncKeyState(VK_RBUTTON)&0x8000))throw std::runtime_error("active pointer interaction");
   result.insert("mutationDispatched",true);result.insert("status","unknown");
   for(const auto& source:sources)source.second.set(source.second.owner.get(),source.second.path);
   using Relink=void(__fastcall*)(quintptr,const QString&,const QString&);std::map<std::string,QString> spellings;
   for(const auto& alias:aliases){const auto target=paths.at(key(alias.path)).newPath;spellings[alias.path.toStdString()]=target;}
   for(const auto& spelling:spellings)reinterpret_cast<Relink>(ExplorerSymbols::creator(0x29f2490))(reinterpret_cast<quintptr>(grid),QString::fromStdString(spelling.first),spelling.second);
   using Rename=void(__fastcall*)(void*,QObject*,const QString&);
   for(const auto& alias:aliases){if(!alias.model || key(alias.model->property("filePath").toString())!=key(paths.at(key(alias.path)).newPath))throw std::runtime_error("stock relink lost its owned view");if(alias.model->property("title").toString()!=alias.label)reinterpret_cast<Rename>(ExplorerSymbols::creator(0x29cce20))(nullptr,alias.model.data(),alias.label);}
   for(std::size_t i=0;i<drafts.owners.size();++i){std::string text;drafts.serializer(&text,drafts.owners[i]);if(Json::parse(text)!=expectedDrafts[i])throw std::runtime_error("unrelated SDK timeline change during root relink");}
   if(BinSnapshot::withoutStockService(bin.capture())!=BinSnapshot::withoutStockService(expectedBin))throw std::runtime_error("complete SDK registry differs after root relink");
   reinterpret_cast<void(__fastcall*)(quintptr)>(ExplorerSymbols::creator(0x5e121e0))(service);if(!QMetaObject::invokeMethod(grid,"onFileMetaTreeUpdated",Qt::DirectConnection))throw std::runtime_error("stock bin save unavailable");
   // Serialize actual held SDK owners, never a caller-created JSON replacement.
   using Completion=std::function<void(const draft_store::WriteDraftJsonResult&)>;using Save=void(__fastcall*)(quintptr,const std::shared_ptr<void>&,bool,Completion);
   const auto save=entry<Save>(sdk,Json{{"save",plan.at("storeSaveExport")}},"save");
   for(std::size_t i=0;i<drafts.owners.size();++i)if(expectedDrafts[i]!=Json::parse(drafts.snapshots[i]))save(reinterpret_cast<quintptr>(bin.store.get()),drafts.owners[i],true,Completion{});
   result.insert("status","submitted");
  }
  POINT after{};GetCursorPos(&after);
  if(foreground!=GetForegroundWindow() || focus!=QGuiApplication::focusObject() || cursor.x!=after.x || cursor.y!=after.y || current!=ExplorerProject::read<quintptr>(service+0x70) || drop!=ExplorerProject::read<quintptr>(service+0x78))throw std::runtime_error("focus or native project navigation changed");
  result.insert("navigationUnchanged",true);result.insert("focusUnchanged",true);result.insert("foregroundUnchanged",true);
 }catch(const std::exception& error){result.insert("reason",error.what());if(result.value("mutationDispatched").toBool())result.insert("status","unknown");}
 QSaveFile output(QString::fromWCharArray(request.output));if(output.open(QIODevice::WriteOnly)){output.write(QJsonDocument(result).toJson());output.commit();}
}
}
extern "C" __declspec(dllexport) DWORD WINAPI CapSync_ProductRootRelink(LPVOID raw){auto* r=static_cast<Request*>(raw);if(!r || r->size!=sizeof(Request) || r->version!=1 || !std::wmemchr(r->manifest,0,1024) || !std::wmemchr(r->output,0,1024))return 2;auto* app=QCoreApplication::instance();if(!app || QFileInfo(QString::fromWCharArray(r->output)).exists())return 3;HMODULE pin=nullptr;if(!GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS|GET_MODULE_HANDLE_EX_FLAG_PIN,reinterpret_cast<LPCWSTR>(&CapSync_ProductRootRelink),&pin))return 4;const auto copy=*r;return QMetaObject::invokeMethod(app,ExplorerFaultBoundary::guarded([copy]{perform(copy);},copy.output),Qt::QueuedConnection)?1:5;}
BOOL WINAPI DllMain(HINSTANCE instance,DWORD reason,LPVOID){if(reason==DLL_PROCESS_ATTACH)DisableThreadLibraryCalls(instance);return TRUE;}
