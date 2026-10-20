import { app, BrowserWindow, powerMonitor } from 'electron'
import { createExplorerSupervisor, registerExplorerIpc } from './sync/ipc'
import { ExplorerTray } from './sync/tray'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import log from 'electron-log/main'
import { createMainWindow } from './window'
import { registerIpcHandlers, notifyOpenFile, hasActiveFileTasks } from './ipc'
import { setupUpdater } from './updater'
import { buildAppMenu } from './menu'
import { isLocalPreview } from '../shared/build'
import { prepareAppProfile } from './profile'
import { getSettings } from './settings'
import { join } from 'node:path'
import { explorerPreviewWorkspace } from './sync/runtime'
import { isProjectPackage } from '../shared/project-package'

const previewWorkspace = explorerPreviewWorkspace()
const profile = prepareAppProfile(
  previewWorkspace
    ? join(previewWorkspace, 'artifacts', 'ExplorerPreviewProfiles')
    : app.getPath('appData'),
  isLocalPreview(),
  app.getVersion()
)
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
  const candidate = argv.find(isProjectPackage)
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
    const explorer = createExplorerSupervisor()
    registerExplorerIpc(() => mainWindow, explorer)
    const tray =
      process.platform === 'win32'
        ? new ExplorerTray({
            supervisor: explorer,
            getWindow: () => mainWindow,
            language: () => getSettings().language,
            quit: () => app.quit(),
            warn: (message) => log.warn(message)
          })
        : null
    let quitting = false
    const bindClose = (window: BrowserWindow): void => {
      window.on('close', (event) => {
        if (!quitting && tray?.shouldHideOnClose()) {
          event.preventDefault()
          window.hide()
        }
      })
    }
    bindClose(mainWindow)
    void explorer.initialize().catch(() => log.warn('Explorer settings could not be initialized.'))
    powerMonitor.on('resume', () => {
      void explorer.resume().catch(() => log.warn('Explorer could not resume.'))
    })
    let shutdown: Promise<void> | null = null
    let shutdownComplete = false
    const prepareExit = (): Promise<void> => {
      if (!shutdown) {
        quitting = true
        tray?.dispose()
        shutdown = explorer
          .close()
          .catch(() => log.warn('Explorer could not finish shutdown cleanly.'))
          .then(() => {
            shutdownComplete = true
          })
      }
      return shutdown
    }
    app.on('before-quit', (event) => {
      if (shutdownComplete) return
      event.preventDefault()
      void prepareExit().then(() => app.quit())
    })

    const updater = setupUpdater({
      getMainWindow: () => mainWindow,
      isBusy: hasActiveFileTasks,
      beforeInstall: prepareExit
    })
    refreshMenu = () => {
      buildAppMenu({ updater })
      tray?.refreshLanguage()
    }
    refreshMenu()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createMainWindow()
        bindClose(mainWindow)
      }
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })
}
