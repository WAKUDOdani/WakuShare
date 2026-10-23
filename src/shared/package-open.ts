import { isProjectPackage } from './project-package'

export function packageView(path: string): 'import' | 'presets' | null {
  if (!path || path.startsWith('-') || path.includes('\0')) return null
  if (/\.wakupresets$/i.test(path)) return 'presets'
  return isProjectPackage(path) ? 'import' : null
}

export function extractPackageArg(argv: string[]): string | null {
  return argv.find((value) => packageView(value) !== null) ?? null
}
