#pragma once
#include <QtCore/QString>

namespace ExplorerStockService {
// The one empty stock node can exist before (or without) its saved row.
// Its ID alone never grants ownership to a media source or arbitrary extra node.
inline bool empty(const QString& id,unsigned kind,const QString& path,const QString& label,bool atRoot,bool leaf){
    return id==QStringLiteral("cd484075-d92a-4bc9-b45c-d093d2f9e71b") &&
        kind==7 && path.isEmpty() && label.isEmpty() && atRoot && leaf;
}
inline bool root(const QString& id,unsigned kind,const QString& path,const QString& label,bool atTree){
    return id.isEmpty() && kind==4 && path.isEmpty() && label.isEmpty() && atTree;
}
}
