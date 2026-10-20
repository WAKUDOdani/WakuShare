#pragma once
#include "timeline_events.h"
#include "material_limits.h"

// Burst overflow schedules a bounded, chunked read-only recovery. No timers,
// dropped ownership evidence, or permanent failure from unrelated media QObjects.
class ExplorerTimelineEventsV2 final:public QObject {
public:
    explicit ExplorerTimelineEventsV2(QObject* host):QObject(host),host_(host){setObjectName(QStringLiteral("WakuShareTimelineEventsV2"));}
    ~ExplorerTimelineEventsV2()override{QCoreApplication::instance()->removeEventFilter(this);}
    void start(){QCoreApplication::instance()->installEventFilter(this);recover_=true;schedule();}
    bool healthy()const{return !disabled_ && !recover_ && !scanning_;}
    int watched()const{return watched_.size();}
    int recoveries()const{return recoveries_;}
protected:
    bool eventFilter(QObject*,QEvent* event)override{
        if(event->type()!=QEvent::ChildAdded || disabled_)return false;
        if(scanning_ || recover_){dirty_=true;return false;}
        if(pending_.size()>=4096){pending_.clear();recover_=true;}
        else pending_.append(static_cast<QChildEvent*>(event)->child());
        schedule();return false;
    }
private:
    void pulse(){if(host_)QMetaObject::invokeMethod(host_.data(),"signal",Qt::QueuedConnection);}
    void schedule(){if(queued_ || disabled_)return;queued_=true;QMetaObject::invokeMethod(this,[this]{queued_=false;step();},Qt::QueuedConnection);}
    void watch(QObject* object){
        if(!ExplorerTimelineEvents::segment(object) || watched_.contains(object))return;
        if(static_cast<std::size_t>(watched_.size())>=ExplorerLimits::materialCount)throw std::runtime_error("timeline segment lifetime bound exceeded");
        watched_.insert(object);QObject::connect(object,&QObject::destroyed,this,[this,object]{watched_.remove(object);pulse();});
    }
    void add(QObject* object){
        if(!object || object->thread()!=QThread::currentThread() || seen_.contains(object))return;
        if(seen_.size()>=1048576)throw std::runtime_error("timeline recovery object bound exceeded");
        seen_.insert(object);scan_.append(object);
    }
    void step(){
        try{
            if(recover_ && !scanning_){
                recover_=false;scanning_=true;dirty_=false;++recoveries_;pending_.clear();seen_.clear();contexts_.clear();scan_.clear();
                add(QCoreApplication::instance());for(auto* window:QGuiApplication::allWindows())add(window);
            }
            if(scanning_){
                int budget=512;
                while(!scan_.isEmpty() && budget--){
                    auto* object=scan_.takeLast().data();if(!object)continue;watch(object);
                    for(auto* child:object->children())add(child);
                    if(auto* window=qobject_cast<QQuickWindow*>(object))add(window->contentItem());
                    if(auto* item=qobject_cast<QQuickItem*>(object))for(auto* child:item->childItems())add(child);
                    if(auto* engine=qobject_cast<QQmlEngine*>(object))add(engine->rootContext());
                    auto* context=qobject_cast<QQmlContext*>(object);if(!context)context=QQmlEngine::contextForObject(object);int depth=0;
                    while(context && !contexts_.contains(context) && depth++<64 && context->thread()==QThread::currentThread()){
                        contexts_.insert(context);add(context->contextObject());add(context);context=context->parentContext();
                    }
                }
                if(!scan_.isEmpty()){schedule();return;}
                scanning_=false;seen_.clear();contexts_.clear();
                if(dirty_){recover_=true;schedule();return;}
                pulse();return;
            }
            const auto pending=std::move(pending_);pending_.clear();bool changed=false;
            for(const auto& pointer:pending)if(auto* object=pointer.data())if(object->thread()==QThread::currentThread() && !watched_.contains(object) && ExplorerTimelineEvents::segment(object)){watch(object);changed=true;}
            if(changed)pulse();
        }catch(const std::exception&){disabled_=true;pending_.clear();scan_.clear();seen_.clear();contexts_.clear();pulse();}
    }
    QPointer<QObject> host_;QSet<QObject*> watched_,seen_;QSet<QQmlContext*> contexts_;
    QList<QPointer<QObject>> pending_,scan_;
    bool queued_=false,disabled_=false,recover_=false,scanning_=false,dirty_=false;
    int recoveries_=0;
};
