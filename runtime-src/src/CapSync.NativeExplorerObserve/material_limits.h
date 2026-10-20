#pragma once
#include <cstddef>
namespace ExplorerLimits {
#if defined(CAPSYNC_PRODUCT_RUNTIME) && CAPSYNC_PRODUCT_GENERATION >= 5
inline constexpr std::size_t materialCount=16384;
#else
inline constexpr std::size_t materialCount=512;
#endif
}
