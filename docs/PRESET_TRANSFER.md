# Preset transfer

[Documentation](README.md) · [User guide](USAGE.md#перенести-пресеты)

Available in WakuShare 1.2.0, validated against Windows CapCut 9.6.0.4097.

## Scope

The Presets page transfers locally saved **composition presets**. It reads CapCut's configured `customPresetPath`, including libraries on another drive. The package extension is `.wakupresets`.

- Select all presets, multiple folders, or individual presets inside folders.
- Selected folders include their contents. Selecting an individual preset retains its parent folders without including its siblings.
- Open a package and choose which presets or folders to import.
- Choose the library root or any existing destination folder, with an optional new subfolder such as `Foreign presets`.
- Merge equal folder names recursively within that destination, or request separate folder copies. Ambiguous existing folder names are not guessed.
- Review the import before writing. Presets without confirmed duplicate decisions are added as copies with new identifiers and available names.
- Full duplicates of existing presets offer skip, separate copy, or replacement of a specific match. Skip is the initial choice. Matching compares contents and referenced resource hashes, allowing for relocated paths, generated IDs, and preset display names; different text or media remains different.
- Replacement keeps the existing preset's name, identifier and folder location. It backs up the existing preset files and catalog before swapping folders. Existing resource folders are retained. Failure or cancellation rolls back the swap; failed automatic recovery retains its recovery files rather than deleting them.
- Loose media and explicitly referenced font files are collected in `Исходники`. Independent files with the same name receive distinct names, preserving their extensions and references. A shared source file is copied once.
- CapCut-managed directory resources retain their internal layout. Supporting documents and effect caches are stored separately.
- Dependencies in embedded JSON, external composition documents, and working template mirrors are inspected and remapped.

Other preset formats, including Text_V2 and Adjust, are not supported yet. The page warns if such a category contains files. Empty categories do not generate warnings.

## Source files and import

Missing dependencies stop export before an archive is published. The page lists the missing paths and affected presets. A user can locate a replacement file or resource folder and retry, or deselect the affected presets. Files are never matched by name alone. The source preset library is not rewritten.

Close CapCut before importing presets. The page displays its running state, and the main process checks again at the start and before committing changes. An unsuccessful process query blocks import. The Launch CapCut button is available after the operation. CapCut is not launched automatically.

The application saves an existing destination catalog under WakuShare's `preset-backups` directory. Replaced preset files are backed up beside it in `preset-files-<operation-id>`. A concurrent catalog change or a stale import review aborts the operation. Existing presets that cannot be fully inspected are listed as uncomparable and are never proposed as verified replacement targets. Skipped preset files are verified without being extracted to disk.

For imported loose sources, use **Show source files** in the result. They live under the configured library's `Combination/Resources/WakuShare/<import-id>/Исходники` directory. Keep this directory with the library.

Archive files are verified against their recorded size and SHA-256 before registration. Cancellation and source changes abort the operation. Native preset path placeholders are resolved when re-exporting a library saved by CapCut. Older packages with an exact local placeholder cover can also be imported; unresolved legacy resources require re-export. These checks do not replace checking the imported presets in CapCut.

## System font audit

Project transfer already copies existing font files when a project explicitly references their paths, including references inside serialized text styles. The examined project package contains Onest Bold, Onest Black, and CapCut's bundled en.ttf, with relocated references.

There is no font-family lookup or automatic Windows font installation. A family name without a usable font-file path is not enough to collect a font. Appearance on another computer without that font installed still needs a real CapCut check. The preset transfer uses the same explicit-file approach; it does not change the operating system's font store.

## Package trust

Since WakuShare 1.3.4, active effect resources require explicit trust for the current import operation, with Cancel as the default. Executables, libraries, shortcuts and system scripts remain blocked even after confirmation; selected file contents are checked in the existing transfer stream. Approval allows effect code to reach CapCut and does not certify that code as safe. Ordinary media transfers do not require a new trust dialog. See the [security audit](security-audit-2026-10-21.md).

## Validation history

Automated tests cover folder selection, independent same-named sources, shared resources, font files, external subdraft dependencies, template mirrors, copy collisions, explicit missing-source replacement, hash failures, cancellation, and concurrent source or destination changes.

A read-only check of the available user library restored 11 presets and two folders into a separate test library. It verified 989 packaged files and 211 restored absolute references, with no remaining old paths in the inspected documents. Five other presets already reference missing source media or effect caches; full-library export correctly refuses to hide those missing dependencies.

Folder import, restored media and covers, destination selection, folder merging and duplicate decisions were accepted in CapCut during local testing. The original 1.2.0 preset-transfer stage passed 122 automated tests and renderer interaction checks; one existing opt-in live E2E test was skipped. Workspace-only import/copy/skip/replace checks used actual preset data without changing the source library. Existing imported native copies were also identified as full duplicates. Local Preview builds retain a separate profile and disabled updates; the normal installed build uses the WakuShare release feed.
