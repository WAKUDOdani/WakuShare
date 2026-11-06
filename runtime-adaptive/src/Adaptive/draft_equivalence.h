#pragma once
#include "symbols.h"
#include "resource_path.h"
namespace ExplorerDraftEquivalence {
using Json=ExplorerSymbols::Json;
inline bool resource(const std::string& value){return value.starts_with("##_draftpath_placeholder_") || value.starts_with("./") || value.starts_with(".\\");}
inline Json uniqueJson(const std::string& text) {
    std::vector<std::set<std::string>> keys;
    return Json::parse(text,[&](int,Json::parse_event_t event,Json& value){
        if(event==Json::parse_event_t::object_start)keys.emplace_back();
        else if(event==Json::parse_event_t::key && !keys.back().insert(value.get<std::string>()).second)throw std::runtime_error("duplicate style key");
        else if(event==Json::parse_event_t::object_end)keys.pop_back();
        return true;
    });
}
inline void normalize(Json& left,const Json& right,const QString& project) {
    if(left.is_object() && right.is_object())for(auto it=left.begin();it!=left.end();++it) {
        if(!right.contains(it.key()))continue;auto& a=it.value();const auto& b=right.at(it.key());
        if(a.is_string() && b.is_string() && (it.key()=="path" || it.key().ends_with("_path")) && resource(a.get<std::string>())) {
            const auto x=ExplorerResourcePath::key(QString::fromStdString(a.get<std::string>()),project),y=ExplorerResourcePath::key(QString::fromStdString(b.get<std::string>()),project);
            if(!x.isEmpty() && x==y)a=b;
        } else if(it.key()=="content" && a.is_string() && b.is_string() && a!=b) {
            try {
                auto x=uniqueJson(a.get<std::string>());const auto y=uniqueJson(b.get<std::string>());
                if(x.is_object() && y.is_object() && x.contains("text") && x["text"].is_string() && x.contains("styles") && x["styles"].is_array()) {normalize(x,y,project);if(x==y)a=b;}
            }catch(const std::exception&) { }
        } else normalize(a,b,project);
    } else if(left.is_array() && right.is_array())for(std::size_t i=0;i<std::min(left.size(),right.size());++i)normalize(left[i],right[i],project);
}
inline bool same(Json saved,const Json& live,const QString& project){normalize(saved,live,project);return saved==live;}
}
