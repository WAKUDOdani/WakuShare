#include <QtCore/QThread>
#include "../src/CapSync.NativeExplorerObserve/timeline_events_v3.h"
#include <QtCore/QEventLoop>
#undef NDEBUG
#include <cassert>
#include <cstdio>
class ObserverHost final:public QObject {
    Q_OBJECT
public:using QObject::QObject;int pulses=0;
public slots:void signal(){++pulses;}
};
class MainTimeLineSegmentVideoViewModel final:public QObject {
    Q_OBJECT
public:using QObject::QObject;
};
int main(int argc,char** argv) {
    QGuiApplication app(argc,argv);QObject root(&app);ObserverHost host(&app);
    for(int i=0;i<5000;++i)new QObject(&root);
    ExplorerTimelineEventsV3 relay(&host);relay.start();
    auto* segment=new MainTimeLineSegmentVideoViewModel(&root);
    for(int i=0;i<60;++i){
        for(int j=0;j<32;++j)new QObject(&root);
        QCoreApplication::processEvents(QEventLoop::AllEvents,1);
    }
    for(int i=0;i<100 && !relay.healthy();++i)QCoreApplication::processEvents(QEventLoop::AllEvents,5);
    assert(relay.healthy());assert(relay.recoveries()==1);assert(relay.watched()==1);
    QCoreApplication::processEvents();assert(host.pulses>0);
    delete segment;QCoreApplication::processEvents();assert(relay.watched()==0);
    std::puts("accepted: unrelated QObject churn settles; timeline creation and destruction remain observed");
}
#include "adaptive_timeline_observer.moc"
