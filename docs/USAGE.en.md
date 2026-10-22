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

A package cannot restore files that were already missing during export. System fonts and cloud or account-specific effects may need to be installed or downloaded again on the destination computer.

## Move presets

WakuShare supports local CapCut **composition presets**. Preset packages use the `.wakupresets` extension; Text_V2 and Adjust are not included in this transfer workflow.

### Export

1. Open **Presets → My presets**. If your library is on another drive, use **Choose library**.
2. Select individual presets or whole folders. The folder arrow opens it; the checkbox selects its contents.
3. Click **Export selected** and save the package. If source files are missing, locate them or deselect the affected presets.

### Import

1. Close CapCut and choose **Presets → Open package**.
2. Select the folders and presets you need, then choose the destination library and folder. Create a subfolder if needed.
3. Run the import check. For confirmed exact duplicates, choose to skip, keep a separate copy, or replace the selected preset.
4. Review the choices and start the import. Replacements keep a backup. If the package contains active effect resources, confirm trust only for a source you know.
5. Open CapCut after completion. Keep the transferred library resources in place.

Font files are collected from explicit, accessible references. WakuShare does not automatically install system fonts. [More about preset transfer](PRESET_TRANSFER.md).

## Set up automatic sync

1. Open **Explorer** and enable **Automatic synchronization**.
2. Choose **All projects** for shared media folders or **This project** for the currently open CapCut project.
3. Click **Add folder**, choose a Windows folder, and confirm the connection.
4. Open the desired project in CapCut. Your folder and its subfolders appear directly at the root of the media library, without an extra WakuShare wrapper folder.
5. Wait for **“Import complete — you can work”**. CapCut itself needs time to process large collections.

After the first import, new files and changes are handled through events. There is no continuous scan every few seconds. Connections under All projects apply to both new and existing projects when you open them.

### Controls and status

| Control                | Purpose                                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------------------- |
| **Show folder**        | Open the source folder in Windows                                                                       |
| **Check now**          | Reconcile the folder immediately and add missing media entries; does not reimport the entire collection |
| **Pencil**             | Rename the connection in WakuShare                                                                      |
| **Disconnect**         | Remove the sync connection from settings; does not delete source files                                  |
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

Real effects can contain Lua/JS and other active resources. Confirming trust allows them to be passed to CapCut; it does not neutralize the code. You can cancel the import. Ordinary media and automatic sync do not require this confirmation. [Protection boundaries](security-audit-2026-10-21.md) (audit report in Russian).

### Will another CapCut version work?

The tested target is CapCut International Windows 9.6.0.4097, x64. Other versions need separate testing. Encrypted JianYing projects are not supported.

### How do I report a problem?

Create an [Issue](https://github.com/WAKUDOdani/WakuShare/issues) with your WakuShare and CapCut versions, the action you took, and the error message. Do not publish private projects, source files, passwords, or your full configuration. For a potential vulnerability, contact the author through [Telegram](https://t.me/WAKUDOdani) first, without posting a malicious package publicly.
