import { Menu, Tray, nativeImage, type BrowserWindow } from 'electron'
import icon from '../../../resources/tray.ico?asset&asarUnpack'
import { showMainWindow } from '../show-window'
import { translateText, type Language } from '../../shared/i18n'
import type { ExplorerSnapshot } from '../../shared/explorer'
import type { ExplorerSupervisor } from './supervisor'

const STATUS: Record<ExplorerSnapshot['status'], string> = {
  Disabled: 'Off',
  WaitingForProject: 'Waiting for a CapCut project',
  Watching: 'Watching for changes',
  Syncing: 'Synchronizing…',
  Conflict: 'Synchronization needs attention',
  Empty: 'No active folders',
  Starting: 'Preparing folders…',
  WaitingForRuntime: 'Runtime not available',
  Indexing: 'Checking changes…',
  SourceUnavailable: 'Check source folders',
  WaitingForAdapter: 'Folder index ready',
  Error: 'Connection error'
}
/** No timer. The tray follows main state, independently of renderer navigation. */
export class ExplorerTray {
  private tray: Tray | null = null
  private latest: ExplorerSnapshot | null = null
  private menuKey = ''
  private disposed = false
  private changing = false
  private unsubscribe: () => void
  constructor(
    private readonly options: {
      supervisor: ExplorerSupervisor
      getWindow: () => BrowserWindow | null
      language: () => Language
      quit: () => void
      warn: (message: string) => void
    }
  ) {
    // The app must remain reachable even before synchronization initializes,
    // when it is disabled, or when the CapCut adapter cannot start.
    this.ensureTray()
    this.updateMenu()
    this.unsubscribe = options.supervisor.subscribe((snapshot) => this.update(snapshot))
  }
  shouldHideOnClose(): boolean {
    return !this.disposed && this.tray !== null && !this.tray.isDestroyed()
  }
  refreshLanguage(): void {
    this.menuKey = ''
    this.updateMenu()
  }
  dispose(): void {
    this.disposed = true
    this.unsubscribe()
    this.tray?.destroy()
    this.tray = null
  }
  private show(): void {
    showMainWindow(this.options.getWindow()) // Explicit Open/click only.
  }
  private update(snapshot: ExplorerSnapshot): void {
    if (this.disposed || (this.latest && snapshot.sequence < this.latest.sequence)) return
    this.latest = snapshot
    this.ensureTray()
    this.updateMenu()
  }
  private ensureTray(): void {
    if (!this.tray) {
      try {
        // Multi-size ICO covers Windows 10/11 notification-area DPI sizes.
        // Do not share a fixed GUID across unsigned installed/Portable paths.
        if (nativeImage.createFromPath(icon).isEmpty()) throw new Error('Tray icon is empty')
        this.tray = new Tray(icon)
        this.tray.on('click', () => this.show())
        this.tray.on('double-click', () => this.show())
      } catch {
        this.options.warn('Explorer tray could not be created; closing the window will exit.')
        return
      }
    }
  }
  private updateMenu(): void {
    if (!this.tray) return
    const snapshot = this.latest
    const language = this.options.language()
    const status = snapshot?.status ?? 'Disabled'
    const enabled = snapshot?.configuration.enabled ?? false
    const key = language + ':' + status + ':' + enabled + ':' + Boolean(snapshot)
    if (this.menuKey === key) return
    this.menuKey = key
    const t = (text: string): string => translateText(text, language)
    this.tray.setToolTip('WakuShare · ' + t(STATUS[status]))
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: t('Open WakuShare'), click: () => this.show() },
        { label: t(STATUS[status]), enabled: false },
        { type: 'separator' },
        {
          label: t(enabled ? 'Pause synchronization' : 'Resume synchronization'),
          enabled: snapshot !== null,
          click: () => {
            const current = this.latest
            if (!current || this.changing) return
            this.changing = true
            const enabled = !current.configuration.enabled
            void this.options.supervisor
              .change(current.configuration.revision, { type: 'enabled', enabled })
              .catch(() => {
                this.options.warn('Explorer could not change synchronization from the tray.')
              })
              .finally(() => {
                this.changing = false
              })
          }
        },
        { label: t('Quit WakuShare'), click: () => this.options.quit() }
      ])
    )
  }
}
