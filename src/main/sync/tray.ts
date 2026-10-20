import { Menu, Tray, type BrowserWindow } from 'electron'
import icon from '../../../resources/icon.png?asset'
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
  private pausedFromTray = false
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
    this.unsubscribe = options.supervisor.subscribe((snapshot) => this.update(snapshot))
  }
  shouldHideOnClose(): boolean {
    return !this.disposed && this.tray !== null && this.latest?.configuration.enabled === true
  }
  refreshLanguage(): void {
    this.menuKey = ''
    if (this.latest) this.update(this.latest)
  }
  dispose(): void {
    this.disposed = true
    this.unsubscribe()
    this.tray?.destroy()
    this.tray = null
  }
  private show(): void {
    const window = this.options.getWindow()
    if (!window || window.isDestroyed()) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus() // Explicit Open/double-click only.
  }
  private update(snapshot: ExplorerSnapshot): void {
    if (this.disposed || (this.latest && snapshot.sequence < this.latest.sequence)) return
    this.latest = snapshot
    if (snapshot.configuration.enabled) this.pausedFromTray = false
    if (!snapshot.configuration.enabled && !this.pausedFromTray) {
      this.tray?.destroy()
      this.tray = null
      this.menuKey = ''
      return
    }
    if (!this.tray) {
      try {
        this.tray = new Tray(icon)
        this.tray.on('double-click', () => this.show())
      } catch {
        this.options.warn('Explorer tray could not be created; closing the window will exit.')
        return
      }
    }
    const language = this.options.language()
    const key = language + ':' + snapshot.status
    if (this.menuKey === key) return
    this.menuKey = key
    const t = (text: string): string => translateText(text, language)
    this.tray.setToolTip('WakuShare · ' + t(STATUS[snapshot.status]))
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: t('Open WakuShare'), click: () => this.show() },
        { label: t(STATUS[snapshot.status]), enabled: false },
        { type: 'separator' },
        {
          label: t(
            snapshot.configuration.enabled ? 'Pause synchronization' : 'Resume synchronization'
          ),
          click: () => {
            const current = this.latest
            if (!current || this.changing) return
            this.changing = true
            const enabled = !current.configuration.enabled
            this.pausedFromTray = !enabled
            void this.options.supervisor
              .change(current.configuration.revision, { type: 'enabled', enabled })
              .catch(() => {
                this.pausedFromTray = false
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
