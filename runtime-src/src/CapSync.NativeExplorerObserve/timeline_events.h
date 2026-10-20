#pragma once
#include <QtCore/QChildEvent>
#include <QtCore/QPointer>
#include <QtGui/QGuiApplication>
#include <QtQuick/QQuickItem>
#include <QtQuick/QQuickWindow>
#include <QtQml/QQmlContext>
#include <QtQml/QQmlEngine>

// UI object lifetime is a structural event even when the draft model itself
// is not a QObject child. Never subscribes to position, playback or repaint.
class ExplorerTimelineEvents final:public QObject {
public:
    explicit ExplorerTimelineEvents(QObject* host):QObject(host),host_(host){setObjectName(QStringLiteral("WakuShareTimelineEventsV1"));}
    ~ExplorerTimelineEvents()override{QCoreApplication::instance()->removeEventFilter(this);}
    static bool segment(QObject* object){
        const QByteArray name=object->metaObject()->className();
        return name=="MainTimeLineSegmentVideoViewModel" || name=="MainTimeLineSegmentAudioViewModel" ||
            name.startsWith("MainTimeLineSegmentVideo_QML") || name.startsWith("MainTimeLineSegmentAudio_QML");
    }
    void start(){
        QList<QPointer<QObject>> pending{QCoreApplication::instance()};
        for(auto* window:QGuiApplication::allWindows())pending.append(window);
        QSet<QObject*> seen;QSet<QQmlContext*> contexts;
        while(!pending.isEmpty() && seen.size()<50000){
            auto* object=pending.takeLast().data();if(!object || seen.contains(object) || object->thread()!=QThread::currentThread())continue;
            seen.insert(object);watch(object);
            for(auto* child:object->children())pending.append(child);
            if(auto* window=qobject_cast<QQuickWindow*>(object))pending.append(window->contentItem());
            if(auto* item=qobject_cast<QQuickItem*>(object))for(auto* child:item->childItems())pending.append(child);
            if(auto* engine=qobject_cast<QQmlEngine*>(object))pending.append(engine->rootContext());
            auto* context=qobject_cast<QQmlContext*>(object);if(!context)context=QQmlEngine::contextForObject(object);int depth=0;
            while(context && !contexts.contains(context) && depth++<64 && context->thread()==QThread::currentThread()){
                contexts.insert(context);if(auto* model=context->contextObject())pending.append(model);
                pending.append(context);context=context->parentContext();
            }
        }
        if(!pending.isEmpty())throw std::runtime_error("timeline lifetime scope overflow");
        QCoreApplication::instance()->installEventFilter(this);
    }
    int watched()const{return watched_.size();}
    bool healthy()const{return !disabled_;}
protected:
    bool eventFilter(QObject*,QEvent* event)override{
        if(event->type()!=QEvent::ChildAdded || disabled_)return false;
        auto* child=static_cast<QChildEvent*>(event)->child();
        if(pending_.size()>=4096){disabled_=true;pending_.clear();pulse();return false;}
        pending_.append(child);
        if(!queued_){queued_=true;QMetaObject::invokeMethod(this,[this]{
            queued_=false;const auto added=std::move(pending_);pending_.clear();bool changed=false;
            for(const auto& pointer:added)if(auto* object=pointer.data())if(object->thread()==QThread::currentThread() && !watched_.contains(object) && segment(object)){
                if(watched_.size()>=1024){disabled_=true;changed=true;break;}watch(object);changed=true;
            }
            if(changed)pulse();
        },Qt::QueuedConnection);}
        return false;
    }
private:
    void pulse(){if(host_)QMetaObject::invokeMethod(host_.data(),"signal",Qt::QueuedConnection);}
    void watch(QObject* object){
        if(!segment(object) || watched_.contains(object))return;
        if(watched_.size()>=1024)throw std::runtime_error("timeline segment lifetime bound exceeded");
        watched_.insert(object);
        QObject::connect(object,&QObject::destroyed,this,[this,object]{watched_.remove(object);pulse();});
    }
    QPointer<QObject> host_;QSet<QObject*> watched_;QList<QPointer<QObject>> pending_;
    bool queued_=false,disabled_=false;
};
