import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { shell } from 'electron'
import { CapShareError } from './core/errors'

const execAsync = promisify(execFile)

/** Best-effort check whether CapCut is currently running. */
export async function isCapCutRunning(strict = false): Promise<boolean> {
  try {
    if (process.platform === 'darwin') {
      const { stdout } = await execAsync('/usr/bin/pgrep', ['-x', 'CapCut'], { timeout: 5000 })
      return stdout.trim().length > 0
    }
    if (process.platform === 'win32') {
      const { stdout } = await execAsync(
        join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tasklist.exe'),
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

let launchInFlight: Promise<boolean> | null = null

/** Coalesce overlapping requests; never require a second click to finish one. */
export function launchCapCut(beforeSpawn: () => void = () => {}): Promise<boolean> {
  if (launchInFlight) return launchInFlight
  const request = launchInstalledCapCut(beforeSpawn).finally(() => {
    if (launchInFlight === request) launchInFlight = null
  })
  launchInFlight = request
  return request
}

async function windowsCandidates(local: string): Promise<string[]> {
  const apps = join(local, 'CapCut', 'Apps')
  const versionPattern = /^\d{1,6}(?:\.\d{1,6}){3}$/
  let version = ''
  try {
    const config = await readFile(join(apps, 'Configure.ini'), 'utf8')
    const configured = /^\s*last_version\s*=\s*([^\r\n]*)/im.exec(config)?.[1].trim() ?? ''
    if (versionPattern.test(configured) && existsSync(join(apps, configured, 'CapCut.exe')))
      version = configured
  } catch {
    /* Older installations need not have Configure.ini. */
  }
  if (!version) {
    // Use the installed version, not whichever old beta folder sorts first.
    const registryRoots = [
      'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\CapCut',
      'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\CapCut',
      'HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\CapCut'
    ]
    for (const key of registryRoots) {
      try {
        const { stdout } = await execAsync(
          join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'reg.exe'),
          ['query', key, '/v', 'DisplayVersion'],
          { windowsHide: true, timeout: 3000 }
        )
        const installed = /^\s*DisplayVersion\s+REG_SZ\s+(\S+)\s*$/im.exec(stdout)?.[1] ?? ''
        if (versionPattern.test(installed) && existsSync(join(apps, installed, 'CapCut.exe'))) {
          version = installed
          break
        }
      } catch {
        /* Keep the original bootstrapper fallback for other installation layouts. */
      }
    }
  }
  return [
    ...(version ? [join(apps, version, 'CapCut.exe')] : []),
    join(apps, 'CapCut.exe'),
    join(local, 'CapCut', 'CapCut.exe')
  ].filter((path) => existsSync(path))
}

/** A successful OS spawn is an accepted launch request, not editor readiness. */
async function launchInstalledCapCut(beforeSpawn: () => void): Promise<boolean> {
  if (process.platform === 'darwin') {
    const appPath = '/Applications/CapCut.app'
    if (existsSync(appPath)) {
      beforeSpawn()
      const error = await shell.openPath(appPath)
      return error === ''
    }
    return false
  }
  if (process.platform === 'win32') {
    const local = process.env['LOCALAPPDATA']
    if (!local) return false
    const candidates = await windowsCandidates(local)
    let failure: unknown
    for (const candidate of candidates) {
      beforeSpawn() // Recheck after asynchronous installation discovery.
      try {
        await new Promise<void>((resolve, reject) => {
          const child = spawn(candidate, ['--src1'], {
            cwd: dirname(candidate),
            detached: true,
            stdio: 'ignore',
            windowsHide: false
          })
          child.once('error', reject)
          child.once('spawn', () => {
            child.unref()
            resolve()
          })
        })
        return true
      } catch (error) {
        failure = error
      }
    }
    if (failure)
      throw new CapShareError(
        'IMPORT_FAILED',
        'Could not launch CapCut. Try opening it from its shortcut.'
      )
    return false
  }
  return false
}
