import { archiveError, validateArchivePath } from './archive-safety'

// These are never needed as transferable project media. Trust cannot enable them.
const LAUNCHABLE =
  /\.(?:exe|dll|com|scr|cpl|gadget|msu|inf|application|appref-ms|library-ms|search-ms|searchconnector-ms|settingcontent-ms|msc|sys|drv|ocx|msi|msp|msix|appx|bat|cmd|ps1|psm1|psd1|vbs|vbe|wsf|wsh|hta|lnk|url|scf|reg|jar|class|py|pyc|pyd|sh|bash|dylib|so|app|command|desktop)$/i
const ACTIVE = /\.(?:lua|luac|js|mjs|cjs|jse|html?|xhtml|svg|wasm|zip|7z|rar|tar|gz|effect)$/i

export type ApproveActiveContent = (entries: readonly string[]) => Promise<boolean>

export function assertDataFilename(name: string): void {
  validateArchivePath(name)
  // A double extension or a launchable parent directory must not hide the payload.
  if (name.split('/').some((part) => LAUNCHABLE.test(part)))
    throw archiveError('Executable files are not supported in project or preset packages')
}

export function requiresContentTrust(name: string): boolean {
  return ACTIVE.test(name)
}

/** Inspect only the first bytes as they already flow through the importer. */
export function assertDataSignature(prefix: Buffer): void {
  const magic = prefix.subarray(0, 4).toString('hex')
  if (
    prefix.subarray(0, 2).toString('ascii') === 'MZ' ||
    prefix.subarray(0, 2).toString('ascii') === '#!' ||
    ['7f454c46', 'feedface', 'feedfacf', 'cefaedfe', 'cffaedfe', 'cafebabe', 'bebafeca'].includes(
      magic
    )
  )
    throw archiveError('Executable content disguised as a resource')
}

export async function approveResources(
  entries: readonly string[],
  approve?: ApproveActiveContent
): Promise<void> {
  if (entries.length && !(await approve?.(entries)))
    throw archiveError(
      'The package contains active effect resources. Import requires explicit trust.'
    )
}
