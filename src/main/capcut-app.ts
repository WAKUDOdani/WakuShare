import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { shell } from 'electron'
import { CapShareError } from './core/errors'

const execAsync = promisify(execFile)

/** Best-effort check whether CapCut is currently running. */
export async function isCapCutRunning(strict = false): Promise<boolean> {
  try {
    if (process.platform === 'darwin') {
      const { stdout } = await execAsync('pgrep', ['-x', 'CapCut'], { timeout: 5000 })
      return stdout.trim().length > 0
    }
    if (process.platform === 'win32') {
      const { stdout } = await execAsync(
        'tasklist.exe',
        ['/FI', 'IMAGENAME eq CapCut.exe', '/FO', 'CSV', '/NH'],
        { windowsHide: true, timeout: 5000 }
      )
      return /^"capcut\.exe",/im.test(stdout)
    }
  } catch (error) {
    if (process.platform === 'darwin' && (error as { code?: number }).code === 1) return false
    if (strict)
      throw new CapShareError(
        'IMPORT_FAILED',
        'Could not verify whether CapCut is running. Import is blocked; check CapCut and try again.'
      )
  }
  if (strict && process.platform !== 'win32' && process.platform !== 'darwin')
    throw new CapShareError(
      'IMPORT_FAILED',
      'CapCut process detection is unavailable on this platform.'
    )
  return false
}

/** Launches CapCut, returning false when no installation could be found. */
export async function requireClosedCapCut(): Promise<void> {
  if (await isCapCutRunning(true))
    throw new CapShareError(
      'IMPORT_FAILED',
      'Close CapCut before importing presets. Its preset catalog must not be open while it is updated.'
    )
}

/** Launches CapCut, returning false when no installation could be found. */
export async function launchCapCut(): Promise<boolean> {
  if (process.platform === 'darwin') {
    const appPath = '/Applications/CapCut.app'
    if (existsSync(appPath)) {
      const error = await shell.openPath(appPath)
      return error === ''
    }
    return false
  }
  if (process.platform === 'win32') {
    const local = process.env['LOCALAPPDATA']
    const candidates = [
      local ? join(local, 'CapCut', 'Apps', 'CapCut.exe') : null,
      local ? join(local, 'CapCut', 'CapCut.exe') : null
    ].filter((p): p is string => p !== null)
    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        const error = await shell.openPath(candidate)
        return error === ''
      }
    }
    return false
  }
  return false
}
