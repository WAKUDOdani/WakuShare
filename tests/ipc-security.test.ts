import { expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))
import { assertMainFrame, safeExternalUrl, trustedHandle } from '../src/main/ipc-security'
import { ipcMain } from 'electron'

it('rejects another window, subframes, detached frames and a destroyed main window', () => {
  const contents = { mainFrame: {} }
  const window = { isDestroyed: () => false, webContents: contents }
  const event = { sender: contents, senderFrame: contents.mainFrame }
  expect(() => assertMainFrame(event as never, window as never)).not.toThrow()
  for (const request of [
    undefined,
    { ...event, sender: {} },
    { ...event, senderFrame: {} },
    { sender: contents }
  ])
    expect(() => assertMainFrame(request as never, window as never)).toThrow()
  expect(() => assertMainFrame(event as never, null)).toThrow()
  expect(() =>
    assertMainFrame(event as never, { ...window, isDestroyed: () => true } as never)
  ).toThrow()
})
it('does not call a privileged handler for an untrusted request', () => {
  const listener = vi.fn()
  trustedHandle(() => null)('files', listener)
  const registered = vi.mocked(ipcMain.handle).mock.calls.at(-1)![1]
  expect(() => registered({} as never, 'path')).toThrow()
  expect(listener).not.toHaveBeenCalled()
})
it('allows browser links and rejects OS handlers, credentials and malformed URLs', () => {
  for (const value of ['https://t.me/WAKUDOdani', 'https://github.com/WAKUDOdani/WakuShare'])
    expect(safeExternalUrl(value)).toBe(true)
  for (const value of [
    'file:///C:/a.exe',
    'javascript:inert',
    'ms-msdt:inert',
    'https://user:pass@example.com',
    '//example.com',
    'invalid'
  ])
    expect(safeExternalUrl(value)).toBe(false)
})
