// Only the newly added laboratory WAV clip may be removed by this experiment.
#pragma once
#include <set>
namespace UsedFixture {
constexpr auto card="2be45d14-7886-4724-8fcb-067841ddd2cf";
constexpr auto source="52C4CEAA-AE6A-42e6-963C-7FE63D37782B";
constexpr auto clip="43DA483E-6C2F-4850-8E27-D4E39BD1ECA3";
struct Scope {
    Json segment,track;std::set<std::string> removable;std::string trackId;
    explicit Scope(const Json& before){
        int total=0,found=0,sourceCount=0;
        for(const auto& t:before.at("tracks"))for(const auto& s:t.at("segments")){
            ++total;
            if(s.at("material_id")==source){
                if(s.at("id")!=clip || t.at("type")!="audio" || t.at("segments").size()!=1)throw std::runtime_error("only the one new WAV test clip may be deleted");
                segment=s;track=t;trackId=t.at("id").get<std::string>();++found;
            }
        }
        if(total!=12 || found!=1)throw std::runtime_error("twelve-clips fixture baseline differs");
        for(const auto& s:before.at("materials").at("audios"))if(s.at("id")==source){
            if(s.at("type")!="extract_music" || s.at("local_material_id")!=card || !QString::fromStdString(s.at("path").get<std::string>()).endsWith(QStringLiteral("/FinalUsedChecks-20261020/verified-used.wav")))throw std::runtime_error("controlled WAV source differs");++sourceCount;
        }
        if(sourceCount!=1)throw std::runtime_error("one exact WAV source required");
        removable.insert(source);
        for(const auto& id:segment.at("extra_material_refs"))removable.insert(id.get<std::string>());
        if(removable.size()>16)throw std::runtime_error("fixture auxiliary-material bound exceeded");
        for(const auto& t:before.at("tracks"))for(const auto& s:t.at("segments"))if(s.at("id")!=clip){
            if(removable.count(s.at("material_id").get<std::string>()))throw std::runtime_error("test material is shared with another clip");
            for(const auto& id:s.at("extra_material_refs"))if(removable.count(id.get<std::string>()))throw std::runtime_error("test auxiliary material is shared");
        }
    }
    bool check(const Json& before,const Json& after)const{
        auto normalized=after;int count=0;Json expectedTracks=Json::array();std::set<std::string> actualTrackIds;
        for(const auto& t:after.at("tracks")){
            const auto id=t.at("id").get<std::string>();if(!actualTrackIds.insert(id).second)return false;
            const auto original=std::find_if(before.at("tracks").begin(),before.at("tracks").end(),[&](const Json& row){return row.at("id")==id;});
            if(original==before.at("tracks").end())return false;
            auto expected=*original;Json segments=Json::array();
            for(const auto& s:original->at("segments"))if(s.at("id")!=clip)segments.push_back(s);
            expected["segments"]=segments;
            auto current=t;
            if(current.at("segments").size()!=segments.size())return false;
            for(size_t i=0;i<segments.size();++i){
                const auto index=current["segments"][i].at("track_render_index");
                if(index!=segments[i].at("track_render_index") && index!=expectedTracks.size())return false;
                current["segments"][i]["track_render_index"]=segments[i].at("track_render_index");++count;
            }
            if(current!=expected)return false;
            expectedTracks.push_back(*original);
        }
        if(count!=11)return false;
        Json filtered=Json::array();for(const auto& t:before.at("tracks"))if(actualTrackIds.count(t.at("id").get<std::string>()))filtered.push_back(t);else if(t.at("id")!=trackId)return false;
        if(expectedTracks!=filtered)return false;
        normalized["tracks"]=before.at("tracks");
        if(after.at("materials").size()!=before.at("materials").size())return false;
        for(auto group=before.at("materials").begin();group!=before.at("materials").end();++group){
            const auto& current=after.at("materials").at(group.key());
            if(!group.value().is_array() || !current.is_array()){if(current!=group.value())return false;continue;}
            std::set<std::string> ids;for(const auto& row:current)if(!ids.insert(row.at("id").get<std::string>()).second)return false;
            Json retained=Json::array();for(const auto& row:group.value())if(ids.count(row.at("id").get<std::string>()))retained.push_back(row);else if(!removable.count(row.at("id").get<std::string>()))return false;
            if(current!=retained)return false;normalized["materials"][group.key()]=group.value();
        }
        int64_t end=0;for(const auto& t:after.at("tracks"))for(const auto& s:t.at("segments"))end=std::max(end,s.at("target_timerange").at("start").get<int64_t>()+s.at("target_timerange").at("duration").get<int64_t>());
        if(after.at("duration")!=before.at("duration") && after.at("duration")!=end)return false;
        normalized["duration"]=before.at("duration");return normalized==before;
    }
};
}
