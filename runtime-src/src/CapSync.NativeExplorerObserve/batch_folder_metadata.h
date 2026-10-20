#pragma once
#include <QtCore/QDateTime>
#include <string>
struct NativeMetadata {
    struct Pair {quintptr data,control;} pair{};
    explicit NativeMetadata(quintptr creator) {
        using Allocate=void*(__fastcall*)(size_t);
        using Construct=void(__fastcall*)(void*);
        auto* block=static_cast<unsigned char*>(reinterpret_cast<Allocate>(creator+0x6db4c20)(0x2c8));
        if(!block)throw std::bad_alloc();
        std::memset(block,0,0x2c8);
        *reinterpret_cast<quintptr*>(block)=creator+0xa1da828;
        *reinterpret_cast<LONG*>(block+8)=1;*reinterpret_cast<LONG*>(block+12)=1;
        pair={reinterpret_cast<quintptr>(block+16),reinterpret_cast<quintptr>(block)};
        reinterpret_cast<Construct>(creator+0x1532680)(block+16);
    }
    NativeMetadata(const NativeMetadata&)=delete;
    ~NativeMetadata() {
        if(!pair.control)return;
        using Release=void(__fastcall*)(void*);
        auto* block=reinterpret_cast<unsigned char*>(pair.control);
        if(InterlockedDecrement(reinterpret_cast<LONG*>(block+8))==0){
            const auto table=*reinterpret_cast<quintptr*>(block);
            reinterpret_cast<Release>(*reinterpret_cast<quintptr*>(table))(block);
            if(InterlockedDecrement(reinterpret_cast<LONG*>(block+12))==0)
                reinterpret_cast<Release>(*reinterpret_cast<quintptr*>(table+8))(block);
        }
    }
    void configure(quintptr creator,const QByteArray& identifier,const QByteArray& name) {
        static_assert(sizeof(std::string)==32,"Unsupported string ABI");
        using Assign=void(__fastcall*)(void*,const std::string&);
        const std::string key(identifier.constData(),static_cast<size_t>(identifier.size()));
        const std::string title(name.constData(),static_cast<size_t>(name.size()));
        reinterpret_cast<Assign>(creator+0xb74f10)(reinterpret_cast<void*>(pair.data),key);
        reinterpret_cast<Assign>(creator+0xb74f10)(reinterpret_cast<void*>(pair.data+0x98),title);
        *reinterpret_cast<unsigned*>(pair.data+0x138)=4;
        const auto ms=QDateTime::currentMSecsSinceEpoch();
        *reinterpret_cast<qint64*>(pair.data+0x40)=ms/1000;
        *reinterpret_cast<qint64*>(pair.data+0x48)=ms*1000;
        *reinterpret_cast<qint64*>(pair.data+0x50)=ms/1000;
    }
};
