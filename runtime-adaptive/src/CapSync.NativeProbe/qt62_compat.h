#pragma once
#include <QtCore/qcompilerdetection.h>

// Qt 6.2 used Microsoft's nonstandard checked iterators, removed in MSVC 14.51.
// Use the raw-iterator form Qt already uses on other compilers. No Qt data
// layout or exported declaration changes; the downloaded SDK stays intact.
#if defined(_MSC_VER) && _MSC_VER >= 1951
#undef QT_MAKE_CHECKED_ARRAY_ITERATOR
#undef QT_MAKE_UNCHECKED_ARRAY_ITERATOR
#define QT_MAKE_CHECKED_ARRAY_ITERATOR(pointer, count) (pointer)
#define QT_MAKE_UNCHECKED_ARRAY_ITERATOR(pointer) (pointer)
#endif
