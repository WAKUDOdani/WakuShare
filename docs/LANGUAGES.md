# Interface languages

[Documentation](README.md) · [User guide](USAGE.md)

Choose **Settings > Appearance > Interface language** to switch between **EN · English** and **RU · Русский**. The choice takes effect immediately and is saved for the next launch. Existing settings default to English without changing other preferences.

Translation covers navigation, project dialogs, preset transfer and duplicate review, progress, application warnings and errors, update status, and application-owned file dialog titles and filters. Dates, size units and accessibility labels follow the selection. Native operating system controls and low-level diagnostics from external libraries may follow the system language or remain in English.

Project names, preset names, folder names, source filenames and paths are preserved. Changing the interface language does not change a project, preset library, archive or media reference.

English product copy is the source key. Russian copy is stored in `src/shared/locales/ru.json` and `ru-errors.json`. Keep interpolation fields intact. Translate product text before inserting user data; do not translate user names or paths on their own. Core archive contents remain independent of the interface language.

Settings migration, persistence and failed writes are covered by automated tests. The local preview workflow also checks both languages, project and preset dialogs, duplicate review, and action spacing at the minimum supported window width.
