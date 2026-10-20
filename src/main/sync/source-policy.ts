import { execFile } from 'node:child_process'
import { lstat, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { ExplorerConfigurationError, within } from './configuration'

const PROBE = `
$ErrorActionPreference = 'Stop'
$probePath = $env:WAKUSHARE_SOURCE_ROOT
$probeDrive = [System.IO.DriveInfo]::new([System.IO.Path]::GetPathRoot($probePath))
[pscustomobject]@{ driveType = [int]$probeDrive.DriveType; attributes = [long][System.IO.File]::GetAttributes($probePath) } | ConvertTo-Json -Compress
`
async function windowsVolume(path: string): Promise<void> {
  const executable = join(
    process.env.SystemRoot ?? 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
  )
  const output = await new Promise<string>((yes, no) =>
    execFile(
      executable,
      ['-NoProfile', '-NonInteractive', '-Command', PROBE],
      {
        windowsHide: true,
        timeout: 10000,
        maxBuffer: 8192,
        encoding: 'utf8',
        env: { ...process.env, WAKUSHARE_SOURCE_ROOT: path }
      },
      (error, stdout) =>
        error ? no(new ExplorerConfigurationError('EXPLORER_SOURCE_UNAVAILABLE')) : yes(stdout)
    )
  )
  let value: { driveType: number; attributes: number }
  try {
    value = JSON.parse(output.trim())
  } catch {
    throw new ExplorerConfigurationError('EXPLORER_SOURCE_UNAVAILABLE')
  }
  if (![2, 3].includes(value.driveType))
    throw new ExplorerConfigurationError('EXPLORER_LOCAL_SOURCE_REQUIRED')
  if (
    !Number.isSafeInteger(value.attributes) ||
    (value.attributes & (0x400 | 0x1000 | 0x40000 | 0x400000)) !== 0
  )
    throw new ExplorerConfigurationError('EXPLORER_LINKED_SOURCE')
}

/** Runs only for an explicit add/reconnect, never periodically. */
export class ExplorerSourcePolicy {
  constructor(
    private readonly excluded: string[],
    private readonly volumeCheck = process.platform === 'win32'
      ? windowsVolume
      : async (): Promise<void> => {}
  ) {}
  async resolve(path: string): Promise<string> {
    if (
      !isAbsolute(path) ||
      path.includes('\0') ||
      path.length > 8192 ||
      path.startsWith('\\\\') ||
      path.startsWith('//')
    )
      throw new ExplorerConfigurationError('EXPLORER_LOCAL_SOURCE_REQUIRED')
    try {
      const info = await lstat(path)
      if (info.isSymbolicLink()) throw new ExplorerConfigurationError('EXPLORER_LINKED_SOURCE')
      if (!info.isDirectory()) throw new ExplorerConfigurationError('EXPLORER_SOURCE_UNAVAILABLE')
      let current = path
      while (true) {
        if ((await lstat(current)).isSymbolicLink())
          throw new ExplorerConfigurationError('EXPLORER_LINKED_SOURCE')
        const parent = dirname(current)
        if (parent === current) break
        current = parent
      }
      const canonical = await realpath(path)
      for (const root of this.excluded) {
        let resolved = root
        try {
          resolved = await realpath(root)
        } catch {
          /* Protect the configured location even while absent. */
        }
        if (within(resolved, canonical) || within(canonical, resolved))
          throw new ExplorerConfigurationError('EXPLORER_PROTECTED_SOURCE')
      }
      await this.volumeCheck(canonical)
      return canonical
    } catch (error) {
      if (error instanceof ExplorerConfigurationError) throw error
      throw new ExplorerConfigurationError('EXPLORER_SOURCE_UNAVAILABLE')
    }
  }
}
