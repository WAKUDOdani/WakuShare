// R4097 lab-only hierarchy writer. No material serializer or project-file writes.
#pragma once
#include <array>
#include <cstdint>
#include <cstddef>
#include <tuple>
#include <algorithm>

struct FolderStoreChange {
    struct Folder {
        std::string id,name;
        std::int64_t creation,importTime,importUs;
        int sort,subSort,filter,subdraftFilter;
        std::string color;
        auto shape()const{return std::tie(id,name,creation,importTime,importUs,sort,subSort,filter,subdraftFilter,color);}
    };
    struct Edge {std::string child,parent;};
    // This route rejects nonempty subdraft/color collections rather than
    // constructing values whose ABI has not been established.
    struct Reserved {std::array<unsigned char,0x48> bytes;};
    struct Data {
        std::vector<Folder> folders;
        std::vector<Edge> edges;
        std::vector<Reserved> reserved;
        std::map<std::string,std::string> colors;
    } data;
    BinSnapshot& sdk;
    std::shared_ptr<void> store;
    quintptr cache=0;
    std::string card,target;

    static std::string text(quintptr address){
        const auto size=read<quintptr>(address+16),capacity=read<quintptr>(address+24);
        if(size>4096 || capacity<size || capacity>1024*1024)throw std::runtime_error("Hierarchy string bounds changed");
        const auto source=capacity<16?address:read<quintptr>(address);
        std::string value(static_cast<size_t>(size),'\0');SIZE_T actual=0;
        if(size && (!ReadProcessMemory(GetCurrentProcess(),reinterpret_cast<LPCVOID>(source),value.data(),size,&actual) || actual!=size))
            throw std::runtime_error("Hierarchy string unreadable");
        return value;
    }
    static std::pair<quintptr,size_t> vector(quintptr address,size_t stride){
        const auto begin=read<quintptr>(address),end=read<quintptr>(address+8),limit=read<quintptr>(address+16);
        if(end<begin || limit<end || (end-begin)%stride || (limit-begin)%stride || (limit-begin)/stride>1024 ||
           (begin && begin<0x10000))throw std::runtime_error("Hierarchy vector bounds changed");
        return {begin,static_cast<size_t>((end-begin)/stride)};
    }
    static Folder folder(quintptr address){
        return {text(address),text(address+0x20),read<std::int64_t>(address+0x40),
            read<std::int64_t>(address+0x48),read<std::int64_t>(address+0x50),
            read<int>(address+0x58),read<int>(address+0x5c),read<int>(address+0x60),read<int>(address+0x64),text(address+0x68)};
    }
    void verifyCache(const Data& expected)const{
        const auto folders=vector(cache,0x88),edges=vector(cache+0x18,0x40);
        if(folders.second!=expected.folders.size() || edges.second!=expected.edges.size() ||
           vector(cache+0x30,0x48).second || read<quintptr>(cache+0x50))
            throw std::runtime_error("SDK hierarchy shape differs from saved hierarchy");
        for(size_t i=0;i<folders.second;++i)
            if(folder(folders.first+i*0x88).shape()!=expected.folders[i].shape())
                throw std::runtime_error("SDK folder differs from saved folder");
        for(size_t i=0;i<edges.second;++i){
            const auto at=edges.first+i*0x40;
            if(text(at)!=expected.edges[i].child || text(at+0x20)!=expected.edges[i].parent)
                throw std::runtime_error("SDK hierarchy edge differs from saved edge");
        }
    }
    FolderStoreChange(BinSnapshot& snapshot,const QString& metaPath,const char* material,const char* destination):
        sdk(snapshot),card(material),target(destination){
        static_assert(sizeof(Folder)==0x88 && offsetof(Folder,color)==0x68,"unsupported folder ABI");
        static_assert(sizeof(Edge)==0x40 && sizeof(Data)==0x58 && offsetof(Data,colors)==0x48,"unsupported hierarchy ABI");
        QFile file(QFileInfo(metaPath).dir().filePath(QStringLiteral("draft_virtual_store.json")));
        if(!file.open(QIODevice::ReadOnly))throw std::runtime_error("Saved hierarchy unavailable");
        const auto document=QJsonDocument::fromJson(file.readAll()).object();
        if(!document.value("draft_materials").toArray().isEmpty())throw std::runtime_error("Unexpected hierarchy materials");
        const auto groups=document.value("draft_virtual_store").toArray();
        if(groups.size()!=3)throw std::runtime_error("Unexpected hierarchy groups");
        std::set<int> kinds;std::set<std::string> folderIds,children;
        for(const auto group:groups){
            const auto object=group.toObject();const auto kind=object.value("type").toInt(-1);
            if(!kinds.insert(kind).second)throw std::runtime_error("Duplicate hierarchy kind");
            for(const auto value:object.value("value").toArray()){
                const auto row=value.toObject();
                auto str=[&](const char* key){return row.value(QLatin1String(key)).toString().toStdString();};
                auto number=[&](const char* key){const auto v=row.value(QLatin1String(key));
                    if(!v.isDouble())throw std::runtime_error("Invalid hierarchy number");return v.toInteger();};
                if(kind==0){
                    Folder item{str("id"),str("display_name"),number("creation_time"),number("import_time"),number("import_time_us"),
                        static_cast<int>(number("sort_type")),static_cast<int>(number("sort_sub_type")),
                        static_cast<int>(number("filter_type")),static_cast<int>(number("subdraft_filter_type")),str("material_color_tag")};
                    if(!folderIds.insert(item.id).second)throw std::runtime_error("Duplicate folder UUID");
                    data.folders.push_back(std::move(item));
                }else if(kind==1){
                    Edge item{str("child_id"),str("parent_id")};
                    if(!children.insert(item.child).second)throw std::runtime_error("Duplicate child UUID");
                    data.edges.push_back(std::move(item));
                }else throw std::runtime_error("Nonempty reserved hierarchy refused");
            }
        }
        if(kinds!=std::set<int>{0,1,2} || !folderIds.count(target) || !children.count(card))
            throw std::runtime_error("Hierarchy destination or owned child absent");
        using Get=void*(__fastcall*)(quintptr,std::shared_ptr<void>*);
        sdk.entry<Get>("?getVirtualStore@StoreWrapper@draft_store@@QEAA?AV?$shared_ptr@VVirtualStore@draft_store@@@std@@XZ",0x1359ef0)
            (reinterpret_cast<quintptr>(sdk.store.get()),&store);
        if(!store)throw std::runtime_error("SDK virtual store absent");
        const auto implementation=read<quintptr>(reinterpret_cast<quintptr>(store.get())+0x18);
        if(implementation<0x10000)throw std::runtime_error("SDK virtual store implementation absent");
        cache=implementation+0xd8;verifyCache(data);
    }
    void apply(){
        verifyCache(data);
        auto selected=std::find_if(data.edges.begin(),data.edges.end(),[&](const Edge& edge){return edge.child==card;});
        if(selected==data.edges.end() || selected->parent==target)throw std::runtime_error("Hierarchy ownership changed");
        selected->parent=target;
        const Data expected=data;
        // ABI from the installed write wrapper and its exact move assignment:
        // three vectors at 0/18/30 and an empty map at48; Future is shared state.
        using Write=void*(__fastcall*)(quintptr,std::shared_ptr<void>*,Data*);
        std::shared_ptr<void> future;
        sdk.entry<Write>("?write@VirtualStore@draft_store@@QEAA?AV?$Future@UEmpty@future@lyra@@@lyra@@$$QEAUVirtualStoreData@2@@Z",0x1366ac0)
            (reinterpret_cast<quintptr>(store.get()),&future,&data);
        if(!future)throw std::runtime_error("SDK hierarchy write returned no future");
        verifyCache(expected);
        // The SDK moves the requested data into its cache synchronously and
        // queues disk persistence; external full comparisons await that save.
        const auto edges=vector(cache+0x18,0x40);size_t found=0;
        for(size_t i=0;i<edges.second;++i)if(text(edges.first+i*0x40)==card){
            if(text(edges.first+i*0x40+0x20)!=target)throw std::runtime_error("SDK hierarchy write not applied");++found;
        }
        if(found!=1)throw std::runtime_error("SDK hierarchy write lost owned edge");
    }
};
