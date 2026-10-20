// Verified read-only access to the actual SDK Draft, shared with catalog reads.
#pragma once
#include "session_identity.h"
#include <QtCore/QJsonDocument>
#include <QtCore/QJsonObject>
namespace ExplorerDraftSnapshot {
template<class T>T read(quintptr p){T value{};SIZE_T n=0;if(p<0x10000 || !ReadProcessMemory(GetCurrentProcess(),reinterpret_cast<LPCVOID>(p),&value,sizeof(value),&n) || n!=sizeof(value))throw std::runtime_error("unreadable live Draft owner");return value;}
struct Snapshot {
    std::shared_ptr<void> manager,opaque,owner;
    std::string text;
    using Serialize=std::string*(__fastcall*)(std::string*,const std::shared_ptr<void>&);
    Serialize serializer=nullptr;
    Snapshot(){
        const auto creator=reinterpret_cast<quintptr>(GetModuleHandleW(L"VECreator.dll"));const auto sdk=GetModuleHandleW(L"videoeditor.dll");
        using Get=std::shared_ptr<void>*(__fastcall*)(std::shared_ptr<void>*,int);using OwnerGet=void*(__fastcall*)(quintptr,std::shared_ptr<void>*);
        reinterpret_cast<Get>(creator+0x63d59b0)(&manager,1);if(!manager)throw std::runtime_error("live Draft manager absent");
        const auto address=reinterpret_cast<quintptr>(manager.get()),getter=read<quintptr>(read<quintptr>(address)+0x70);
        if(getter<creator || getter>=creator+0x7000000)throw std::runtime_error("live Draft getter bounds changed");
        reinterpret_cast<OwnerGet>(getter)(address,&opaque);if(!opaque)throw std::runtime_error("live Draft owner absent");
        const auto container=reinterpret_cast<quintptr>(opaque.get()),begin=read<quintptr>(container+8),end=read<quintptr>(container+0x10);
        if(end-begin!=16)throw std::runtime_error("one live lab timeline required");
        const auto holder=read<quintptr>(begin),root=read<quintptr>(holder);
        if(read<quintptr>(root)!=reinterpret_cast<quintptr>(sdk)+0x3064bb8)throw std::runtime_error("live Draft vtable differs");
        owner=*reinterpret_cast<const std::shared_ptr<void>*>(holder);
        serializer=ExplorerSession::entry<Serialize>(sdk,"?GetJsonFromDraft@lvve@@YA?AV?$basic_string@DU?$char_traits@D@std@@V?$allocator@D@2@@std@@AEBV?$shared_ptr@VDraft@lvve@@@3@@Z",0x110aea0);
        text=serialize();
    }
    std::string serialize()const{std::string value;serializer(&value,owner);if(value.size()>64*1024*1024)throw std::runtime_error("live Draft exceeds read bounds");return value;}
    QJsonObject object()const{return QJsonDocument::fromJson(QByteArray(text.data(),static_cast<qsizetype>(text.size()))).object();}
    void verify()const{if(serialize()!=text)throw std::runtime_error("live Draft changed during catalog read");}
};
}
