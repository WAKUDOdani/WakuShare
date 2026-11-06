import type { BrowserWindow } from 'electron'

/** Reopening a tray-hidden window needs show(); focus() alone cannot reveal it. */
export function showMainWindow(window: BrowserWindow | null): boolean {
  if (!window || window.isDestroyed()) return false
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
  return true
}
