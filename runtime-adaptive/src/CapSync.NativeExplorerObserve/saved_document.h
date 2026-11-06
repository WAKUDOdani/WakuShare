#pragma once
#include "session_identity.h"
#include <QtCore/QFile>
#include <QtCore/QJsonDocument>
#include <QtCore/QJsonObject>

namespace ExplorerSavedDocument {
inline bool nameAllowed(const QString& name){
    return name==QStringLiteral("draft_meta_info.json") || name==QStringLiteral("draft_content.json") ||
        name==QStringLiteral("draft_virtual_store.json") || name==QStringLiteral("template-2.tmp");
}

#ifdef CAPSYNC_SDK_SAVED_DOCUMENTS
#define EXPLORER_SAVED_JSON(file) ExplorerSavedDocument::parse((file).readAll(),(file).fileName())
#else
#define EXPLORER_SAVED_JSON(file) QJsonDocument::fromJson((file).readAll())
#endif
inline QJsonDocument parse(const QByteArray& raw,const QString& path,qint64 limit=64*1024*1024){
    if(raw.size()>limit)throw std::runtime_error("project document exceeds bounds");
    const auto plain=QJsonDocument::fromJson(raw);
    if(plain.isObject())return plain;
    if(raw.trimmed().startsWith('{') || raw.trimmed().startsWith('['))throw std::runtime_error("project JSON invalid");
    const auto identity=ExplorerSession::current();const QFileInfo file(path);
    if(!nameAllowed(file.fileName()) || file.canonicalPath().compare(identity.location,Qt::CaseInsensitive))
        throw std::runtime_error("encrypted document outside active project");
    using Read=std::string*(__fastcall*)(quintptr,std::string*,const std::string&);
    const auto method=ExplorerSession::entry<Read>(GetModuleHandleW(L"videoeditor.dll"),
        "?readJsonFile@StoreWrapper@draft_store@@QEBA?AV?$basic_string@DU?$char_traits@D@std@@V?$allocator@D@2@@std@@AEBV34@@Z",0x135acc0);
    std::string decoded;const auto input=file.absoluteFilePath().toStdString();
    method(reinterpret_cast<quintptr>(identity.store.get()),&decoded,input);
    if(decoded.size()>static_cast<std::size_t>(limit))throw std::runtime_error("decoded document exceeds bounds");
    const auto document=QJsonDocument::fromJson(QByteArray(decoded.data(),static_cast<qsizetype>(decoded.size())));
    if(!document.isObject())throw std::runtime_error("SDK project document unavailable");
    QFile source(path);if(!source.open(QIODevice::ReadOnly) || source.readAll()!=raw)throw std::runtime_error("project changed during SDK document read");
    const auto after=ExplorerSession::current();if(after.project!=identity.project || after.store!=identity.store)throw std::runtime_error("project changed during SDK document read");
    return document;
}
inline QJsonDocument read(const QString& path,qint64 limit=64*1024*1024){
    QFile file(path);if(!file.open(QIODevice::ReadOnly) || file.size()>limit)throw std::runtime_error("project document unavailable");
    const auto raw=file.readAll();file.close();return parse(raw,path,limit);
}
}
