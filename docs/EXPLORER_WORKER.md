# Explorer integration

[Documentation](README.md) · [User guide](USAGE.md#настроить-автосинхронизацию)

Explorer synchronizes Windows media folders with the currently open CapCut
International 9.6.0.4097 project. Global sources apply to existing and new projects;
project sources and overrides remain scoped to a confirmed ProjectKey. Nested
folders appear directly under the media-library root.

Electron main owns one persistent worker and the system tray. Renderer navigation
only removes subscribers. Closing an enabled app hides it in the tray; explicit
Quit and update installation await shutdown. Disabling Explorer releases watches.
Filesystem and editor events trigger reconciliation; idle polling is not used.

The worker client launches a fixed executable without a shell, using UTF-8 JSON
Lines, unique request IDs, strict schema/sequence validation and bounded messages
and deadlines. The renderer receives presentation snapshots, never bootstrap
credentials or arbitrary execution capabilities.

Ordinary Windows builds use resources/explorer, including frozen WorkerV8,
ObserveV6/CommandsV10/CatalogV6/SavedReadV2, product DLLs and interpreters. Main sets
the private PATH and DOTNET_ROOT. Native staging uses userData/explorer/native-modules.
A product DLL already loaded from an earlier app location is reused only when
its unique name and loaded/staged file hashes agree with the sealed generation.

Base build inputs are pinned by runtime-lock.json and the complete runtime-file index.
scripts/build-windows.mjs retrieves and verifies them; runtime-security-lock.json
and scripts/runtime-refresh.mjs then pin and verify the refreshed Python/.NET
distributions and final file index. Refresh happens at build time and preserves
accepted worker/helper/native bytes; it never rebuilds loaded modules. Source is in runtime-src/. The reduced SDK contract has no private data.

Configuration uses optimistic revisions and stable source IDs. Project identity
combines draft UUID and canonical location. Native callbacks recheck process,
session token, view epoch, exact CapCut build, complete SDK/bin/tree/Draft and
source identity. Unknown completion is retained and never replayed. Only receipts
proving zero dispatch allow bounded deferral. Updates precede additions, including
moves between selected roots. Planned UUIDs are not proof of ownership.

Private state under userData/explorer includes ownership, native receipts and
project-scoped observations. Preserve all project-observations/, including its
migration marker, when transferring a profile. Never reset receipts or infer
ownership from a reused path, filename or content hash. Manual material names
in CapCut are preserved independently from Windows filenames.

Whole-root import sends one list, then verifies placement and saved state.
Progress comes from durable acknowledgements; checks do not flash a completed
bar. Check now performs explicit reconciliation/content audit and queues missing
cards without duplicating completed materials or bypassing guards. Missing used
sources remain CapCut's missing media; deleted timeline clips are not restored.

Normal tests cover protocol, configuration, lifecycle, scope, progress, archive
compatibility and preset transfers without accessing CapCut. Native integrations
are opt-in and must not replay accepted jobs. New runtime generations require
independent full preservation and normal-save acceptance.
