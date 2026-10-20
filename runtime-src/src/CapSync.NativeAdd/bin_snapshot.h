// Read-only SDK ownership check around a lab tree operation. No SDK setters.
#pragma once
#include "../CapSync.NativeRelink/sdk_exports.h"
#include <memory>
#include <tuple>
#include "../CapSync.NativeExplorerObserve/material_limits.h"

struct BinSnapshot {
    using Materials=std::map<int,std::vector<std::shared_ptr<void>>>;
    using Shape=std::map<std::string,std::tuple<int,std::string,std::string>>;
    HMODULE sdk=GetModuleHandleW(L"videoeditor.dll");
    std::shared_ptr<void> project,store;
    Materials held;
    Shape before;
    bool stockServiceChanged=false;
    template<class T>T entry(const char* name,quintptr rva){
        auto p=GetProcAddress(sdk,name);
        if(!p || reinterpret_cast<quintptr>(p)!=reinterpret_cast<quintptr>(sdk)+rva)
            throw std::runtime_error("SDK export changed");
        return reinterpret_cast<T>(p);
    }
    static std::string path(const QString& value){return QDir::cleanPath(value).toCaseFolded().toStdString();}
    static Shape withoutStockService(Shape shape){
        const auto service=shape.find("cd484075-d92a-4bc9-b45c-d093d2f9e71b");
        if(service!=shape.end()){
            if(service->second!=std::make_tuple(0,path(QString()),std::string()))
                throw std::runtime_error("Known empty stock service record changed shape");
            shape.erase(service);
        }
        return shape;
    }
    Shape capture(bool retain=false){
        using Query=Materials*(__fastcall*)(quintptr,Materials*);
        using Text=std::string*(__fastcall*)(quintptr,std::string*);
        using Ref=const std::string&(__fastcall*)(quintptr);
        Materials all;entry<Query>(sdkQueryAllName,sdkQueryAllRva)(reinterpret_cast<quintptr>(store.get()),&all);
        Shape shape;
        for(const auto& group:all)for(const auto& material:group.second){
            if(!material || shape.size()>=ExplorerLimits::materialCount)throw std::runtime_error("SDK bin bounds changed");
            const auto address=reinterpret_cast<quintptr>(material.get());std::string key;
            entry<Text>(sdkMaterialIdName,sdkMaterialIdRva)(address,&key);
            const auto source=path(QString::fromStdString(entry<Ref>(sdkFilePathName,sdkFilePathRva)(address)));
            const auto label=entry<Ref>(sdkLabelName,sdkLabelRva)(address);
            if(!shape.emplace(key,std::make_tuple(group.first,source,label)).second)
                throw std::runtime_error("Duplicate SDK bin UUID");
        }
        if(retain)held=std::move(all);
        return shape;
    }
    BinSnapshot(quintptr creator,const QJsonObject& meta){
        static_assert(sizeof(Materials)==16 && sizeof(std::shared_ptr<void>)==16,"unsupported SDK ABI");
        if(!sdk)throw std::runtime_error("SDK absent");
        using Get=void*(__fastcall*)(quintptr,std::shared_ptr<void>*);
        reinterpret_cast<Get>(creator+0x4bbaf60)(creator+0xebb65b0,&project);
        if(!project)throw std::runtime_error("Active project absent");
        reinterpret_cast<Get>(creator+0x2730010)(reinterpret_cast<quintptr>(project.get()),&store);
        if(!store)throw std::runtime_error("Active store absent");
        using Id=std::string*(__fastcall*)(quintptr,std::string*);
        std::string id;entry<Id>(sdkStoreIdName,sdkStoreIdRva)(reinterpret_cast<quintptr>(store.get()),&id);
#ifdef CAPSYNC_PRODUCT_RUNTIME
        if(QString::fromStdString(id).toUpper()!=meta.value("draft_id").toString().toUpper())throw std::runtime_error("SDK store differs from project metadata");
#else
        if(id!="582F1BF9-2B25-4cf2-B83F-3528F1B868B2")throw std::runtime_error("Not lab SDK store");
#endif
        before=capture(true);Shape saved;
        for(const auto group:meta.value("draft_materials").toArray())
            for(const auto item:group.toObject().value("value").toArray()){
                const auto row=item.toObject();
                if(!saved.emplace(row.value("id").toString().toStdString(),
                    std::make_tuple(row.value("type").toInt(-1),path(row.value("file_Path").toString()),
                                    row.value("extra_info").toString().toStdString())).second)
                    throw std::runtime_error("Duplicate saved bin UUID");
            }
#if defined(CAPSYNC_PRODUCT_RUNTIME) && CAPSYNC_PRODUCT_GENERATION >= 5
        if(withoutStockService(before)!=withoutStockService(saved))throw std::runtime_error("Live SDK bin differs from complete saved registry");
#else
        if(before!=saved)throw std::runtime_error("Live SDK bin differs from complete saved registry");
#endif
        (void)withoutStockService(before);
    }
    void verify(){
        const auto after=capture();
        if(withoutStockService(after)!=withoutStockService(before))
            throw std::runtime_error("Tree operation changed the SDK material registry");
        stockServiceChanged=after.count("cd484075-d92a-4bc9-b45c-d093d2f9e71b")!=before.count("cd484075-d92a-4bc9-b45c-d093d2f9e71b");
    }
};
