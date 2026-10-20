# Frozen Explorer runtime source

This directory contains the C# planner/worker, the C++ source/header closure for
the 16 accepted product modules, Python helper closure, sealed manifests, reduced
SDK export contract and runtime-file SHA-256 index shipped with WakuShare 1.3.x.
The product entry is `tools/explorer_product_runtime_v6.py`. Some inherited helper
files also contain unused laboratory CLI functions; those are not product routes.
No fixture media, private observation state, session credentials or project
snapshots are included.

Normal application builds reuse the byte-identical runtime release asset pinned
in `../runtime-lock.json`. They do not compile or load native code on the build
machine. CPython, .NET and FFprobe notices and source locations accompany the
runtime archive. Native CapCut/Qt libraries are not distributed.

Native source uses C++17/MSVC and Qt 6.2.2 headers/import libraries. The included
CMakeLists names only the product targets and retains their original defines.
The nlohmann/json 3.10.5 single header retains its embedded MIT license. Its include
directory is relocated from the development workspace to `vendor/`; no source
logic changes are made. The managed projects target .NET 10.

Do not rebuild an accepted generation in place, or replace a DLL loaded by CapCut.
Native development requires a fresh generation/output directory and independent
acceptance of full SDK/bin/tree/Draft preservation and normal saved results.
Rebuilding these sources does not automatically produce an accepted new runtime.
