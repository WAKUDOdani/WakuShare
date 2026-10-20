# Changes

## 1.3.1

- Use neutral frosted-glass hover feedback instead of purple frames. Keep primary buttons bright on hover in the dark theme and preserve contrast in both themes.
- Remove full-row highlighting when hovering a preset checkbox; keep feedback on the actual folder button.
- Distinguish current preset breadcrumbs from navigation and make selection actions quieter, disabling redundant select-all/clear operations.

## 1.3.0

- Add Explorer: event-driven folder synchronization into existing and new CapCut projects, preserving nested folders and material identity.
- Import a folder in one batch and show acknowledged progress; retain completed status during background checks.
- Export project bundles as `.wakushare`; continue importing legacy `.capshare` bundles.
- Show the current version below the wordmark, improve translucent button feedback and align preset folders, checkboxes and toolbars.
- Bundle the accepted synchronization worker and runtimes. This local build has not been published to GitHub.

## 1.2.0

- Transfer CapCut composition presets as `.wakupresets` packages, with folder and individual selection.
- Collect referenced media and font files in `Исходники`, preserving links and handling equal filenames.
- Choose an import folder, merge matching folders and review full duplicates before copying, skipping or replacing them.
- Back up replaced presets and check that CapCut is closed before importing. Launch CapCut from the result screen.
- Switch the full interface between English and Russian in Settings.
- Refresh the app icon, gradient wordmark, dropdown styling and dialog layout.
- Show an optional Telegram invitation on each launch, with a permanent Don't show again checkbox.

Tested with CapCut International Windows 9.6.0.4097. Only composition presets are supported. Font files are collected when explicitly referenced; system fonts are not installed automatically.

## 1.1.2

- In portable Windows builds, Check for updates opens the latest WakuShare release page.
- Show a normal portable-update explanation instead of an unsupported-updater error.
- Open the browser only on request; installed Windows updates keep their existing behavior.

## 1.1.1

- Remove the Settings subtitle and start its scroll area below the fixed header.
- Update author display to WAKUDO Dani throughout the application and attribution.
- Keep the installed version number visible while checking updates or reporting an error.
- Explain GitHub's empty release feed with a short message instead of raw parse errors.

## 1.1.0 — initial WakuShare release

- Based on CapShare 1.0.2 by Ilyasse Salama (MIT); original history retained.
- Consistent multi-timeline cloning, including manifests, layouts and nested documents.
- Collect media referenced outside the first timeline; organize sources in one folder.
- Verify package integrity and local media links before registering an import.
- Detect saved-project changes during export and preserve the previous archive on failure.
- Keep export warnings visible; include project caches by default.
- Independent WakuShare identity, attribution and Telegram link.
- Windows NSIS updates from WAKUDOdani/WakuShare only; manual installation after file tasks.
- Target tested in this release: CapCut International Windows 9.6.0.4097.

Limitations: no missing-media replacement picker; portable does not self-update;
other CapCut versions and a real installed-version update cycle require separate validation.
