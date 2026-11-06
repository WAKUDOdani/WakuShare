#include "fault_boundary.h"
#include "../CapSync.NativeExplorerObserve/runtime_guard.h"
#include "../CapSync.NativeExplorerObserve/draft_snapshot.h"
#include <QtCore/QSaveFile>
#if !defined(CAPSYNC_TREE_SCOPE_V2) || CAPSYNC_PRODUCT_GENERATION < 8 || !defined(CAPSYNC_MULTI_DRAFT_SNAPSHOT)
#error Adaptive preflight requires the same complete project scope as product mutations.
#endif
struct Request {unsigned size,version;wchar_t output[1024];ExplorerRuntimeLease lease;};
static void inspect(Request request) {
    QJsonObject result{{"editorCommands",0},{"projectMutation",false},{"status","waiting"}};
    try {
        ExplorerRuntime::check(request.lease);
        ExplorerDraftSnapshot::Snapshot snapshot;snapshot.verify();
        ExplorerRuntime::check(request.lease);
        result.insert("status","stable");result.insert("drafts",static_cast<int>(snapshot.owners.size()));
    }catch(const std::exception& error){result.insert("reason",QString::fromLatin1(error.what()));}
    QSaveFile output(QString::fromWCharArray(request.output));if(output.open(QIODevice::WriteOnly)){output.write(QJsonDocument(result).toJson());output.commit();}
}
extern "C" __declspec(dllexport) DWORD WINAPI CapSync_AdaptivePreflightThread(void* memory) {
    const auto* value=static_cast<Request*>(memory);if(!value || value->size!=sizeof(Request) || value->version!=1 || !std::wmemchr(value->output,0,1024))return 2;
    const auto copy=*value;return QMetaObject::invokeMethod(QCoreApplication::instance(),ExplorerFaultBoundary::guarded([copy]{inspect(copy);},copy.output),Qt::QueuedConnection)?1:3;
}
BOOL WINAPI DllMain(HINSTANCE instance,DWORD reason,LPVOID){if(reason==DLL_PROCESS_ATTACH)DisableThreadLibraryCalls(instance);return TRUE;}
