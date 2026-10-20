// One exact laboratory source -> the existing media DropArea, without window hit-testing.
#include "lab_scope.h"
#include <QtCore/QCoreApplication>
#include <QtCore/QCryptographicHash>
#include <QtCore/QDir>
#include <QtCore/QFile>
#include <QtCore/QFileInfo>
#include <QtCore/QJsonArray>
#include <QtCore/QJsonDocument>
#include <QtCore/QJsonObject>
#include <QtCore/QMimeData>
#include <QtCore/QSaveFile>
#include <QtCore/QThread>
#include <QtGui/QDragEnterEvent>
#include <QtGui/QDragMoveEvent>
#include <QtGui/QDragLeaveEvent>
#include <QtGui/QDropEvent>
#include <QtGui/QGuiApplication>
#include <QtQml/QQmlContext>
#include <QtQml/QQmlEngine>
#include <QtQuick/QQuickItem>
#include <QtQuick/QQuickWindow>
#include <cwchar>
#ifdef CAPSYNC_MASS_PHYSICAL_ID
#include <QtCore/QHash>
#endif
#ifdef CAPSYNC_MEDIA_PATH
#include "media_formats.h"
#endif
#ifdef CAPSYNC_EXPLORER_RUNTIME
#include "runtime_guard.h"
#endif

