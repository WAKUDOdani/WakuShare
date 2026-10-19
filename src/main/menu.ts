import { app, Menu, type MenuItemConstructorOptions } from 'electron'
import type { UpdaterController } from './updater'
import { getSettings } from './settings'
import { translateText } from '../shared/i18n'

interface MenuContext {
  updater: UpdaterController
}

/**
 * Installs the macOS application menu with a "Check for Updates…" item under the
 * app name, next to About. Other platforms keep Electron's default menu — the
 * Settings → About row covers update checks there.
 */
export function buildAppMenu(ctx: MenuContext): void {
  if (process.platform !== 'darwin') return
  const t = (text: string): string => translateText(text, getSettings().language)

  app.setAboutPanelOptions({
    applicationName: app.name,
    applicationVersion: app.getVersion(),
    copyright: `© ${new Date().getFullYear()} WAKUDO Dani. Based on CapShare by Ilyasse Salama (MIT).`
  })

  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about', label: t('About WakuShare') },
        { label: t('Check for Updates…'), click: () => void ctx.updater.checkInteractive() },
        { type: 'separator' },
        { role: 'services', label: t('Services') },
        { type: 'separator' },
        { role: 'hide', label: t('Hide') },
        { role: 'hideOthers', label: t('Hide Others') },
        { role: 'unhide', label: t('Show All') },
        { type: 'separator' },
        { role: 'quit', label: t('Quit') }
      ]
    },
    {
      label: t('Edit'),
      submenu: [
        { role: 'undo', label: t('Undo') },
        { role: 'redo', label: t('Redo') },
        { type: 'separator' },
        { role: 'cut', label: t('Cut') },
        { role: 'copy', label: t('Copy') },
        { role: 'paste', label: t('Paste') },
        { role: 'selectAll', label: t('Select All') }
      ]
    },
    {
      label: t('View'),
      submenu: [
        { role: 'reload', label: t('Reload') },
        { role: 'forceReload', label: t('Force Reload') },
        { role: 'toggleDevTools', label: t('Toggle Developer Tools') },
        { type: 'separator' },
        { role: 'resetZoom', label: t('Actual Size') },
        { role: 'zoomIn', label: t('Zoom In') },
        { role: 'zoomOut', label: t('Zoom Out') },
        { role: 'togglefullscreen', label: t('Toggle Full Screen') }
      ]
    },
    {
      label: t('Window'),
      submenu: [
        { role: 'minimize', label: t('Minimize') },
        { role: 'zoom', label: t('Zoom') },
        { role: 'front', label: t('Bring All to Front') }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
