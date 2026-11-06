<p><a href="USAGE.md">Русский</a> / <strong>English</strong></p>

# Using WakuShare

[← Home](../README.en.md) · [Download](https://github.com/WAKUDOdani/WakuShare/releases/latest)

WakuShare runs on Windows x64. The tested editor version is CapCut International 9.6.0.4097. Both the installed and Portable editions start in Russian on first launch. Change the app language in **Settings → Appearance → Interface language**; your saved choice is preserved across launches and updates.

## Move a project

1. On the source computer, open **Projects** and select a CapCut project.
2. Export it. Keep cache transfer enabled for the most complete package. If the app reports missing resources, review the warnings first.
3. Send the resulting `.wakushare` file to the other computer. Older `.capshare` packages are also supported.
4. In WakuShare, select **Import**, then drag in the package or choose it through the file dialog. If a project with that name already exists, use a separate copy for your first check.
5. Wait for completion and open the project in CapCut. If it is missing from CapCut's project list, restart the editor.

Multiple timelines and nested compositions are preserved. Original source files stay in place: the imported copy stores them under `Resources/local/Исходники` and updates references to the new files. Independent sources with identical filenames are not merged.

The complete media library retains its root files, folders, hierarchy, record order, manual names and clip references. No wrapper folder is added. Media not used on any timeline is included too.

Export preserves every timeline and nested composition, including unused media-library compositions. Machine-local proxy history is excluded. The source project is unchanged. Detached `subdraft` leftovers with no references from any timeline or media-library record are excluded; unused compositions still listed in the library are preserved. To transfer the complete library from an older project, export a new package with this version: an older archive may contain only timeline dependencies.

For projects with many tracks, scroll the properties and track overview inside the project dialog. Cache options and export controls stay at the bottom of the dialog, including in a small app window.

A package cannot restore files that were already missing during export. Their library entries and clips remain as missing media, with a warning; no substitute files are created. System fonts and cloud or account-specific effects may need to be installed or downloaded again on the destination computer.

## Move presets

WakuShare supports local CapCut **composition presets**. Preset packages use the `.wakupresets` extension; Text_V2 and Adjust are not included in this transfer workflow.

### Export

1. Open **Presets → My presets**. If your library is on another drive, use **Choose library**.
2. Select individual presets or whole folders. The folder arrow opens it; the checkbox selects its contents.
3. Click **Export selected** and save the package. If source files are missing, locate them or deselect the affected presets.

### Import

Double-click a `.wakupresets` package in Windows Explorer to open its contents in WakuShare's Presets view. The installer registers the file type and icon; for Portable, select WakuShare using **Open with**. Opening a package does not start importing it automatically.

1. Close CapCut and choose **Presets → Open package**.
2. Select the folders and presets you need, then choose the destination library and folder. Create a subfolder if needed.
3. Run the import check. For confirmed exact duplicates, choose to skip, keep a separate copy, or replace the selected preset.
4. Review the choices and start the import. Replacements keep a backup. If the package contains active effect resources, confirm trust only for a source you know.
5. Open CapCut after completion. Keep the transferred library resources in place.

Font files are collected from explicit, accessible references. WakuShare does not automatically install system fonts. [More about preset transfer](PRESET_TRANSFER.md).

## Set up automatic sync

1. Open **Explorer** and enable **Automatic synchronization**.
2. Add shared media folders under **Common folders**. Enabled common folders apply to every project, regardless of the selected tab.
3. Click **Add folder** and choose a Windows folder. It connects immediately after selection; use the pencil button to rename the connection later.
4. Open the desired project in CapCut. Your folder and its subfolders appear directly at the root of the media library, without an extra WakuShare wrapper folder.
5. Wait for **“Import complete — you can work”**. CapCut itself needs time to process large collections.

After the first import, new files and changes are handled through events. There is no continuous scan every few seconds. Common folder connections apply to both new and existing projects when you open them.

Under **By project**, select a project from the compact list and connect additional folders for that client. You can configure a project before opening it in CapCut; synchronization starts when you open it. Common folders are shown separately and cannot be disabled for individual projects. **Apply set** copies the selected additional folder set to multiple projects, replacing their previous additional selection while keeping imported media and timeline clips. Folder settings are also available with synchronization turned off. Switching tabs or selecting a project in this list does not start an import.

Use the pencil to edit a connection. When changing its path, choose **Connect a different folder** for an independent media set, or **The same folder has moved** to repair existing clips. Relocation requires matching relative paths and file contents; the old folder may already be missing. This verification is separate from normal synchronization. Paths are repaired in the open project and in other connected projects when opened. Enable a paused connection first. Import history is retained, so previously imported materials do not need to be added again.

### Controls and status

| Control                | Purpose                                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------------------- |
| **Show folder**        | Open the source folder in Windows                                                                       |
| **Check now**          | Reconcile the folder immediately and add missing media entries; does not reimport the entire collection |
| **Pencil**             | Change its label or path; connect a different folder or repair paths after relocating the same folder   |
| **Trash**              | Remove the connection; source files, media-library folders, and timeline clips are kept                 |
| **Folder toggle**      | Pause or resume syncing that folder                                                                     |
| **Waiting for CapCut** | Open the desired project or restore access to source folders; confirmed progress is kept                |

If the result of a previous operation cannot be confirmed, the app will not blindly repeat it. Do not delete internal state to force another import. If an operation stops, save the message and report the problem.

### Rename, move, and delete

- For a file used on the timeline, first leave the project for CapCut's home screen: the editor may lock it. Rename or move the file in Windows, then reopen the project.
- Renames and moves preserve the media's identity. Copying creates an independent source.
- A name set manually inside CapCut does not rename the Windows file and is preserved independently.
- If a source used on the timeline is deleted from disk, CapCut handles the remaining clip as missing media. WakuShare does not replace it with a placeholder.
- Deleting media in CapCut can also delete its associated timeline clips. If the source still exists on disk, the next reconciliation restores only the media library entry, never the deleted clips.

## Closing the app and updating

With sync enabled, closing WakuShare's window keeps it running in the system tray. To exit completely, use the quit command in its tray menu near the clock.

**Installed edition:** checks stable releases from this repository, downloads the update, and offers a restart. Start installation after file operations finish.

**Portable:** checking for updates opens the [latest release page](https://github.com/WAKUDOdani/WakuShare/releases/latest). Download the new Portable EXE, fully quit the previous WakuShare through the tray, and use the new file. Portable means no installation; it does not mean that all settings are stored next to the EXE. Regular builds use the WakuShare profile.

## Frequently asked questions

### Which asset should I download?

For a regular installation, choose `WakuShare-<version>-setup-x64.exe`. To run without installing, choose `WakuShare-<version>-portable-x64.exe`. You only need one of them. `Source code` is for developers; `latest.yml` and `.blockmap` serve the updater. The runtime is already included in the app.

### Windows shows a publisher warning

Builds do not yet have a publisher signature. Download only from the [official WakuShare releases](https://github.com/WAKUDOdani/WakuShare/releases). Checksums are published in `SHA256SUMS.txt`; a matching hash verifies the file's bytes, but is not a publisher signature.

### Why do effect packages need a trust confirmation?

The prompt applies to new or changed effect resources that may contain Lua/JS, shaders or opaque configurations. Resources whose contents match files already present in the local CapCut cache do not require another prompt. Ordinary media and unselected presets do not trigger it. You can cancel imports of new resources; confirming trust does not neutralize code. Path, executable and integrity checks remain enabled for every package. [Protection boundaries](security-audit-2026-10-21.md) (audit report in Russian).

### Will another CapCut version work?

The tested target is CapCut International Windows 9.6.0.4097, x64. Other versions need separate testing. Encrypted JianYing projects are not supported.

### How do I report a problem?

Create an [Issue](https://github.com/WAKUDOdani/WakuShare/issues) with your WakuShare and CapCut versions, the action you took, and the error message. Do not publish private projects, source files, passwords, or your full configuration. For a potential vulnerability, contact the author through [Telegram](https://t.me/WAKUDOdani) first, without posting a malicious package publicly.

## Import and export details

If a project already exists, Replace or Import as copy choices appear in the same project card. Replacing keeps a backup of the previous project. When opening CapCut, wait for the button to report the result; repeated clicks are unnecessary. If the editor does not appear, the app reports it; a hidden running process is not terminated automatically.

Missing generated covers do not require source-media repair. Warnings about unavailable video, audio, images, or fonts remain significant: check the listed paths before transferring to another computer. Export an older project again to use the corrected handling; an existing package is not changed automatically.

Preset export carries native configs, templates and sidecar files within the library together with their dependencies. If an unsupported external-file error appears, check its reported path: arbitrary external JSON/TXT and executable files are not permitted. Existing packages can still be opened; create a new export to use the corrected re-export handling.
