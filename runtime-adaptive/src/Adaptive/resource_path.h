#pragma once
#include <QtCore/QDir>
#include <QtCore/QRegularExpression>
#include <QtCore/QString>
namespace ExplorerResourcePath {
inline QString key(QString path,const QString& project) {
    static const QRegularExpression placeholder(QStringLiteral("^##_draftpath_placeholder_[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}_##[/\\\\](.+)$"));
    const auto match=placeholder.match(path);
    const bool relativeProject=path.startsWith(QStringLiteral("./")) || path.startsWith(QStringLiteral(".\\"));
    if(match.hasMatch() || relativeProject) {
        auto relative=match.hasMatch()?match.captured(1):path.mid(2);relative.replace(QLatin1Char('\\'),QLatin1Char('/'));
        for(const auto& part:relative.split(QLatin1Char('/')))if(part.isEmpty() || part==QStringLiteral(".") || part==QStringLiteral("..") || part.contains(QLatin1Char(':')) || part.contains(QChar(0)))return {};
        path=project+QLatin1Char('/')+relative;
    }
    path.replace(QLatin1Char('\\'),QLatin1Char('/'));
    return QDir::cleanPath(path).toCaseFolded();
}
}
