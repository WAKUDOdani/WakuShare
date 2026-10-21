# Welcome window

[Documentation](README.md) · [User guide](USAGE.md)

The welcome window uses the app's existing glass surfaces, dialog animation, brand icon, and wordmark. It supports English and Russian, light and dark themes, keyboard dismissal, reduced motion, and reduced transparency.

It appears on every application launch after settings and the running version have loaded, unless permanently disabled. The invitation is the same on normal starts and after updates: Let's stay in touch, followed by the Telegram paragraph and actions. There is no introductory greeting or author biography. The Telegram button opens https://t.me/WAKUDOdani only after an explicit click and closes the window for the current session. Continue, the close button, Escape, and clicking the backdrop also close it for the current session without opening a link. Navigation and returning focus do not reopen it in that session.

The panel is 480 px wide with one 28 px outer inset. A separate static glass card contains the invitation heading (15 px, semibold) and body copy (14 px, relaxed line height), with 16 px inner padding and an 8 px title-to-copy gap. The card starts 24 px below the brand row, and the actions start 24 px below the card. Section margins do not double the outer padding. The primary action is 44 px high, followed by a 12 px gap before the secondary controls. The opt-out checkbox has a 6 px label gap. There is no carousel, slide indicator, or release-summary page.

## Persistence

- `welcomeSeenVersion` defaults to `null`. The last acknowledged version is retained for compatibility and no longer decides whether to display the window.
- `welcomeHidden` defaults to `false`. Don't show again is a checkbox. Selecting it and then closing the window with Continue, the close button, Escape, the backdrop, or the Telegram action saves `true`. This suppresses all later launches and version changes. Selecting the checkbox alone does not close the window. Existing permanent opt-outs are respected.
- Both fields are saved atomically in the normal `settings.json`, outside installed application binaries. Existing settings gain the defaults while preserving language, theme, and folder preferences. The normal installed and portable builds use the existing main profile. Versioned Preview profiles stay separate.
- A failed write leaves the window open and shows an error so the user can retry. The UI never claims an opt-out was saved after a failed write.

## Validation

`tests/settings.test.ts` checks migration, atomic persistence, concurrent writes, and write failure/retry. Maintainer-side renderer fixtures check first launch, reappearance on same-version restart, staying closed during navigation, later versions, the opt-out checkbox followed by Continue and its persistence on all later launches, save failure/retry, explicit Telegram opening, aligned button boundaries, English/Russian, both themes, and layout at 860×620. It runs in a fresh headless browser with a mocked bridge and never changes a real library or user profile.

The window is a friendly optional introduction. It does not check Telegram subscription status or restrict application features.

The maintainer fixtures mentioned here are not distributed as a public `tools/` directory; public CI uses the tests committed under `tests/`.
