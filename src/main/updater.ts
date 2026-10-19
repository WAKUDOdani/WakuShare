import { app, ipcMain, shell, type BrowserWindow } from 'electron'
import log from 'electron-log/main'
import electronUpdater from 'electron-updater'
import { IPC } from '../shared/channels'
import type { UpdateStatus } from '../shared/types'
import { BRAND, UPDATE_FEED } from '../shared/branding'
import { isLocalPreview } from '../shared/build'

interface UpdaterContext {
  getMainWindow: () => BrowserWindow | null
  isBusy: () => boolean
}
export interface UpdaterController {
  checkInteractive: () => Promise<void>
}

/** Windows installed builds use only WakuShare's public GitHub Releases. */
export function setupUpdater(ctx: UpdaterContext): UpdaterController {
  let status: UpdateStatus = { state: 'idle' }
  const portable =
    app.isPackaged &&
    process.platform === 'win32' &&
    Boolean(process.env['PORTABLE_EXECUTABLE_FILE'] || process.env['PORTABLE_EXECUTABLE_DIR'])
  const installed =
    !isLocalPreview() &&
    app.isPackaged &&
    process.platform === 'win32' &&
    !process.env['PORTABLE_EXECUTABLE_FILE'] &&
    !process.env['PORTABLE_EXECUTABLE_DIR']
  const updater = installed ? new electronUpdater.NsisUpdater(UPDATE_FEED) : null
  let checking: Promise<UpdateStatus> | null = null
  const send = (next: UpdateStatus): void => {
    status = next
    const win = ctx.getMainWindow()
    if (win && !win.isDestroyed()) win.webContents.send(IPC.updateStatus, status)
  }
  const errorStatus = (error: unknown): void => {
    const message = error instanceof Error ? error.message : String(error)
    log.warn('[updater]', message)
    send({
      state: 'error',
      message:
        /404|NO_PUBLISHED_VERSIONS|NO_LATEST_VERSION|Unable to find latest version on GitHub/i.test(
          message
        )
          ? 'No published WakuShare update is available yet. Try again later.'
          : message
    })
  }
  const check = (): Promise<UpdateStatus> => {
    if (isLocalPreview()) {
      send({ state: 'manual', message: 'Local preview. Updates are disabled in this build.' })
      return Promise.resolve(status)
    }
    if (portable) {
      return (async () => {
        try {
          await shell.openExternal(`${BRAND.repository}/releases/latest`)
          send({
            state: 'manual',
            message: 'Release page opened. Download the latest portable .exe to update.'
          })
        } catch (error) {
          errorStatus(error)
        }
        return status
      })()
    }
    if (!updater) {
      send({
        state: 'error',
        message: 'Automatic updates require the installed Windows version.'
      })
      return Promise.resolve(status)
    }
    if (checking) return checking
    checking = (async () => {
      try {
        await updater.checkForUpdates()
      } catch (error) {
        errorStatus(error)
      }
      return status
    })().finally(() => {
      checking = null
    })
    return checking
  }

  if (updater) {
    updater.logger = log
    updater.allowPrerelease = false
    updater.allowDowngrade = false
    updater.autoDownload = true
    // Installation always requires an explicit user action, after file tasks end.
    updater.autoInstallOnAppQuit = false
    updater.on('checking-for-update', () => send({ state: 'checking' }))
    updater.on('update-available', (info) => send({ state: 'available', version: info.version }))
    updater.on('update-not-available', () => send({ state: 'not-available' }))
    updater.on('download-progress', (info) =>
      send({ state: 'downloading', percent: Math.round(info.percent) })
    )
    updater.on('update-downloaded', (info) => send({ state: 'downloaded', version: info.version }))
    updater.on('error', errorStatus)
  }
  ipcMain.handle(IPC.getAppVersion, () => app.getVersion())
  ipcMain.handle(IPC.updateGetStatus, () => status)
  ipcMain.handle(IPC.updateCheck, check)
  ipcMain.handle(IPC.updateInstall, () => {
    if (!updater || status.state !== 'downloaded') return
    if (ctx.isBusy()) {
      const win = ctx.getMainWindow()
      if (win && !win.isDestroyed())
        win.webContents.send(IPC.updateStatus, {
          state: 'error',
          message: 'Finish the current export or import, then check for updates to restart.'
        } satisfies UpdateStatus)
      return
    }
    updater.quitAndInstall(false, true)
  })
  if (updater) void check()
  else if (isLocalPreview())
    send({ state: 'manual', message: 'Local preview. Updates are disabled in this build.' })
  else if (portable)
    send({
      state: 'manual',
      message: 'Portable build. Check for updates opens the latest release on GitHub.'
    })
  return {
    checkInteractive: async () => {
      await check()
    }
  }
}
