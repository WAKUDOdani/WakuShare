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
  install: vi.fn(),
  openExternal: vi.fn(async (): Promise<void> => {})
}))
vi.mock('electron', () => ({
  app: mocks.app,
  shell: { openExternal: mocks.openExternal },
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
  mocks.openExternal.mockReset().mockResolvedValue(undefined)
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
  it('does not contact a feed or open a browser in development', async () => {
    mocks.app.isPackaged = false
    setupUpdater({ getMainWindow: () => null, isBusy: () => false })
    await mocks.handles.get(IPC.updateCheck)!()
    expect(mocks.feeds).toEqual([])
    expect(mocks.openExternal).not.toHaveBeenCalled()
  })
  it.each(['PORTABLE_EXECUTABLE_FILE', 'PORTABLE_EXECUTABLE_DIR'])(
    'opens only the latest WakuShare release after a user request in portable mode (%s)',
    async (flag) => {
      vi.stubEnv(flag, 'portable-location')
      setupUpdater({ getMainWindow: () => null, isBusy: () => false })
      expect(mocks.feeds).toEqual([])
      expect(mocks.openExternal).not.toHaveBeenCalled()
      expect(mocks.handles.get(IPC.updateGetStatus)!()).toMatchObject({ state: 'manual' })
      await mocks.handles.get(IPC.updateCheck)!()
      expect(mocks.openExternal).toHaveBeenCalledExactlyOnceWith(
        'https://github.com/WAKUDOdani/WakuShare/releases/latest'
      )
      expect(mocks.handles.get(IPC.updateGetStatus)!()).toMatchObject({ state: 'manual' })
      mocks.handles.get(IPC.updateInstall)!()
      expect(mocks.install).not.toHaveBeenCalled()
      expect(mocks.check).not.toHaveBeenCalled()
    }
  )
  it('reports a failed browser launch in portable mode', async () => {
    vi.stubEnv('PORTABLE_EXECUTABLE_FILE', 'WakuShare-portable.exe')
    mocks.openExternal.mockRejectedValue(new Error('Browser could not be opened'))
    setupUpdater({ getMainWindow: () => null, isBusy: () => false })
    await mocks.handles.get(IPC.updateCheck)!()
    expect(mocks.handles.get(IPC.updateGetStatus)!()).toEqual({
      state: 'error',
      message: 'Browser could not be opened'
    })
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
  it('explains the actual GitHub empty-feed parse error without exposing its stack/XML', async () => {
    mocks.check.mockRejectedValue(
      new Error(
        'Cannot parse releases feed: Error: Unable to find latest version on GitHub (https://github.com/WAKUDOdani/WakuShare/releases/latest), XML: <feed>...</feed>'
      )
    )
    setupUpdater({ getMainWindow: () => null, isBusy: () => false })
    await mocks.handles.get(IPC.updateCheck)!()
    expect(mocks.handles.get(IPC.updateGetStatus)!()).toEqual({
      state: 'error',
      message: 'No published WakuShare update is available yet. Try again later.'
    })
  })
})
