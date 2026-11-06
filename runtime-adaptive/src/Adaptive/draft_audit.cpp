#include "fault_boundary.h"
#include "../CapSync.NativeExplorerObserve/draft_snapshot.h"
#include <QtCore/QSaveFile>
#include <QtCore/QJsonArray>
struct Request {unsigned size,version;wchar_t output[1024];};
static void inspect(Request request) {
    QJsonObject result{{"editorCommands",0},{"projectMutation",false}};
    try {
        const auto identity=ExplorerSession::current();
        if(QFileInfo(identity.location).fileName()!=QStringLiteral("WakuShare 9.7 - 13 timelines check"))throw std::runtime_error("outside approved lab");
        ExplorerDraftSnapshot::Snapshot snapshot;QJsonArray drafts;
        for(std::size_t i=0;i<snapshot.owners.size();++i) {
            std::string observed;snapshot.serializer(&observed,snapshot.owners[i]);
            const auto before=ExplorerSymbols::Json::parse(snapshot.snapshots[i]),after=ExplorerSymbols::Json::parse(observed);
            const auto changes=ExplorerSymbols::Json::diff(before,after);
            const auto prefix=QString::fromWCharArray(request.output)+QStringLiteral(".%1").arg(i);
            for(const auto& pair:{std::pair<QString,const std::string&>{prefix+QStringLiteral(".before.json"),snapshot.snapshots[i]},std::pair<QString,const std::string&>{prefix+QStringLiteral(".after.json"),observed}}) {
                QSaveFile file(pair.first);if(!file.open(QIODevice::WriteOnly))throw std::runtime_error("audit write unavailable");file.write(pair.second.data(),static_cast<qint64>(pair.second.size()));file.commit();
            }
            drafts.append(QJsonObject{{"id",QString::fromStdString(before.value("id",std::string()))},{"rawEqual",observed==snapshot.snapshots[i]},{"jsonEqual",before==after},{"changes",static_cast<int>(changes.size())}});
        }
        result.insert("status","read");result.insert("drafts",drafts);
    }catch(const std::exception& error){result.insert("status","rejected");result.insert("reason",QString::fromLatin1(error.what()));}
    QSaveFile output(QString::fromWCharArray(request.output));if(output.open(QIODevice::WriteOnly)){output.write(QJsonDocument(result).toJson());output.commit();}
}
extern "C" __declspec(dllexport) DWORD WINAPI CapSync_AdaptiveDraftAudit(void* memory) {
    const auto* value=static_cast<Request*>(memory);if(!value || value->size!=sizeof(Request) || value->version!=1 || !std::wmemchr(value->output,0,1024))return 2;
    const auto copy=*value;return QMetaObject::invokeMethod(QCoreApplication::instance(),ExplorerFaultBoundary::guarded([copy]{inspect(copy);},copy.output),Qt::QueuedConnection)?1:3;
}
BOOL WINAPI DllMain(HINSTANCE instance,DWORD reason,LPVOID){if(reason==DLL_PROCESS_ATTACH)DisableThreadLibraryCalls(instance);return TRUE;}
