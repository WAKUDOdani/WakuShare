// Event-driven readiness relay for the pinned V2 observer. Never changes a draft.
#include "session_identity.h"
#include "lab_scope.h"
#include <QtCore/QChildEvent>
#include <QtCore/QJsonDocument>
#include <QtCore/QJsonObject>
#include <QtCore/QMetaMethod>
#include <QtCore/QPointer>
#include <QtCore/QSaveFile>
#include <QtGui/QGuiApplication>
#include <QtGui/QWindow>
#include <QtQml/QQmlContext>
#include <QtQml/QQmlEngine>
struct Request {unsigned size,version;wchar_t output[1024];};
namespace {
struct Scope {quintptr grid=0,tree=0;bool operator==(const Scope& other)const{return grid==other.grid && tree==other.tree;}};
Scope scope(){try{
    const auto creator=reinterpret_cast<quintptr>(GetModuleHandleW(L"VECreator.dll"));
    const auto service=ExplorerLab::read<quintptr>(creator+0xec16c18),current=ExplorerLab::read<quintptr>(service+0x70);
    ExplorerLab::object(current,"FileMetaDataNode");auto* tree=ExplorerLab::object(ExplorerLab::read<quintptr>(current+0x30),"FileMetaDataTree");
    auto* grid=ExplorerLab::object(reinterpret_cast<quintptr>(tree->parent()),"LocalMediaInfoGridViewModel");
    return {reinterpret_cast<quintptr>(grid),reinterpret_cast<quintptr>(tree)};
}catch(const std::exception&){return {};}}
class Relay final:public QObject {
public:
    explicit Relay(QObject* target):QObject(target),target_(target){setObjectName(QStringLiteral("CapSyncSessionReadinessRelayV1"));}
    ~Relay()override{for(const auto& connection:connections_)QObject::disconnect(connection);if(auto* app=QCoreApplication::instance())app->removeEventFilter(this);}
    void start(){QCoreApplication::instance()->installEventFilter(this);rebind();pulse();}
    int connections()const{return connections_.size();}
protected:
    bool eventFilter(QObject*,QEvent* event)override{
        if((event->type()==QEvent::ChildAdded || event->type()==QEvent::ChildRemoved) && !queued_){
            queued_=true;QMetaObject::invokeMethod(this,[this]{queued_=false;try{const auto current=scope();if(!(current==last_)){rebind();pulse();}}catch(const std::exception&){deleteLater();}},Qt::QueuedConnection);
        }
        return false;
    }
private:
    void pulse(){if(target_)QMetaObject::invokeMethod(target_.data(),"signal",Qt::QueuedConnection);}
    void rebind(){
        for(const auto& connection:connections_)QObject::disconnect(connection);connections_.clear();last_=scope();
        QList<QPointer<QObject>> pending{QCoreApplication::instance()};for(auto* window:QGuiApplication::allWindows())pending.append(window);
        QSet<QObject*> seen;QSet<QQmlContext*> contexts;
        const QSet<QByteArray> types{"ImportMgr","import::ImportCenter","import::MediaImportObserver","LocalMediaInspectorViewModel","LocalMediaInfoGridViewModel","MainWindowViewModel"};
        const QSet<QByteArray> signalNames{"gridViewModelChanged","draftLoaded","sigDraftLoaded","sigNeedUpdateDraftList","sigImportFinished","sigVirtualStoreImportFinished","resourceInfoCountChanged","allResourceInfoCountChanged","breadcrumbListChanged","currentEditorModeChanged","newProjectRequeset","newProjectOnMainWindow"};
        const auto slot=target_->metaObject()->method(target_->metaObject()->indexOfSlot("signal()"));
        while(!pending.isEmpty() && seen.size()<50000){
            auto* object=pending.takeLast().data();if(!object || object==this || object==target_ || seen.contains(object) || object->thread()!=QThread::currentThread())continue;
            seen.insert(object);const auto* meta=object->metaObject();
            if(types.contains(meta->className()))for(int i=0;i<meta->methodCount();++i){
                const auto method=meta->method(i);if(method.methodType()==QMetaMethod::Signal && signalNames.contains(method.name()))
                    connections_.append(QObject::connect(object,method,target_.data(),slot,Qt::QueuedConnection));
            }
            for(auto* child:object->children())pending.append(child);
            if(auto* engine=qobject_cast<QQmlEngine*>(object))pending.append(engine->rootContext());
            auto* context=qobject_cast<QQmlContext*>(object);if(!context)context=QQmlEngine::contextForObject(object);int depth=0;
            while(context && !contexts.contains(context) && depth++<64 && context->thread()==QThread::currentThread()){
                contexts.insert(context);if(auto* model=context->contextObject())pending.append(model);pending.append(context);context=context->parentContext();
            }
        }
        if(!pending.isEmpty())throw std::runtime_error("relay object scope overflow");
    }
    QPointer<QObject> target_;QList<QMetaObject::Connection> connections_;Scope last_;bool queued_=false;
};
void perform(Request request){
    QJsonObject result{{"status","rejected"},{"projectMutation",false},{"periodicTimers",0}};
    try{
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
        if(!host)throw std::runtime_error("event host absent");
        QObject* target=nullptr;
        for(auto* child:QCoreApplication::instance()->children())if(!std::strcmp(child->metaObject()->className(),"Events")){
            HMODULE owner=nullptr;
            if(GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS|GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,reinterpret_cast<LPCWSTR>(child->metaObject()),&owner) && owner==host){
                if(target)throw std::runtime_error("multiple V2 hosts");target=child;
            }
        }
        if(!target || target->metaObject()->indexOfSlot("signal()")<0)throw std::runtime_error("V2 snapshot slot absent");
        if(target->findChild<QObject*>(QStringLiteral("CapSyncSessionReadinessRelayV1")))throw std::runtime_error("relay already attached; no replay");
        auto* relay=new Relay(target);try{relay->start();}catch(...){delete relay;throw;}result.insert("status","attached");result.insert("connections",relay->connections());
    }catch(const std::exception& error){result.insert("reason",QString::fromLatin1(error.what()));}
    QSaveFile output(QString::fromWCharArray(request.output));if(output.open(QIODevice::WriteOnly)){output.write(QJsonDocument(result).toJson());output.commit();}
}
}
extern "C" __declspec(dllexport) DWORD WINAPI CapSync_SessionRelayThread(LPVOID raw){
    const auto* r=static_cast<const Request*>(raw);if(!r || r->size!=sizeof(Request) || r->version!=1 || !std::wmemchr(r->output,0,1024))return 2;
    auto* app=QCoreApplication::instance();if(!app || std::strcmp(qVersion(),"6.2.2"))return 3;
    HMODULE pinned=nullptr;if(!GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS|GET_MODULE_HANDLE_EX_FLAG_PIN,reinterpret_cast<LPCWSTR>(&CapSync_SessionRelayThread),&pinned))return 4;
    const Request copy=*r;return QMetaObject::invokeMethod(app,[copy]{perform(copy);},Qt::QueuedConnection)?1:5;
}
BOOL WINAPI DllMain(HINSTANCE instance,DWORD reason,LPVOID){if(reason==DLL_PROCESS_ATTACH)DisableThreadLibraryCalls(instance);return TRUE;}