struct Request {unsigned size,version,hiddenRequired;wchar_t source[1024],meta[1024],output[1024];char sha256[65];
#ifdef CAPSYNC_FORMAT_BATCH
    wchar_t manifest[1024];
#endif
#ifdef CAPSYNC_EXPLORER_RUNTIME
    wchar_t root[1024];char jobId[37];ExplorerRuntimeLease lease;
#endif
#ifdef CAPSYNC_PRODUCT_BATCH
    wchar_t batchManifest[1024];
#endif
};
namespace {
QSet<QString> dispatched;
#ifdef CAPSYNC_MASS_PHYSICAL_ID
QHash<QString,bool> decoderCache;
void samePhysicalFile(const QString& path,const QJsonObject& job){
    const auto wide=path.toStdWString();const auto handle=CreateFileW(wide.c_str(),GENERIC_READ,FILE_SHARE_READ,nullptr,OPEN_EXISTING,FILE_ATTRIBUTE_NORMAL,nullptr);
    if(handle==INVALID_HANDLE_VALUE)throw std::runtime_error("mass source read lock unavailable");
    BY_HANDLE_FILE_INFORMATION info{};const bool read=GetFileInformationByHandle(handle,&info)!=FALSE;CloseHandle(handle);
    const auto fileId=(static_cast<quint64>(info.nFileIndexHigh)<<32)|info.nFileIndexLow;
    const auto size=(static_cast<quint64>(info.nFileSizeHigh)<<32)|info.nFileSizeLow;
    const auto key=QStringLiteral("%1:%2").arg(info.dwVolumeSerialNumber,8,16,QLatin1Char('0')).arg(fileId,16,16,QLatin1Char('0')).toUpper();
    // Python holds a read-only/share-read handle through the complete import
    // after hashing these bytes. Independently recheck that same FILE_ID and
    // size here, without reading every byte a second time on the GUI thread.
    if(!read || (info.dwFileAttributes&FILE_ATTRIBUTE_DIRECTORY) || key!=job.value("FileIdentity").toString() || size!=static_cast<quint64>(job.value("Size").toDouble()))throw std::runtime_error("mass physical source identity changed");
}
#endif
void perform(const Request request) {
    QJsonObject result{{"status","rejected"},{"dispatched",false}};
    bool invoked=false;
#ifdef CAPSYNC_PRODUCT_BATCH
    QJsonArray acceptedJobs,rejectedJobs;
#ifdef CAPSYNC_WHOLE_IMPORT
    constexpr int batchLimit=static_cast<int>(ExplorerLimits::materialCount);
#elif defined(CAPSYNC_MASS_IMPORT)
    constexpr int batchLimit=512;
#else
    constexpr int batchLimit=64;
#endif
#endif
    try {
        if(QThread::currentThread()!=QCoreApplication::instance()->thread())throw std::runtime_error("wrong thread");
#ifdef CAPSYNC_EXPLORER_RUNTIME
        ExplorerRuntime::check(request.lease);
#endif
        wchar_t module[1024]{};
        if(!GetModuleFileNameW(GetModuleHandleW(L"VECreator.dll"),module,1024) || QFileInfo(QString::fromWCharArray(module)).dir().dirName()!=QStringLiteral("9.6.0.4097"))
            throw std::runtime_error("unverified build");
        QFile metadata(QString::fromWCharArray(request.meta));
        if(!metadata.open(QIODevice::ReadOnly) || metadata.size()>10*1024*1024)throw std::runtime_error("lab metadata unavailable");
        const auto meta=QJsonDocument::fromJson(metadata.readAll()).object();
#ifdef CAPSYNC_PRODUCT_RUNTIME
        ExplorerProject::metadata(meta,QString::fromWCharArray(request.meta));
#else
        if(meta.value("draft_id").toString()!=QStringLiteral("582F1BF9-2B25-4cf2-B83F-3528F1B868B2") ||
            meta.value("draft_name").toString()!=QStringLiteral("CapSync-Lab-20261013-001"))throw std::runtime_error("not the lab project");
#endif
        const auto source=QFileInfo(QString::fromWCharArray(request.source)).canonicalFilePath();
#ifdef CAPSYNC_EXPLORER_RUNTIME
        const auto sourceRoot=QFileInfo(QString::fromWCharArray(request.root)).canonicalFilePath();
        const auto suffix=QFileInfo(source).suffix().toLower();
#ifdef CAPSYNC_MEDIA_PATH
        const bool supported=!ExplorerMedia::kind(suffix).isEmpty();
#else
        const QSet<QString> formats{"png","jpg","jpeg","gif","wav","mp3","mp4","mov"};
        const bool supported=formats.contains(suffix);
#endif
        if(sourceRoot.isEmpty() || !source.startsWith(sourceRoot+QLatin1Char('/'),Qt::CaseInsensitive) ||
           !supported || dispatched.contains(QString::fromLatin1(request.jobId)))throw std::runtime_error("source outside runtime scope or job already dispatched");
#elif !defined(CAPSYNC_FORMAT_BATCH)
        const auto suffix=QStringLiteral("/research/fixtures/AutoAddLab/ExplorerStage0/targeted-drop-")+
            (request.hiddenRequired?QStringLiteral("hidden.png"):QStringLiteral("visible.png"));
        if(source.isEmpty() || !source.endsWith(suffix,Qt::CaseInsensitive) || dispatched.contains(source))throw std::runtime_error("fresh owned fixture required");
#endif
        QList<QUrl> sources{QUrl::fromLocalFile(source)};
#ifdef CAPSYNC_FORMAT_BATCH
        QFile batch(QString::fromWCharArray(request.manifest));
        if(!batch.open(QIODevice::ReadOnly) || batch.size()>65536)throw std::runtime_error("batch manifest unavailable");
        const auto manifest=QJsonDocument::fromJson(batch.readAll()).object();
        const auto fixtureRoot=QFileInfo(manifest.value("root").toString()).canonicalFilePath();
        if(!fixtureRoot.endsWith(QStringLiteral("/research/fixtures/AutoAddLab/FormatAcceptance-20261020"),Qt::CaseInsensitive))throw std::runtime_error("outside format batch fixtures");
        const auto files=manifest.value("files").toArray();if(files.isEmpty() || files.size()>40)throw std::runtime_error("batch size differs");
        const auto hashes=manifest.value("sha256").toObject();QSet<QString> unique;sources.clear();
        for(const auto& entry:files){
            const auto path=QFileInfo(entry.toString()).canonicalFilePath();
            if(!path.startsWith(fixtureRoot+QLatin1Char('/'),Qt::CaseInsensitive) || !QFileInfo(path).isFile() || QFileInfo(path).size()>2*1024*1024 || unique.contains(path))throw std::runtime_error("invalid format batch source");
            QFile file(path);if(!file.open(QIODevice::ReadOnly))throw std::runtime_error("batch source unavailable");
            QCryptographicHash hash(QCryptographicHash::Sha256);if(!hash.addData(&file) || hash.result().toHex()!=hashes.value(QFileInfo(path).fileName()).toString().toLatin1())throw std::runtime_error("batch bytes changed");
            for(const auto group:meta.value("draft_materials").toArray())for(const auto value:group.toObject().value("value").toArray())
                if(QFileInfo(value.toObject().value("file_Path").toString()).canonicalFilePath().compare(path,Qt::CaseInsensitive)==0)throw std::runtime_error("batch source already registered");
            unique.insert(path);sources.append(QUrl::fromLocalFile(path));
        }
#endif
        for(const auto group:meta.value("draft_materials").toArray())for(const auto entry:group.toObject().value("value").toArray())
            if(QFileInfo(entry.toObject().value("file_Path").toString()).canonicalFilePath().compare(source,Qt::CaseInsensitive)==0)
                throw std::runtime_error("source already registered");
#ifndef CAPSYNC_MASS_PHYSICAL_ID
        QFile input(source);if(!input.open(QIODevice::ReadOnly))throw std::runtime_error("source unavailable");
        QCryptographicHash hash(QCryptographicHash::Sha256);
        if(!hash.addData(&input) || hash.result().toHex()!=QByteArray(request.sha256).toLower())throw std::runtime_error("fixture bytes changed");
#endif
#ifdef CAPSYNC_DECODE_PREFLIGHT
        using Supported=bool(__fastcall*)(const std::string&);
        const auto accepts=ExplorerSession::entry<Supported>(GetModuleHandleW(L"videoeditor.dll"),
            "?isSupportedFile@lvve@@YA_NAEBV?$basic_string@DU?$char_traits@D@std@@V?$allocator@D@2@@std@@@Z",0x15aeff0);
#ifndef CAPSYNC_PRODUCT_BATCH
        if(!accepts(source.toUtf8().toStdString())){result.insert("decoderRejected",true);throw std::runtime_error("unsupported media bytes");}
#endif
        result.insert("decoderAccepted",true);
#endif
#ifdef CAPSYNC_PRODUCT_BATCH
        QFile batch(QString::fromWCharArray(request.batchManifest));if(!batch.open(QIODevice::ReadOnly) || batch.size()>32*1024*1024)throw std::runtime_error("batch manifest unavailable");
        const auto jobs=QJsonDocument::fromJson(batch.readAll()).object().value("jobs").toArray();if(jobs.isEmpty() || jobs.size()>batchLimit)throw std::runtime_error("batch size invalid");
        sources.clear();QSet<QString> paths,ids;
        for(const auto value:jobs){const auto job=value.toObject();const auto path=QFileInfo(job.value("SourcePath").toString()).canonicalFilePath();const auto id=job.value("Id").toString();
            if(path.isEmpty() || !path.startsWith(sourceRoot+QLatin1Char('/'),Qt::CaseInsensitive) || !QFileInfo(path).isFile() || paths.contains(path.toCaseFolded()) || ids.contains(id) || QUuid(id).isNull() || ExplorerMedia::kind(QFileInfo(path).suffix()).isEmpty())throw std::runtime_error("batch source scope differs");
            paths.insert(path.toCaseFolded());ids.insert(id);
            for(const auto group:meta.value("draft_materials").toArray())for(const auto entry:group.toObject().value("value").toArray())if(QDir::cleanPath(entry.toObject().value("file_Path").toString()).compare(path,Qt::CaseInsensitive)==0)throw std::runtime_error("batch source already registered");
#ifdef CAPSYNC_MASS_PHYSICAL_ID
            samePhysicalFile(path,job);const auto cacheKey=job.value("Hash").toString().toLower()+QLatin1Char(':')+QFileInfo(path).suffix().toLower();if(!decoderCache.contains(cacheKey))decoderCache.insert(cacheKey,accepts(path.toUtf8().toStdString()));if(!decoderCache.value(cacheKey)){rejectedJobs.append(id);continue;}
#else
            QFile file(path);if(!file.open(QIODevice::ReadOnly) || file.size()!=static_cast<qint64>(job.value("Size").toDouble()))throw std::runtime_error("batch source unavailable");QCryptographicHash bytes(QCryptographicHash::Sha256);if(!bytes.addData(&file) || bytes.result().toHex()!=job.value("Hash").toString().toLower().toLatin1())throw std::runtime_error("batch bytes changed");
            if(!accepts(path.toUtf8().toStdString())){rejectedJobs.append(id);continue;}
#endif
            acceptedJobs.append(id);sources.append(QUrl::fromLocalFile(path));
        }
        if(sources.isEmpty()){result.insert("acceptedJobs",acceptedJobs);result.insert("rejectedJobs",rejectedJobs);result.insert("decoderRejected",true);throw std::runtime_error("all batch media rejected before dispatch");}
#endif
        auto* grid=ExplorerLab::grid();
        auto* view=qobject_cast<QQuickItem*>(grid->property("collectionView").value<QObject*>());
        if(!view || !view->window())throw std::runtime_error("lab view unavailable");
        if(request.hiddenRequired<2 && view->isVisible()==bool(request.hiddenRequired))throw std::runtime_error("requested visible/hidden precondition is absent");
        auto* root=view;
        while(root && !QByteArray(root->metaObject()->className()).startsWith("LocalMediaImport2_QMLTYPE_"))root=root->parentItem();
        if(!root)throw std::runtime_error("exact owning media component absent");
        QSet<QQuickItem*> seen;std::vector<QQuickItem*> pending{root},matches;
        while(!pending.empty()) {
            auto* item=pending.back();pending.pop_back();
#ifdef CAPSYNC_MEDIA_PATH
            constexpr auto itemLimit=65536;
#else
            constexpr auto itemLimit=2000;
#endif
            if(seen.size()>=itemLimit || seen.contains(item))throw std::runtime_error("media component traversal changed");
            seen.insert(item);auto* context=QQmlEngine::contextForObject(item);
            if(item->inherits("QQuickDropArea") && context && context->contextObject()==root &&
                context->baseUrl().toString()==QStringLiteral("qrc:/MaterialPanel/new_panel/media/LocalMediaImport2.qml"))matches.push_back(item);
            for(auto* child:item->childItems())pending.push_back(child);
        }
        if(matches.size()!=1)throw std::runtime_error("media drop destination absent or ambiguous");
        auto* target=matches[0];
        if(!target->isEnabled() || target->property("containsDrag").toBool() || !target->property("keys").toStringList().isEmpty() ||
            target->width()<20 || target->height()<20 || target->window()!=view->window())throw std::runtime_error("media drop destination not ready");
        if(GetAsyncKeyState(VK_LBUTTON)&0x8000 || GetAsyncKeyState(VK_RBUTTON)&0x8000)throw std::runtime_error("user drag in progress");
        const auto creator=reinterpret_cast<quintptr>(GetModuleHandleW(L"VECreator.dll"));
        const auto service=ExplorerLab::read<quintptr>(creator+0xec16c18);
        const auto current=ExplorerLab::read<quintptr>(service+0x70),drop=ExplorerLab::read<quintptr>(service+0x78);
        const auto* focus=QGuiApplication::focusObject();const auto foreground=GetForegroundWindow();
        const auto folder=ExplorerLab::nodeId(reinterpret_cast<QObject*>(current));
        // The controlled stage expects the existing root. Never navigate to obtain it.
#if !defined(CAPSYNC_EXPLORER_RUNTIME) && !defined(CAPSYNC_FORMAT_BATCH)
        if(!folder.isEmpty())throw std::runtime_error("stage requires the already selected root folder");
#endif
        QMimeData mime;mime.setUrls(sources);
        const QPoint point(static_cast<int>(target->width()/2),static_cast<int>(target->height()/2));
#ifdef CAPSYNC_EXPLORER_RUNTIME
        ExplorerRuntime::check(request.lease);
        invoked=true;dispatched.insert(QString::fromLatin1(request.jobId));
#else
        invoked=true;dispatched.insert(source);
#endif
        QDragEnterEvent enter(point,Qt::CopyAction,&mime,Qt::LeftButton,Qt::NoModifier);enter.setAccepted(false);
        QCoreApplication::sendEvent(target,&enter);
        bool moved=false,dropped=false;
        if(enter.isAccepted()) {
            QDragMoveEvent move(point,Qt::CopyAction,&mime,Qt::LeftButton,Qt::NoModifier);move.setAccepted(false);
            QCoreApplication::sendEvent(target,&move);moved=move.isAccepted();
            if(moved) {
                QDropEvent event(QPointF(point),Qt::CopyAction,&mime,Qt::LeftButton,Qt::NoModifier);event.setAccepted(false);
                QCoreApplication::sendEvent(target,&event);dropped=event.isAccepted();
            }
        }
        QDragLeaveEvent leave;QCoreApplication::sendEvent(target,&leave);
        result={{"status","dispatched-unconfirmed"},{"dispatched",true},{"enterAccepted",enter.isAccepted()},{"moveAccepted",moved},{"dropAccepted",dropped},
#ifdef CAPSYNC_DECODE_PREFLIGHT
            {"decoderAccepted",true},
#endif
            {"sourceCount",sources.size()},
            {"viewVisible",view->isVisible()},{"targetVisible",target->isVisible()},{"targetClass",QString::fromLatin1(target->metaObject()->className())},
            {"targetAddress",QString::number(reinterpret_cast<quintptr>(target),16)},{"folderId",folder},
            {"focusUnchanged",focus==QGuiApplication::focusObject()},{"foregroundUnchanged",foreground==GetForegroundWindow()},
            {"navigationUnchanged",current==ExplorerLab::read<quintptr>(service+0x70) && drop==ExplorerLab::read<quintptr>(service+0x78) && grid==ExplorerLab::grid()}};
#ifdef CAPSYNC_PRODUCT_BATCH
        result.insert("acceptedJobs",acceptedJobs);result.insert("rejectedJobs",rejectedJobs);
#endif
    } catch(const std::exception& error) {result.insert("status",invoked?"unknown":"rejected");result.insert("reason",QString::fromLatin1(error.what()));result.insert("dispatched",invoked);}
    QSaveFile output(QString::fromWCharArray(request.output));const auto bytes=QJsonDocument(result).toJson(QJsonDocument::Indented);
    if(output.open(QIODevice::WriteOnly) && output.write(bytes)==bytes.size())output.commit();
}
}
extern "C" __declspec(dllexport) DWORD WINAPI CapSync_ExplorerTargetDropThread(LPVOID raw) {
    const auto* request=static_cast<const Request*>(raw);
    if(!request || request->size!=sizeof(Request) || request->version!=1 || request->hiddenRequired>2 ||
        !std::wmemchr(request->source,0,1024) || !std::wmemchr(request->meta,0,1024) || !std::wmemchr(request->output,0,1024) || !std::memchr(request->sha256,0,65))return 2;
#ifdef CAPSYNC_EXPLORER_RUNTIME
    if(!std::wmemchr(request->root,0,1024) || !std::memchr(request->jobId,0,37) || QUuid(QString::fromLatin1(request->jobId)).isNull())return 2;
#endif
#ifdef CAPSYNC_FORMAT_BATCH
    if(!std::wmemchr(request->manifest,0,1024))return 2;
#endif
#ifdef CAPSYNC_PRODUCT_BATCH
    if(!std::wmemchr(request->batchManifest,0,1024))return 2;
#endif
    auto* app=QCoreApplication::instance();if(!app || std::strcmp(qVersion(),"6.2.2"))return 3;
    const auto output=QString::fromWCharArray(request->output);const QFileInfo file(output);
    if(!file.isAbsolute() || file.fileName()!=QStringLiteral("target-drop.json") || file.dir().dirName()!=QStringLiteral("evidence") || !file.dir().exists() || file.exists())return 4;
    HMODULE pinned=nullptr;
    if(!GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS|GET_MODULE_HANDLE_EX_FLAG_PIN,reinterpret_cast<LPCWSTR>(&CapSync_ExplorerTargetDropThread),&pinned))return 5;
    const Request copy=*request;
    return QMetaObject::invokeMethod(app,[copy]{perform(copy);},Qt::QueuedConnection)?1:6;
}
BOOL WINAPI DllMain(HINSTANCE instance,DWORD reason,LPVOID) {
    if(reason==DLL_PROCESS_ATTACH)DisableThreadLibraryCalls(instance);return TRUE;
}
