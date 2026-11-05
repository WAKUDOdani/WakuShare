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
    join(apps, 'CapCut.exe'),
    ...(version ? [join(apps, version, 'CapCut.exe')] : []),
    join(local, 'CapCut', 'CapCut.exe')
  ].filter((path) => existsSync(path))
}

/** Prefer the official bootstrapper. Observe early crashes instead of treating
 * the OS spawn acknowledgement as a completed launch. This is not readiness. */
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
        await spawnWindowsCapCut(candidate)
      } catch (error) {
        failure = error
        continue // Only explicit OS/early-exit failures permit a different candidate.
      }
      const state = await windowsStartupState()
      if (state === 'ready') return true
      if (state === 'stopped') {
        // CapCut can exit on a cold start after its bootstrapper returned 0.
        // Retry exactly once, only after repeated absence checks (never while
        // an editor, hidden process or delayed startup is still alive).
        beforeSpawn()
        await spawnWindowsCapCut(candidate)
        if ((await windowsStartupState()) === 'ready') return true
      }
      throw new CapShareError(
        'IMPORT_FAILED',
        'CapCut did not open a window. Try opening it from its shortcut.'
      )
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

function spawnWindowsCapCut(candidate: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(candidate, ['--src1'], {
      cwd: dirname(candidate),
      detached: true,
      stdio: 'ignore',
      windowsHide: false
    })
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (error?: Error): void => {
      clearTimeout(timer)
      if (error) reject(error)
      else resolve()
    }
    child.once('error', finish)
    child.once('exit', (code, signal) => {
      finish(code === 0 ? undefined : new Error(`CapCut exited during startup: ${code ?? signal}`))
    })
    child.once('spawn', () => {
      child.unref()
      // Bootstrapper exits cleanly after handing off to the editor. A
      // persistent editor process need not exit; bound this observation.
      timer = setTimeout(() => finish(), 8000)
    })
  })
}

/** Read-only process/window observation; never sends input or changes focus. */
async function windowsStartupState(): Promise<'ready' | 'stopped' | 'running'> {
  const script = `
$timer = [Diagnostics.Stopwatch]::StartNew()
$absent = 0
while ($timer.ElapsedMilliseconds -lt 20000) {
  $editors = @(Get-Process -Name CapCut -ErrorAction SilentlyContinue)
  if (@($editors | Where-Object { $_.MainWindowHandle -ne 0 }).Count -gt 0) { 'ready'; exit 0 }
  if ($editors.Count -eq 0) { $absent++ } else { $absent = 0 }
  if ($timer.ElapsedMilliseconds -ge 3000 -and $absent -ge 3) { 'stopped'; exit 0 }
  Start-Sleep -Milliseconds 250
}
'running'
`
  let output: string
  try {
    const { stdout } = await execAsync(
      join(
        process.env.SystemRoot ?? 'C:\\Windows',
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe'
      ),
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, timeout: 25000, maxBuffer: 4096 }
    )
    output = stdout
  } catch {
    throw new CapShareError('IMPORT_FAILED', 'Could not verify whether the CapCut window opened.')
  }
  const state = output.trim()
  if (state === 'ready' || state === 'stopped' || state === 'running') return state
  throw new CapShareError('IMPORT_FAILED', 'Could not verify whether the CapCut window opened.')
}
