#pragma once
#include "../CapSync.NativeProbe/qt62_compat.h"
#include <QtCore/QCoreApplication>
#include <QtCore/QMimeData>
#include <QtCore/QUrl>
#include <QtGui/QDragEnterEvent>
#include <QtGui/QDragLeaveEvent>
#include <QtGui/QDragMoveEvent>
#include <QtGui/QDropEvent>
#include <QtQuick/QQuickWindow>

struct DropDelivery { bool entered = false; bool moved = false; bool dropped = false; };

inline DropDelivery deliverDrop(QQuickWindow* window, const QPoint& point, const QUrl& url) {
    QMimeData mime;
    mime.setUrls({url});
    DropDelivery result;
    QDragEnterEvent enter(point, Qt::CopyAction, &mime, Qt::LeftButton, Qt::NoModifier);
    QCoreApplication::sendEvent(window, &enter);
    result.entered = enter.isAccepted();
    if (result.entered) {
        QDragMoveEvent move(point, Qt::CopyAction, &mime, Qt::LeftButton, Qt::NoModifier);
        QCoreApplication::sendEvent(window, &move);
        result.moved = move.isAccepted();
        if (result.moved) {
            QDropEvent drop(QPointF(point), Qt::CopyAction, &mime, Qt::LeftButton, Qt::NoModifier);
            QCoreApplication::sendEvent(window, &drop);
            result.dropped = drop.isAccepted();
        }
    }
    QDragLeaveEvent leave;
    QCoreApplication::sendEvent(window, &leave);
    return result;
}
