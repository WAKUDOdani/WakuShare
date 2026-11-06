#include "../Adaptive/symbols.h"
#include "../Adaptive/fault_boundary.h"
#pragma once
#include "../CapSync.NativeProbe/qt62_compat.h"
#include "../CapSync.NativeRelink/sdk_exports.h"
#include <Windows.h>
#include <QtCore/QCoreApplication>
#include <QtCore/QDir>
#include <QtCore/QFileInfo>
#include <QtCore/QThread>
#include <QtCore/QUuid>
#include <cstring>
#include <memory>
#include <stdexcept>
#include <string>

namespace ExplorerSession {
inline constexpr auto foldPathName="?getDraftFoldPath@StoreWrapper@draft_store@@QEBA?AV?$basic_string@DU?$char_traits@D@std@@V?$allocator@D@2@@std@@XZ";
inline constexpr quintptr foldPathRva=0x1359220;
struct Identity {
    QString draftId,location;
    std::shared_ptr<void> project,store;
};
template<class T> T entry(HMODULE module,const char* name,[[maybe_unused]] quintptr rva) {
    const auto address=GetProcAddress(module,name);
    if(!address || !ExplorerSymbols::executable(module,reinterpret_cast<quintptr>(address)))
        throw std::runtime_error("session getter export differs");
    return reinterpret_cast<T>(address);
}
inline Identity current() {
    if(!QCoreApplication::instance() || QThread::currentThread()!=QCoreApplication::instance()->thread())
        throw std::runtime_error("session read requires editor thread");
    [[maybe_unused]] const auto creator=GetModuleHandleW(L"VECreator.dll"),sdk=GetModuleHandleW(L"videoeditor.dll");
    wchar_t creatorPath[1024]{},sdkPath[1024]{};
    if(!creator || !sdk || !GetModuleFileNameW(creator,creatorPath,1024) || !GetModuleFileNameW(sdk,sdkPath,1024))
        throw std::runtime_error("session modules absent");
    const auto creatorFolder=QFileInfo(QString::fromWCharArray(creatorPath)).dir();
    if(!ExplorerSymbols::ownedModule(creator) ||
        creatorFolder!=QFileInfo(QString::fromWCharArray(sdkPath)).dir() || std::strcmp(qVersion(),"6.2.2"))
        throw std::runtime_error("session build differs");
    [[maybe_unused]] const auto base=reinterpret_cast<quintptr>(creator);
    using Get=void*(__fastcall*)(quintptr,std::shared_ptr<void>*);
    Identity identity;
    ExplorerFaultBoundary::stage="session.current";
    reinterpret_cast<Get>(ExplorerSymbols::creator(0x4bbaf60))(ExplorerSymbols::creator(0xebb65b0),&identity.project);
    if(!identity.project)throw std::runtime_error("no active project");
    ExplorerFaultBoundary::stage="session.store";
    reinterpret_cast<Get>(ExplorerSymbols::creator(0x2730010))(reinterpret_cast<quintptr>(identity.project.get()),&identity.store);
    if(!identity.store)throw std::runtime_error("no active project store");
    using Text=std::string*(__fastcall*)(quintptr,std::string*);
    std::string id,path;
    ExplorerFaultBoundary::stage="session.sdkId";
    entry<Text>(sdk,sdkStoreIdName,sdkStoreIdRva)(reinterpret_cast<quintptr>(identity.store.get()),&id);
    ExplorerFaultBoundary::stage="session.sdkPath";
    entry<Text>(sdk,foldPathName,foldPathRva)(reinterpret_cast<quintptr>(identity.store.get()),&path);
    if(id.size()>64 || path.size()>8192)throw std::runtime_error("session identity bounds changed");
    const auto uuid=QUuid(QString::fromStdString(id));
    if(uuid.isNull())throw std::runtime_error("active draft ID unavailable");
    identity.draftId=uuid.toString(QUuid::WithoutBraces).toUpper();
    const auto source=QString::fromUtf8(path.data(),static_cast<qsizetype>(path.size()));
    const QFileInfo folder(source);
    if(!folder.isAbsolute() || !folder.isDir())throw std::runtime_error("active project directory unavailable");
    identity.location=QDir::cleanPath(folder.canonicalFilePath());
    if(identity.location.isEmpty())throw std::runtime_error("active project directory is not canonical");
    std::shared_ptr<void> project,store;
    ExplorerFaultBoundary::stage="session.current";
    reinterpret_cast<Get>(ExplorerSymbols::creator(0x4bbaf60))(ExplorerSymbols::creator(0xebb65b0),&project);
    if(project!=identity.project)throw std::runtime_error("active project changed during identity read");
    ExplorerFaultBoundary::stage="session.store";
    reinterpret_cast<Get>(ExplorerSymbols::creator(0x2730010))(reinterpret_cast<quintptr>(project.get()),&store);
    if(store!=identity.store)throw std::runtime_error("active store changed during identity read");
    return identity;
}
}
