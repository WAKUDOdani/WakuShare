import { beforeEach, expect, it, vi } from 'vitest'
import type { ExplorerSnapshot } from '../src/shared/explorer'
import type { ExplorerSupervisor } from '../src/main/sync/supervisor'
import type { BrowserWindow, MenuItemConstructorOptions } from 'electron'

const mocks = vi.hoisted(() => ({ instances: [] as unknown[], fail: false }))
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  class FakeTray extends EventEmitter {
    destroy = vi.fn()
    setToolTip = vi.fn()
    menu: MenuItemConstructorOptions[] = []
    setContextMenu(menu: MenuItemConstructorOptions[]): void {
      this.menu = menu
    }
    constructor() {
      super()
      if (mocks.fail) throw new Error('No tray')
      mocks.instances.push(this)
    }
  }
  return { Tray: FakeTray, Menu: { buildFromTemplate: (items: unknown) => items } }
})
vi.mock('../resources/icon.png?asset', () => ({ default: 'icon.png' }))
import { ExplorerTray } from '../src/main/sync/tray'

let emit: (snapshot: ExplorerSnapshot) => void
const unsubscribe = vi.fn(),
  change = vi.fn(),
  warn = vi.fn(),
  quit = vi.fn()
const window = {
  isDestroyed: () => false,
  isMinimized: () => false,
  show: vi.fn(),
  focus: vi.fn(),
  restore: vi.fn()
}
const state = (enabled: boolean, sequence = 1): ExplorerSnapshot => ({
  sequence,
  configuration: {
    schemaVersion: 1,
    revision: sequence,
    enabled,
    sources: [],
    projects: [],
    attachments: [],
    overrides: []
  },
  currentProject: null,
  status: enabled ? 'Empty' : 'Disabled',
  reason: null,
  indexedFiles: 0,
  pending: 0,
  roots: [],
  lastCheckedAt: null
})
beforeEach(() => {
  vi.clearAllMocks()
  mocks.instances = []
  mocks.fail = false
})
function create(): ExplorerTray {
  return new ExplorerTray({
    supervisor: {
      subscribe: (callback) => {
        emit = callback
        return unsubscribe
      },
      change
    } as unknown as ExplorerSupervisor,
    getWindow: () => window as unknown as BrowserWindow,
    language: () => 'en',
    warn,
    quit
  })
}
function instance(): { destroy: ReturnType<typeof vi.fn>; menu: MenuItemConstructorOptions[] } {
  return mocks.instances[0] as ReturnType<typeof instance>
}
const click = (label: string): void => {
  const item = instance().menu.find((item) => item.label === label)!
  ;(item.click as () => void)()
}
it('creates no tray while off, never focuses on pushes, and hides only with a working enabled tray', () => {
  const tray = create()
  emit(state(false))
  expect(mocks.instances).toHaveLength(0)
  expect(tray.shouldHideOnClose()).toBe(false)
  emit(state(true, 2))
  expect(tray.shouldHideOnClose()).toBe(true)
  expect(window.focus).not.toHaveBeenCalled()
  click('Open WakuShare')
  expect(window.show).toHaveBeenCalledOnce()
  expect(window.focus).toHaveBeenCalledOnce()
  emit(state(false, 3))
  expect(instance().destroy).toHaveBeenCalledOnce()
  expect(tray.shouldHideOnClose()).toBe(false)
  tray.dispose()
  expect(unsubscribe).toHaveBeenCalledOnce()
})
it('pauses and resumes from the tray, rejects stale snapshots and quits explicitly', async () => {
  const tray = create()
  emit(state(true, 2))
  change.mockImplementation(async (_rev, edit) => emit(state(edit.enabled, edit.enabled ? 4 : 3)))
  click('Pause synchronization')
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  expect(tray.shouldHideOnClose()).toBe(false)
  expect(instance().destroy).not.toHaveBeenCalled()
  expect(instance().menu.some((item) => item.label === 'Resume synchronization')).toBe(true)
  emit(state(true, 1))
  expect(instance().menu.some((item) => item.label === 'Resume synchronization')).toBe(true)
  click('Resume synchronization')
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  expect(tray.shouldHideOnClose()).toBe(true)
  expect(change).toHaveBeenLastCalledWith(3, { type: 'enabled', enabled: true })
  expect(window.focus).not.toHaveBeenCalled()
  click('Quit WakuShare')
  expect(quit).toHaveBeenCalledOnce()
  tray.dispose()
})
it('keeps ordinary window closing when a tray cannot be created', () => {
  mocks.fail = true
  const tray = create()
  emit(state(true))
  expect(tray.shouldHideOnClose()).toBe(false)
  expect(warn).toHaveBeenCalledOnce()
  tray.dispose()
})
