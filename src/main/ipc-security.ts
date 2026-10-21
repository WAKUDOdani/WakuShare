import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'

/** A renderer subframe or another window never inherits filesystem privileges. */
export function assertMainFrame(event: IpcMainInvokeEvent, window: BrowserWindow | null): void {
  if (
    !window ||
    window.isDestroyed() ||
    !event ||
    event.sender !== window.webContents ||
    !event.senderFrame ||
    event.senderFrame !== window.webContents.mainFrame
  )
    throw new Error('Untrusted IPC sender')
}

export function trustedHandle(getWindow: () => BrowserWindow | null): typeof ipcMain.handle {
  return (channel, listener) =>
    ipcMain.handle(channel, (event, ...args) => {
      assertMainFrame(event, getWindow())
      return listener(event, ...args)
    })
}

export function safeExternalUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
  } catch {
    return false
  }
}
