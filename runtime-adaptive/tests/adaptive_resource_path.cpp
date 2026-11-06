#include "../src/Adaptive/resource_path.h"
#include "../src/Adaptive/fault_boundary.h"
#include "../src/Adaptive/draft_equivalence.h"
#include <cassert>
int main() {
    using ExplorerResourcePath::key;
    const auto root=QStringLiteral("C:/Projects/One");
    const auto absolute=QStringLiteral("C:/Projects/One/Resources/font.ttf");
    const auto token=QStringLiteral("##_draftpath_placeholder_11111111-1111-4111-8111-111111111111_##/");
    assert(key(token+QStringLiteral("Resources/font.ttf"),root)==key(absolute,root));
    assert(key(QStringLiteral("./Resources/font.ttf"),root)==key(absolute,root));
    assert(key(QStringLiteral(".\\Resources\\font.ttf"),root)==key(absolute,root));
    assert(key(token+QStringLiteral("../Other/font.ttf"),root).isEmpty());
    assert(key(QStringLiteral("./../Other/font.ttf"),root).isEmpty());
    assert(key(token+QStringLiteral("C:/Other/font.ttf"),root).isEmpty());
    assert(key(token+QStringLiteral("Resources/other.ttf"),root)!=key(absolute,root));
    using Json=ExplorerDraftEquivalence::Json;
    const auto saved=Json{{"id","keep"},{"materials",{{"videos",Json::array({Json{{"path",(token+QStringLiteral("Resources/font.ttf")).toStdString()},{"duration",10}}})}}}};
    auto live=saved;live["materials"]["videos"][0]["path"]=absolute.toStdString();
    assert(ExplorerDraftEquivalence::same(saved,live,root));
    live["materials"]["videos"][0]["duration"]=11;assert(!ExplorerDraftEquivalence::same(saved,live,root));
    const auto fault=ExplorerFaultBoundary::invoke([](void*){RaiseException(EXCEPTION_ACCESS_VIOLATION,0,0,nullptr);},nullptr);
    assert(fault==EXCEPTION_ACCESS_VIOLATION);
    return 0;
}
