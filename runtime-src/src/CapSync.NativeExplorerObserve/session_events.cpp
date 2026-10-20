// Read-only push observer, restricted to the authorized laboratory while being accepted.
#include "session_identity.h"
#include "lab_scope.h"
#include <QtCore/QChildEvent>
#include <QtCore/QJsonDocument>
#include <QtCore/QJsonObject>
#include <QtCore/QMetaMethod>
#include <QtCore/QPointer>
#include <QtCore/QSaveFile>
#include <QtGui/QGuiApplication>
#include <QtNetwork/QLocalSocket>
#include <QtQml/QQmlContext>
#include <QtQml/QQmlEngine>
#include <QtQuick/QQuickWindow>
#include <cwchar>
#ifdef CAPSYNC_EXPLORER_RUNTIME
#include "runtime_guard.h"
#endif

struct Request {unsigned size,version;wchar_t expectedLocation[1024],pipe[128],output[1024];char token[65];};
namespace {
struct Scope {quintptr grid=0,tree=0;bool operator==(const Scope& other)const{return grid==other.grid && tree==other.tree;}};
Scope scope() {
    try {
        const auto creator=reinterpret_cast<quintptr>(GetModuleHandleW(L"VECreator.dll"));
        const auto service=ExplorerLab::read<quintptr>(creator+0xec16c18),current=ExplorerLab::read<quintptr>(service+0x70);
        ExplorerLab::object(current,"FileMetaDataNode");
        auto* tree=ExplorerLab::object(ExplorerLab::read<quintptr>(current+0x30),"FileMetaDataTree");
        auto* grid=ExplorerLab::object(reinterpret_cast<quintptr>(tree->parent()),"LocalMediaInfoGridViewModel");
        return {reinterpret_cast<quintptr>(grid),reinterpret_cast<quintptr>(tree)};
    } catch(const std::exception&) {return {};}
}
class Events final : public QObject {
    Q_OBJECT
public:
    explicit Events(Request request):QObject(QCoreApplication::instance()),request_(request),socket_(this) {}
    void start() {
        expected_=QFileInfo(QString::fromWCharArray(request_.expectedLocation)).canonicalFilePath();
#ifdef CAPSYNC_PRODUCT_RUNTIME
        expected_.clear();
        try {ExplorerSession::current();ExplorerLab::grid();}
        catch(const std::exception& error){if(std::strcmp(error.what(),"no active project"))throw;}
#elif defined(CAPSYNC_EXPLORER_RUNTIME_V2)
        if(expected_.isEmpty())throw std::runtime_error("authorized lab directory absent");
        bool home=false;
        try {
            const auto identity=ExplorerSession::current();
            if(identity.draftId!=QStringLiteral("582F1BF9-2B25-4CF2-B83F-3528F1B868B2") ||
               identity.location.compare(expected_,Qt::CaseInsensitive))throw std::runtime_error("outside authorized event lab");
        }catch(const std::exception& error){
            if(std::strcmp(error.what(),"no active project"))throw;
            home=true;
        }
        if(!home)ExplorerLab::grid();
#else
        const auto identity=ExplorerSession::current();
        if(expected_.isEmpty() || identity.draftId!=QStringLiteral("582F1BF9-2B25-4CF2-B83F-3528F1B868B2") ||
            identity.location.compare(expected_,Qt::CaseInsensitive))throw std::runtime_error("outside authorized event lab");
        ExplorerLab::grid();
#endif
        socket_.setReadBufferSize(1024);
        QObject::connect(&socket_,&QLocalSocket::connected,this,[this]{
            QCoreApplication::instance()->installEventFilter(this);active_=true;rebind();
            if(active_){schedule(true);receipt("connected");}
        });
        QObject::connect(&socket_,&QLocalSocket::disconnected,this,[this]{stop("disconnected");});
        QObject::connect(&socket_,&QLocalSocket::errorOccurred,this,[this](QLocalSocket::LocalSocketError){stop("socket-error");});
        QObject::connect(&socket_,&QLocalSocket::readyRead,this,[this]{stop("unexpected-inbound-data");});
        receipt("connecting");socket_.connectToServer(QString::fromWCharArray(request_.pipe),QIODevice::ReadWrite);
    }
    void stop(const char* reason) {
        if(stopping_)return;
        stopping_=true;active_=false;QCoreApplication::instance()->removeEventFilter(this);
        for(const auto& connection:connections_)QObject::disconnect(connection);
        connections_.clear();socket_.abort();receipt(reason);deleteLater();
    }
#ifdef CAPSYNC_EXPLORER_RUNTIME
    bool matches(const ExplorerRuntimeLease& lease)const {
        if(!active_ || stopping_ || forceEpoch_ || socket_.state()!=QLocalSocket::ConnectedState ||
           QByteArray(lease.token)!=QByteArray(request_.token) || lease.viewEpoch!=viewEpoch_ || !(scope()==last_))return false;
        try {
            const auto current=ExplorerSession::current();
            return current.draftId==QString::fromLatin1(lease.draftId) &&
                !current.location.compare(QString::fromWCharArray(lease.location),Qt::CaseInsensitive) &&
                current.draftId==lastId_ &&
#ifdef CAPSYNC_PRODUCT_RUNTIME
                !current.location.compare(lastLocation_,Qt::CaseInsensitive);
#else
                !current.location.compare(expected_,Qt::CaseInsensitive);
#endif
        }catch(const std::exception&){return false;}
    }
#endif
protected:
    bool eventFilter(QObject*,QEvent* event)override {
        if(active_ && (event->type()==QEvent::ChildAdded || event->type()==QEvent::ChildRemoved))schedule(false);
        return false;
    }
private slots:
    void signal(){schedule(true);}
private:
    void receipt(const char* state) {
        QSaveFile output(QString::fromWCharArray(request_.output));
        const auto bytes=QJsonDocument(QJsonObject{{"status",QString::fromLatin1(state)},{"active",active_},
            {"projectMutation",false},{"editorCommands",0},{"periodicTimers",0},{"snapshots",static_cast<double>(sequence_)},
            {"viewEpoch",static_cast<double>(viewEpoch_)},{"rebinds",rebinds_}}).toJson(QJsonDocument::Indented);
        if(output.open(QIODevice::WriteOnly) && output.write(bytes)==bytes.size())output.commit();
    }
    void schedule(bool explicitSignal) {
        signaled_|=explicitSignal;
        if(queued_ || !active_)return;
        queued_=true;QMetaObject::invokeMethod(this,[this]{
            queued_=false;if(!active_)return;
            const auto current=scope();
            if(current==last_ && !signaled_ && !forceEpoch_)return;
            const bool viewChanged=!(current==last_) || forceEpoch_;
            signaled_=false;forceEpoch_=false;
            QString status=QStringLiteral("Unavailable"),id,location;
            try {
                const auto identity=ExplorerSession::current();
#ifdef CAPSYNC_PRODUCT_RUNTIME
                // An import emits model signals before its registry save. It
                // must not manufacture a project switch for the same SDK owner.
                // New identities/scopes still require the complete tree, and
                // every command independently checks it in runtime_guard.h.
                const bool sameOwner=current==last_ && identity.draftId==lastId_ && !identity.location.compare(lastLocation_,Qt::CaseInsensitive);
                if(current.grid && current.tree && (sameOwner || ExplorerLab::grid()==reinterpret_cast<QObject*>(current.grid))) {
#else
                if(identity.draftId==QStringLiteral("582F1BF9-2B25-4CF2-B83F-3528F1B868B2") &&
                    !identity.location.compare(expected_,Qt::CaseInsensitive) && current.grid && current.tree) {
#endif
                    status=QStringLiteral("Project");id=identity.draftId;location=identity.location;
                }
            } catch(const std::exception& error) {
                if(!std::strcmp(error.what(),"no active project"))status=QStringLiteral("Home");
            }
            if(viewChanged || id!=lastId_ || location!=lastLocation_ || !sequence_)++viewEpoch_;
            if(viewChanged && status==QStringLiteral("Project"))rebind();
            if(!active_)return;
            last_=current;lastId_=id;lastLocation_=location;
            QJsonObject message{{"protocolVersion",1},{"token",QString::fromLatin1(request_.token)},
                {"processId",static_cast<int>(GetCurrentProcessId())},{"build","9.6.0.4097"},
                {"sequence",static_cast<double>(++sequence_)},{"status",status},
                {"draftId",id.isEmpty()?QJsonValue(QJsonValue::Null):QJsonValue(id)},
                {"location",location.isEmpty()?QJsonValue(QJsonValue::Null):QJsonValue(location)},
                {"viewEpoch",static_cast<double>(viewEpoch_)}};
            const auto bytes=QJsonDocument(message).toJson(QJsonDocument::Compact)+'\n';
            if(bytes.size()>32768 || socket_.bytesToWrite()+bytes.size()>65536 || socket_.write(bytes)!=bytes.size())stop("backpressure-or-write-error");
        },Qt::QueuedConnection);
    }
    void rebind() {
        for(const auto& connection:connections_)QObject::disconnect(connection);
        connections_.clear();
        QList<QPointer<QObject>> pending{QCoreApplication::instance()};
        for(auto* window:QGuiApplication::allWindows())pending.append(window);
        QSet<QObject*> seen;QSet<QQmlContext*> contexts;
        const QSet<QByteArray> types{"ImportMgr","import::ImportCenter","import::MediaImportObserver","LocalMediaInspectorViewModel","LocalMediaInfoGridViewModel","MainWindowViewModel"};
        const QSet<QByteArray> signalNames{"gridViewModelChanged","draftLoaded","sigDraftLoaded","sigNeedUpdateDraftList","sigImportFinished","sigVirtualStoreImportFinished","resourceInfoCountChanged","allResourceInfoCountChanged","breadcrumbListChanged","currentEditorModeChanged","newProjectRequeset","newProjectOnMainWindow"};
        const auto slot=metaObject()->method(metaObject()->indexOfSlot("signal()"));
        while(!pending.isEmpty() && seen.size()<50000) {
            auto* object=pending.takeLast().data();
            if(!object || object==this || seen.contains(object) || object->thread()!=QThread::currentThread())continue;
            seen.insert(object);const auto* meta=object->metaObject();
            if(types.contains(meta->className())) {
                for(int i=0;i<meta->methodCount();++i) {
                    const auto method=meta->method(i);
                    if(method.methodType()==QMetaMethod::Signal && signalNames.contains(method.name()))
                        connections_.append(QObject::connect(object,method,this,slot,Qt::QueuedConnection));
                }
                connections_.append(QObject::connect(object,&QObject::destroyed,this,[this]{forceEpoch_=true;schedule(true);}));
            }
            for(auto* child:object->children())pending.append(child);
            if(auto* engine=qobject_cast<QQmlEngine*>(object))pending.append(engine->rootContext());
            auto* context=qobject_cast<QQmlContext*>(object);if(!context)context=QQmlEngine::contextForObject(object);
            int depth=0;
            while(context && !contexts.contains(context) && depth++<64 && context->thread()==QThread::currentThread()) {
                contexts.insert(context);if(auto* model=context->contextObject())pending.append(model);
                pending.append(context);context=context->parentContext();
            }
        }
        ++rebinds_;
        if(!pending.isEmpty())stop("object-scope-overflow");
    }
    Request request_;QLocalSocket socket_;QString expected_,lastId_,lastLocation_;Scope last_;
    QList<QMetaObject::Connection> connections_;
    bool active_=false,stopping_=false,queued_=false,signaled_=false,forceEpoch_=false;
    quint64 sequence_=0,viewEpoch_=0;int rebinds_=0;
};
QPointer<Events> observer;
}
#ifdef CAPSYNC_EXPLORER_RUNTIME
extern "C" __declspec(dllexport) bool __cdecl CapSync_ExplorerCheckLease(const ExplorerRuntimeLease* lease) {
    return lease && QCoreApplication::instance() && QThread::currentThread()==QCoreApplication::instance()->thread() &&
        observer && observer->matches(*lease);
}
#endif
extern "C" __declspec(dllexport) DWORD WINAPI CapSync_ExplorerEventsThread(LPVOID raw) {
    const auto* request=static_cast<const Request*>(raw);
    if(!request || request->size!=sizeof(Request) || request->version!=1 ||
        !std::wmemchr(request->expectedLocation,0,1024) || !std::wmemchr(request->output,0,1024) ||
        !std::wmemchr(request->pipe,0,128) || !std::memchr(request->token,0,65))return 2;
    auto* app=QCoreApplication::instance();if(!app || std::strcmp(qVersion(),"6.2.2"))return 3;
    const auto pipe=QString::fromWCharArray(request->pipe);const auto token=QByteArray(request->token);
    if(!pipe.startsWith(QStringLiteral("wakushare-explorer-")) || pipe.size()!=51 || token.size()!=64)return 4;
    for(const auto ch:token)if(!((ch>='0' && ch<='9') || (ch>='a' && ch<='f')))return 4;
    const QFileInfo file(QString::fromWCharArray(request->output));
    if(!file.isAbsolute() || file.fileName()!=QStringLiteral("bridge-status.json") || file.dir().dirName()!=QStringLiteral("evidence") || !file.dir().exists() || file.exists())return 5;
    HMODULE pinned=nullptr;
    if(!GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS|GET_MODULE_HANDLE_EX_FLAG_PIN,reinterpret_cast<LPCWSTR>(&CapSync_ExplorerEventsThread),&pinned))return 6;
    const Request copy=*request;
    return QMetaObject::invokeMethod(app,[copy]{
        if(observer)return;
        observer=new Events(copy);
        try {observer->start();}catch(const std::exception& error){
#ifdef CAPSYNC_PRODUCT_RUNTIME
            observer->stop(error.what());
#else
            (void)error;observer->stop("rejected");
#endif
        }
    },Qt::QueuedConnection)?1:7;
}
BOOL WINAPI DllMain(HINSTANCE instance,DWORD reason,LPVOID) {
    if(reason==DLL_PROCESS_ATTACH)DisableThreadLibraryCalls(instance);return TRUE;
}
#include "session_events.moc"
