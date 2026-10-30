#include "../src/CapSync.NativeProbe/qt62_compat.h"
#include "../src/CapSync.NativeExplorerObserve/registry_tree_scope.h"
#include <QtCore/QCoreApplication>
#include <QtCore/QJsonArray>
#include <QtCore/QJsonDocument>
#include <QtCore/QFile>
#include <cstdio>
#include <stdexcept>

int main(int argc, char** argv) {
    QCoreApplication app(argc, argv);
    auto check=[](bool result){if(!result)throw std::runtime_error("registry/tree scope control failed");};
    QJsonObject srt{{"type",2},{"metetype","none"},{"file_Path","C:/media/captions.srt"}};
    QJsonObject compound{{"type",18},{"metetype","combination"},{"file_Path","./subdraft/7F93D4FC-A0EB-45e8-BBA9-3220FA5CB853/sub_draft_config.json"}};
    check(ExplorerRegistryTree::registryOnly(2,srt,false));
    check(!ExplorerRegistryTree::registryOnly(2,srt,true));
    check(ExplorerRegistryTree::registryOnly(18,compound,false));
    check(!ExplorerRegistryTree::registryOnly(18,compound,true));
    for(const auto kind:{"video","music","photo","gif"}) {
        auto media=srt;media["type"]=0;media["metetype"]=kind;
        check(!ExplorerRegistryTree::registryOnly(0,media,false));
        check(!ExplorerRegistryTree::registryOnly(2,media,false));
    }
    auto wrong=srt;wrong["file_Path"]="C:/media/file.mp4";check(!ExplorerRegistryTree::registryOnly(2,wrong,false));
    wrong=srt;wrong["type"]=0;check(!ExplorerRegistryTree::registryOnly(2,wrong,false));
    for(const auto path:{"../subdraft/id/sub_draft_config.json","./subdraft/not-uuid/sub_draft_config.json","C:/other/config.json","./subdraft/7F93D4FC-A0EB-45e8-BBA9-3220FA5CB853/../sub_draft_config.json"}) {
        wrong=compound;wrong["file_Path"]=path;check(!ExplorerRegistryTree::registryOnly(18,wrong,false));
    }
    // Read the real saved registry through the same compiled predicate, no editor calls.
    if(argc==2) {
        QFile file(QString::fromLocal8Bit(argv[1]));check(file.open(QIODevice::ReadOnly));
        const auto meta=QJsonDocument::fromJson(file.readAll()).object();int registryOnly=0,ordinary=0;
        for(const auto group:meta.value("draft_materials").toArray())for(const auto value:group.toObject().value("value").toArray()) {
            if(ExplorerRegistryTree::registryOnly(group.toObject().value("type").toInt(-1),value.toObject(),false))++registryOnly;else ++ordinary;
        }
        std::printf("{\"registryOnly\":%d,\"ordinary\":%d,\"accepted\":true}\n",registryOnly,ordinary);
    }else std::puts("{\"accepted\":true}");
}
