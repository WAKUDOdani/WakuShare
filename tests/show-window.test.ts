import type { BrowserWindow } from 'electron'
import { expect, it, vi } from 'vitest'
import { showMainWindow } from '../src/main/show-window'

it.each([true, false])(
  'shows a tray-hidden window before focusing it (minimized: %s)',
  (minimized) => {
    const calls: string[] = []
    const window = {
      isDestroyed: () => false,
      isMinimized: () => minimized,
      restore: () => calls.push('restore'),
      show: () => calls.push('show'),
      focus: () => calls.push('focus')
    } as unknown as BrowserWindow
    expect(showMainWindow(window)).toBe(true)
    expect(calls).toEqual(minimized ? ['restore', 'show', 'focus'] : ['show', 'focus'])
  }
)

it('does not operate on a missing or destroyed window', () => {
  const show = vi.fn()
  expect(showMainWindow(null)).toBe(false)
  expect(showMainWindow({ isDestroyed: () => true, show } as unknown as BrowserWindow)).toBe(false)
  expect(show).not.toHaveBeenCalled()
})
