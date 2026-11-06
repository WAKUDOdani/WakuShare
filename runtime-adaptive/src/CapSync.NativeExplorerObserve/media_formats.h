#pragma once
#include <QtCore/QString>
#include <QtCore/QStringList>
// Only the thirty real stock imports accepted in the 4097 laboratory batch.
// This is separate from SDK decoder recognition and from production enablement.
namespace ExplorerMedia {
inline QString kind(QString suffix) {
    suffix=suffix.toLower();if(suffix.startsWith(QLatin1Char('.')))suffix.remove(0,1);
    if(QStringList{"png","jpg","jpeg","bmp","webp","tif","tiff","ico","avif"}.contains(suffix))return QStringLiteral("photo");
    if(suffix==QStringLiteral("gif"))return QStringLiteral("gif");
    if(QStringList{"wav","mp3","m4a","aac","flac","ogg","opus","wma"}.contains(suffix))return QStringLiteral("music");
    if(QStringList{"mp4","mov","m4v","mkv","avi","webm","mpg","mpeg","ts","mts","wmv","flv"}.contains(suffix))return QStringLiteral("video");
    return {};
}
}
