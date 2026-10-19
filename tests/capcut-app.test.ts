import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ run: vi.fn() }))
vi.mock('node:child_process', () => ({
  execFile: Object.assign(vi.fn(), { [Symbol.for('nodejs.util.promisify.custom')]: mocks.run })
}))
vi.mock('electron', () => ({ shell: { openPath: vi.fn() } }))
import { isCapCutRunning, requireClosedCapCut } from '../src/main/capcut-app'
beforeEach(() => {
  vi.stubGlobal(
    'process',
    Object.defineProperty(Object.create(process), 'platform', { value: 'win32' })
  )
  mocks.run.mockReset()
})
afterEach(() => vi.unstubAllGlobals())
describe('preset import process guard', () => {
  it('blocks when CapCut is running', async () => {
    mocks.run.mockResolvedValue({ stdout: '"CapCut.exe","1234","Console","1","10 000 K"' })
    await expect(requireClosedCapCut()).rejects.toThrow('Close CapCut')
    expect(mocks.run).toHaveBeenCalledWith('tasklist.exe', expect.any(Array), {
      windowsHide: true,
      timeout: 5000
    })
  })
  it('permits a confirmed closed editor', async () => {
    mocks.run.mockResolvedValue({
      stdout: 'INFO: No tasks are running which match the specified criteria.'
    })
    await expect(requireClosedCapCut()).resolves.toBeUndefined()
  })
  it('blocks on detection failure rather than assuming the editor is closed', async () => {
    mocks.run.mockRejectedValue(new Error('process query unavailable'))
    await expect(requireClosedCapCut()).rejects.toThrow('Could not verify')
    await expect(isCapCutRunning()).resolves.toBe(false)
  })
  it('treats only pgrep exit 1 as a confirmed missing process on macOS', async () => {
    vi.stubGlobal(
      'process',
      Object.defineProperty(Object.create(process), 'platform', { value: 'darwin' })
    )
    mocks.run.mockRejectedValue({ code: 1 })
    await expect(requireClosedCapCut()).resolves.toBeUndefined()
    mocks.run.mockRejectedValue({ code: 2 })
    await expect(requireClosedCapCut()).rejects.toThrow('Could not verify')
  })
})
