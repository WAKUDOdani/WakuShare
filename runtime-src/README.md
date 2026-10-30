# Frozen Explorer runtime source

This directory contains the C# planner/worker, the C++ source/header closure for
the 16 accepted product modules, Python helper closure, sealed manifests, reduced
SDK export contract and runtime-file SHA-256 index shipped with WakuShare 1.3.x.
The product entry is `tools/explorer_product_runtime_v6.py`. Some inherited helper
files also contain unused laboratory CLI functions; those are not product routes.
No fixture media, private observation state, session credentials or project
snapshots are included.

Normal application builds verify the base release pinned in `../runtime-lock.json`,
then replace its Python and .NET distributions with the official security updates
pinned in `../runtime-security-lock.json`. `../scripts/runtime-refresh.mjs` builds
and verifies the resulting file index. The accepted worker, native DLLs and Python
helpers remain byte-identical; neither native compilation nor a CapCut attachment
occurs during this step. The index in this source directory describes the base
release. CPython, .NET and FFprobe notices and source locations accompany the
runtime. Native CapCut/Qt libraries are not distributed.

Native source uses C++17/MSVC and Qt 6.2.2 headers/import libraries. The included
CMakeLists retains historical product targets and adds separate generations for
the current scope. Build only the intended new targets in a fresh directory.
The nlohmann/json 3.10.5 single header retains its embedded MIT license. Its include
directory is relocated from the development workspace to `vendor/`; no source
logic changes are made. The managed projects target .NET 10.

Do not rebuild an accepted generation in place, or replace a DLL loaded by CapCut.
Native development requires a fresh generation/output directory and independent
acceptance of full SDK/bin/tree/Draft preservation and normal saved results.
Rebuilding these sources does not automatically produce an accepted new runtime.

The 1.3.12 runtime uses Events/Relay V6, Catalog V9, Commands V12 and SavedRead V4
manifests. Its tree check distinguishes unlinked subtitle/compound registry rows
from ordinary media cards; SDK registry equality remains complete. Read-only Draft
snapshots retain and verify every loaded timeline and select the saved root by its
ID. Identical duplicate source rows are folded only for observations; conflicting
duplicates are rejected. The empty stock service schema is shipped as code rather
than read from a private test fixture. Forest operations use the current product
bridge and validate runtime dependencies before recording dispatch.
