#pragma once
#include <QtCore/QJsonObject>
#include <QtCore/QRegularExpression>

namespace ExplorerRegistryTree {
// CapCut keeps subtitle imports and compound definitions in the SDK registry
// without creating ordinary FileMetaDataNode cards for them. A saved tree edge
// still makes any such record mandatory, regardless of its declared type.
inline bool registryOnly(int group, const QJsonObject& row, bool linked) {
    if (linked) return false;
    const auto type = row.value("type").toInt(-1);
    const auto kind = row.value("metetype").toString();
    const auto path = row.value("file_Path").toString();
    if (group == 2 && type == 2 && kind == QStringLiteral("none"))
        return path.endsWith(QStringLiteral(".srt"), Qt::CaseInsensitive);
    static const QRegularExpression compound(QStringLiteral(
        "^\\./subdraft/[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}/sub_draft_config\\.json$"));
    return group == 18 && type == 18 && kind == QStringLiteral("combination") &&
        compound.match(path).hasMatch();
}
}
