# Changes

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
