# Explorer integration

[Documentation](README.md) · [User guide](USAGE.md#настроить-автосинхронизацию)

Explorer synchronizes Windows media folders with the currently open CapCut
International project. The 1.3.31 live acceptance target is 9.7.1.4203 on Windows 11. Global sources apply to existing and new projects;
project sources remain scoped to a confirmed ProjectKey. Common sources cannot
be excluded by a per-project override. Nested
folders appear directly under the media-library root.

Electron main owns one persistent worker and the system tray. Renderer navigation
only removes subscribers. Closing the app hides it only after the tray is ready; explicit
Quit and update installation await shutdown. Disabling Explorer releases watches.
Filesystem and editor events trigger reconciliation; idle polling is not used.

The project-folder browser reads bounded metadata and thumbnails, without parsing
timelines or writing CapCut data. It accepts catalog keys rather than renderer-provided
project identities or locations. Additional folders can be configured while a project
is closed or sync is disabled. Applying a set preserves stable attachment IDs and
changes only additional connections. The settings selection is independent of the
open editor project; changing it does not dispatch imports. Native bindings are
acknowledged per editor generation and effective binding payload, so configuring
another project does not rebind an unchanged active project.

The worker client launches a fixed executable without a shell, using UTF-8 JSON
Lines, unique request IDs, strict schema/sequence validation and bounded messages
and deadlines. The renderer receives presentation snapshots, never bootstrap
credentials or arbitrary execution capabilities.

Ordinary Windows builds use resources/explorer, including AdaptiveWorkerV3,
AdaptiveObserveV10/AdaptiveCommandsV10 and adaptive saved-read/root-relink modules, product DLLs and interpreters. Main sets
the private PATH and DOTNET_ROOT. Native staging uses userData/explorer/native-modules.
A product DLL already loaded from an earlier app location is reused only when
its unique name and loaded/staged file hashes agree with the sealed generation.

Portable launches extract into separate NSIS plugin directories. A secondary
launch that forwards to the existing Electron instance cleans up only its own
extraction; it cannot delete the active instance's runtime. The Windows afterPack
guard and package verifier require this setting. A real NSIS-template lifecycle
control reproduces the shared-directory failure and verifies isolation with an
inert host, without launching the application or accessing CapCut.

Base build inputs are pinned by runtime-lock.json and the complete runtime-file index.
scripts/build-windows.mjs retrieves and verifies them; runtime-security-lock.json
and scripts/runtime-refresh.mjs then pin and verify the refreshed Python/.NET
distributions and final file index. Refresh happens at build time and preserves
accepted worker/helper/native bytes; it never rebuilds loaded modules. Current source is in runtime-adaptive/; runtime-src/ is a frozen reference. The reduced SDK contract has no private data.

Configuration uses optimistic revisions and stable source IDs. Project identity
combines draft UUID and canonical location. Native callbacks recheck process,
session token, view epoch, same-installation CapCut process identity, discovered interfaces, complete SDK/bin/tree/Draft and
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

Connection editing offers two distinct operations. Replacing a folder creates an
independent source and destination; detaching keeps the previous ownership history,
Windows files, CapCut media and clips. Explicitly relocating the same folder retains
source, attachment, material and clip identities. All matching connections receive
a durable previous-root chain. Each enabled project repairs its paths under its own
live lease when opened; paused connections wait until re-enabled. Closed project
files are never rewritten behind the editor.

Root repair requires the same relative paths and byte contents. Streaming hashes
run in the helper process under Windows read leases, permitting a physical identity
change when the user explicitly moves the folder across drives. A single native
batch validates the complete bin alias set and all loaded SDK Drafts, changes only
owned source paths, preserves manual names, and requests stock saves. Whole-project
and template comparisons repeat after normal save. Conflicts stop the operation;
uncertain mutations are never replayed. Completed add/update/folder receipts remain
immutable, and only verified root history permits their old roots. State schema 10
prevents older workers from interpreting this history. Ordinary sync/import does
not take the root-relocation hashing or save-verification path.

## Adaptive interfaces (1.3.31)

Marketing version numbers are diagnostic, not an allowlist. Offline PE discovery uses independent landmarks and named exports; guarded loaded-image proofs are checked before calls. The current adapter requires Qt ABI 6.2.2. Capability groups independently gate connection, read, add, folders, rename, move, remove and restore. Structured helper errors retain operation, code and detail through the worker to the renderer. Missing interfaces stop dependent commands before dispatch; this is not a guarantee for arbitrary future private API changes.

Unknown completion is never replayed. Delivered import recovery requires conclusive receipts, source identity/hash and full immediate/saved-state verification and issues no new data commands. Optional library refresh failure remains a separate persisted warning after data verification, without retrying an uncertain view command. Multi-timeline updates select the saved timeline UUID and verify preservation of other Drafts; shared sources are refused when independent ownership cannot be proved. See [adaptive source and build notes](../runtime-adaptive/README.md).
