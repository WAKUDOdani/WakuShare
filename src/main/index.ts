import { app, BrowserWindow } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import log from 'electron-log/main'
import { createMainWindow } from './window'
import { registerIpcHandlers, notifyOpenFile, hasActiveFileTasks } from './ipc'
import { setupUpdater } from './updater'
import { buildAppMenu } from './menu'
import { isLocalPreview } from '../shared/build'
import { prepareAppProfile } from './profile'

const profile = prepareAppProfile(app.getPath('appData'), isLocalPreview(), app.getVersion())
app.setName(profile.name)
app.setPath('userData', profile.directory)
log.initialize()
log.transports.file.level = 'info'

let mainWindow: BrowserWindow | null = null

/**
 * A .capshare file the OS asked us to open before the renderer was ready.
 * Flushed when the renderer signals readiness (see 'app:renderer-ready' in ipc.ts).
 */
let pendingOpenFile: string | null = null

function extractCapshareArg(argv: string[]): string | null {
  // Windows/Linux: the opened file arrives as a plain argv entry.
  const candidate = argv.find((arg) => arg.toLowerCase().endsWith('.capshare'))
  return candidate ?? null
}

function handleOpenFile(filePath: string): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
    notifyOpenFile(mainWindow, filePath)
  } else {
    pendingOpenFile = filePath
  }
}

const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    const file = extractCapshareArg(argv)
    if (file) handleOpenFile(file)
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  // macOS: must be registered before 'ready' to catch cold-start double-clicks.
  app.on('will-finish-launching', () => {
    app.on('open-file', (event, filePath) => {
      event.preventDefault()
      handleOpenFile(filePath)
    })
  })

  app.whenReady().then(() => {
    electronApp.setAppUserModelId(profile.appId)

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    let refreshMenu = (): void => {}
    registerIpcHandlers({
      onLanguageChanged: () => refreshMenu(),
      getMainWindow: () => mainWindow,
      consumePendingOpenFile: () => {
        const file = pendingOpenFile
        pendingOpenFile = null
        return file
      }
    })

    const startupFile = extractCapshareArg(process.argv.slice(1))
    if (startupFile) pendingOpenFile = startupFile

    mainWindow = createMainWindow()

    const updater = setupUpdater({ getMainWindow: () => mainWindow, isBusy: hasActiveFileTasks })
    refreshMenu = () => buildAppMenu({ updater })
    refreshMenu()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createMainWindow()
      }
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })
}
