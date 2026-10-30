// Verified read-only access to the actual SDK Draft, shared with catalog reads.
#pragma once
#include "session_identity.h"
#include <QtCore/QJsonDocument>
#include <QtCore/QJsonObject>
#ifdef CAPSYNC_MULTI_DRAFT_SNAPSHOT
#include <QtCore/QFile>
#include <vector>
#endif
namespace ExplorerDraftSnapshot {
template<class T>T read(quintptr p){T value{};SIZE_T n=0;if(p<0x10000 || !ReadProcessMemory(GetCurrentProcess(),reinterpret_cast<LPCVOID>(p),&value,sizeof(value),&n) || n!=sizeof(value))throw std::runtime_error("unreadable live Draft owner");return value;}
struct Snapshot {
    std::shared_ptr<void> manager,opaque,owner;
    std::string text;
    using Serialize=std::string*(__fastcall*)(std::string*,const std::shared_ptr<void>&);
    Serialize serializer=nullptr;
#ifdef CAPSYNC_MULTI_DRAFT_SNAPSHOT
    std::vector<std::shared_ptr<void>> owners;
    std::vector<std::string> snapshots;
#endif
    Snapshot(){
        const auto creator=reinterpret_cast<quintptr>(GetModuleHandleW(L"VECreator.dll"));const auto sdk=GetModuleHandleW(L"videoeditor.dll");
        using Get=std::shared_ptr<void>*(__fastcall*)(std::shared_ptr<void>*,int);using OwnerGet=void*(__fastcall*)(quintptr,std::shared_ptr<void>*);
        reinterpret_cast<Get>(creator+0x63d59b0)(&manager,1);if(!manager)throw std::runtime_error("live Draft manager absent");
        const auto address=reinterpret_cast<quintptr>(manager.get()),getter=read<quintptr>(read<quintptr>(address)+0x70);
        if(getter<creator || getter>=creator+0x7000000)throw std::runtime_error("live Draft getter bounds changed");
        reinterpret_cast<OwnerGet>(getter)(address,&opaque);if(!opaque)throw std::runtime_error("live Draft owner absent");
        const auto container=reinterpret_cast<quintptr>(opaque.get()),begin=read<quintptr>(container+8),end=read<quintptr>(container+0x10);
#ifdef CAPSYNC_MULTI_DRAFT_SNAPSHOT
        if(end<begin || (end-begin)%16 || end-begin<16 || end-begin>16*4096)throw std::runtime_error("live timeline collection bounds changed");
        serializer=ExplorerSession::entry<Serialize>(sdk,"?GetJsonFromDraft@lvve@@YA?AV?$basic_string@DU?$char_traits@D@std@@V?$allocator@D@2@@std@@AEBV?$shared_ptr@VDraft@lvve@@@3@@Z",0x110aea0);
        const auto identity=ExplorerSession::current();
        QFile saved(identity.location+QStringLiteral("/draft_content.json"));
        if(!saved.open(QIODevice::ReadOnly) || saved.size()>64*1024*1024)throw std::runtime_error("saved timeline unavailable");
        const auto wanted=QJsonDocument::fromJson(saved.readAll()).object().value("id").toString();
        if(wanted.isEmpty())throw std::runtime_error("saved timeline identity unavailable");
        for(auto entry=begin;entry<end;entry+=16) {
            const auto holder=read<quintptr>(entry),root=read<quintptr>(holder);
            if(read<quintptr>(root)!=reinterpret_cast<quintptr>(sdk)+0x3064bb8)throw std::runtime_error("live Draft vtable differs");
            auto candidate=*reinterpret_cast<const std::shared_ptr<void>*>(holder);
            if(!candidate)throw std::runtime_error("live timeline owner absent");
            for(const auto& previous:owners)if(previous==candidate)throw std::runtime_error("duplicate live timeline owner");
            std::string value;serializer(&value,candidate);
            if(value.empty() || value.size()>64*1024*1024)throw std::runtime_error("live Draft exceeds read bounds");
            const auto document=QJsonDocument::fromJson(QByteArray(value.data(),static_cast<qsizetype>(value.size())));
            if(!document.isObject() || document.object().value("id").toString().isEmpty())throw std::runtime_error("live timeline identity invalid");
            if(document.object().value("id").toString()==wanted) {
                if(owner)throw std::runtime_error("ambiguous saved timeline identity");
                owner=candidate;text=value;
            }
            owners.push_back(std::move(candidate));snapshots.push_back(std::move(value));
        }
        if(!owner)throw std::runtime_error("saved timeline not present in live collection");
#else
        if(end-begin!=16)throw std::runtime_error("one live lab timeline required");
        const auto holder=read<quintptr>(begin),root=read<quintptr>(holder);
        if(read<quintptr>(root)!=reinterpret_cast<quintptr>(sdk)+0x3064bb8)throw std::runtime_error("live Draft vtable differs");
        owner=*reinterpret_cast<const std::shared_ptr<void>*>(holder);
        serializer=ExplorerSession::entry<Serialize>(sdk,"?GetJsonFromDraft@lvve@@YA?AV?$basic_string@DU?$char_traits@D@std@@V?$allocator@D@2@@std@@AEBV?$shared_ptr@VDraft@lvve@@@3@@Z",0x110aea0);
        text=serialize();
#endif
    }
    std::string serialize()const{std::string value;serializer(&value,owner);if(value.size()>64*1024*1024)throw std::runtime_error("live Draft exceeds read bounds");return value;}
    QJsonObject object()const{return QJsonDocument::fromJson(QByteArray(text.data(),static_cast<qsizetype>(text.size()))).object();}
    void verify()const{
#ifdef CAPSYNC_MULTI_DRAFT_SNAPSHOT
        for(std::size_t i=0;i<owners.size();++i){std::string value;serializer(&value,owners[i]);if(value!=snapshots[i])throw std::runtime_error("live timeline changed during catalog read");}
#endif
        if(serialize()!=text)throw std::runtime_error("live Draft changed during catalog read");
    }
};
}
