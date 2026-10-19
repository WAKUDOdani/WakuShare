import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC } from '../src/shared/channels'
import { UPDATE_FEED } from '../src/shared/branding'

const mocks = vi.hoisted(() => ({
  app: { isPackaged: true, getVersion: () => '1.0.0' },
  handles: new Map<string, (...args: unknown[]) => unknown>(),
  feeds: [] as unknown[],
  instances: [] as EventEmitter[],
  check: vi.fn(async () => null),
  install: vi.fn()
}))
vi.mock('electron', () => ({
  app: mocks.app,
  ipcMain: {
    handle: (key: string, handler: (...args: unknown[]) => unknown) =>
      mocks.handles.set(key, handler)
  }
}))
vi.mock('electron-log/main', () => ({ default: { warn: vi.fn() } }))
vi.mock('electron-updater', async () => {
  const { EventEmitter } = await import('node:events')
  class FakeUpdater extends EventEmitter {
    checkForUpdates = mocks.check
    quitAndInstall = mocks.install
    constructor(feed: unknown) {
      super()
      mocks.feeds.push(feed)
      mocks.instances.push(this)
    }
  }
  return { default: { NsisUpdater: FakeUpdater } }
})
import { setupUpdater } from '../src/main/updater'

beforeEach(() => {
  vi.stubGlobal(
    'process',
    Object.defineProperty(Object.create(process), 'platform', { value: 'win32' })
  )
  vi.stubEnv('PORTABLE_EXECUTABLE_FILE', '')
  vi.stubEnv('PORTABLE_EXECUTABLE_DIR', '')
  mocks.app.isPackaged = true
  mocks.handles.clear()
  mocks.feeds.length = 0
  mocks.instances.length = 0
  mocks.check.mockReset().mockResolvedValue(null)
  mocks.install.mockReset()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('WakuShare updater', () => {
  it('uses only its public release feed; never installs automatically on quit', async () => {
    setupUpdater({ getMainWindow: () => null, isBusy: () => false })
    expect(mocks.feeds).toEqual([UPDATE_FEED])
    expect(mocks.instances[0]).toMatchObject({
      autoInstallOnAppQuit: false,
      autoDownload: true,
      allowDowngrade: false,
      allowPrerelease: false
    })
    expect(mocks.check).toHaveBeenCalledTimes(1)
    expect(mocks.install).not.toHaveBeenCalled()
  })
  it('does not contact a feed in development or portable mode', async () => {
    mocks.app.isPackaged = false
    setupUpdater({ getMainWindow: () => null, isBusy: () => false })
    await mocks.handles.get(IPC.updateCheck)!()
    expect(mocks.feeds).toEqual([])
    mocks.app.isPackaged = true
    vi.stubEnv('PORTABLE_EXECUTABLE_FILE', 'WakuShare-portable.exe')
    setupUpdater({ getMainWindow: () => null, isBusy: () => false })
    await mocks.handles.get(IPC.updateCheck)!()
    expect(mocks.feeds).toEqual([])
  })
  it('requires a downloaded update and refuses restart while a file task runs', async () => {
    let busy = true
    const send = vi.fn()
    const window = { isDestroyed: () => false, webContents: { send } }
    setupUpdater({ getMainWindow: () => window as never, isBusy: () => busy })
    mocks.handles.get(IPC.updateInstall)!()
    expect(mocks.install).not.toHaveBeenCalled()
    mocks.instances[0].emit('update-downloaded', { version: '1.0.1' })
    mocks.handles.get(IPC.updateInstall)!()
    expect(mocks.install).not.toHaveBeenCalled()
    expect(send).toHaveBeenLastCalledWith(
      IPC.updateStatus,
      expect.objectContaining({ state: 'error' })
    )
    busy = false
    mocks.handles.get(IPC.updateInstall)!()
    expect(mocks.install).toHaveBeenCalledExactlyOnceWith(false, true)
  })
  it('reports an empty release feed without failing application startup', async () => {
    mocks.check.mockRejectedValue(new Error('404 ERR_UPDATER_NO_PUBLISHED_VERSIONS'))
    setupUpdater({ getMainWindow: () => null, isBusy: () => false })
    await mocks.handles.get(IPC.updateCheck)!()
    expect(mocks.handles.get(IPC.updateGetStatus)!()).toMatchObject({
      state: 'error',
      message: 'No published WakuShare update is available yet. Try again later.'
    })
  })
})
