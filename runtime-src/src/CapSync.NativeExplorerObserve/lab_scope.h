#pragma once
#include "../CapSync.NativeProbe/qt62_compat.h"
#include <Windows.h>
#include <QtCore/QObject>
#include <QtCore/QSet>
#include <cstring>
#include <stdexcept>
#include <vector>
#ifdef CAPSYNC_PRODUCT_RUNTIME
#include "project_scope.h"
#endif

namespace ExplorerLab {
template<class T>T read(quintptr address) {
    T value{};SIZE_T count=0;
    if(address<0x10000 || !ReadProcessMemory(GetCurrentProcess(),reinterpret_cast<void*>(address),&value,sizeof(value),&count) || count!=sizeof(value))
        throw std::runtime_error("lab scope unreadable");
    return value;
}
inline QObject* object(quintptr address,const char* type) {
    const auto data=read<quintptr>(address+8);
    if(read<quintptr>(data+8)!=address || (read<unsigned>(data+48)&0x0c))throw std::runtime_error("lab object lifetime changed");
    auto* value=reinterpret_cast<QObject*>(address);
    if(std::strcmp(value->metaObject()->className(),type))throw std::runtime_error("lab object class changed");
    return value;
}
inline QString nodeId(QObject* node) {
    const auto data=read<quintptr>(reinterpret_cast<quintptr>(node)+0x10);
    const auto length=read<quintptr>(data+16),capacity=read<quintptr>(data+24);
    if(length>64 || capacity<length || capacity>1024)throw std::runtime_error("lab node identity unavailable");
    QByteArray value(static_cast<qsizetype>(length),'\0');SIZE_T count=0;
    if(length && (!ReadProcessMemory(GetCurrentProcess(),reinterpret_cast<void*>(capacity<16?data:read<quintptr>(data)),value.data(),length,&count) || count!=length))
        throw std::runtime_error("lab node identity unreadable");
    return QString::fromLatin1(value);
}
inline QObject* grid() {
#ifdef CAPSYNC_PRODUCT_RUNTIME
    return ExplorerProject::grid();
#else
    const auto creator=reinterpret_cast<quintptr>(GetModuleHandleW(L"VECreator.dll"));
    if(!creator)throw std::runtime_error("editor module absent");
    const auto service=read<quintptr>(creator+0xec16c18),current=read<quintptr>(service+0x70);
    object(current,"FileMetaDataNode");
    auto* tree=object(read<quintptr>(current+0x30),"FileMetaDataTree");
    auto* result=object(reinterpret_cast<quintptr>(tree->parent()),"LocalMediaInfoGridViewModel");
    QSet<QString> ids;std::vector<QObject*> pending;
    for(auto* child:tree->children())pending.push_back(child);
    while(!pending.empty()) {
        auto* node=pending.back();pending.pop_back();object(reinterpret_cast<quintptr>(node),"FileMetaDataNode");
        const auto id=nodeId(node);
        if(ids.size()>=512 || ids.contains(id) || read<quintptr>(reinterpret_cast<quintptr>(node)+0x30)!=reinterpret_cast<quintptr>(tree))
            throw std::runtime_error("lab tree scope changed");
        ids.insert(id);for(auto* child:node->children())pending.push_back(child);
    }
    for(const auto* id:{"963b593d-fae8-4af9-a487-29f0e73c8be5","f3fd343f-a805-42f7-9109-49e1dc8da258","9fa014be-4728-46ff-aedc-3327a8cc6b63"})
        if(!ids.contains(QString::fromLatin1(id)))throw std::runtime_error("outside authorized lab tree");
    return result;
#endif
}
}
