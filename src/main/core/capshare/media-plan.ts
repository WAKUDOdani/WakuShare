import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { DRAFT_PATH_PLACEHOLDER } from '../capcut/constants'
import { walkJsonStrings, normalizeSlashes } from '../capcut/scanner'
import type { ProjectDocument } from '../capcut/project'
import { CapShareError } from '../errors'
import type { CapShareManifest } from './manifest'

export const SOURCES_FOLDER = 'Resources/local/Исходники'

function mediaName(name: string): string {
  // Preserve extensions and Unicode. Hash folders, not content, disambiguate names.
  // eslint-disable-next-line no-control-regex -- Windows file names forbid these control characters.
  let result = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '')
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(result)) result = '_' + result
  if (result.length > 220) {
    const dot = result.lastIndexOf('.')
    const extension = dot > 0 ? result.slice(dot, dot + 20) : ''
    result = result.slice(0, 200) + extension
  }
  return result || 'source'
}

export function createMediaPlan(manifest: CapShareManifest): {
  looseTargets: Map<string, { newRel: string; originalPath: string }>
  internalTargets: Map<string, string>
  archiveTargets: Map<string, string>
} {
  const looseTargets = new Map<string, { newRel: string; originalPath: string }>()
  const internalTargets = new Map<string, string>()
  const archiveTargets = new Map<string, string>()
  const used = new Set<string>()
  const allocate = (fileName: string, identity: string): string => {
    const name = mediaName(fileName)
    let candidate = `${SOURCES_FOLDER}/${name}`
    if (used.has(candidate.toLowerCase())) {
      const token = createHash('sha256').update(identity).digest('hex').slice(0, 20)
      candidate = `${SOURCES_FOLDER}/${token}/${name}`
    }
    if (used.has(candidate.toLowerCase()))
      throw new CapShareError('ARCHIVE_INVALID', `Duplicate media identity: ${identity}`)
    used.add(candidate.toLowerCase())
    return candidate
  }
  const internals = Object.keys(manifest.integrity)
    .filter((p) => p.startsWith('Resources/local/'))
    .sort()
  // Re-exporting an organized project must not add another nested Sources folder.
  for (const relative of internals.filter((p) => p.startsWith(SOURCES_FOLDER + '/'))) {
    if (used.has(relative.toLowerCase()))
      throw new CapShareError('ARCHIVE_INVALID', 'Conflicting internal media names')
    used.add(relative.toLowerCase())
    internalTargets.set(relative, relative)
    archiveTargets.set('draft/' + relative, relative)
  }
  for (const relative of internals.filter((p) => !internalTargets.has(p))) {
    const target = allocate(relative.split('/').pop()!, 'draft/' + relative)
    internalTargets.set(relative, target)
    archiveTargets.set('draft/' + relative, target)
  }
  const origins = new Set<string>()
  for (const loose of manifest.looseMedia) {
    const origin = normalizeSlashes(loose.originalPath).toLowerCase()
    if (origins.has(origin) || archiveTargets.has(loose.archivePath)) {
      throw new CapShareError(
        'ARCHIVE_INVALID',
        `Duplicate loose-media mapping: ${loose.originalPath}`
      )
    }
    origins.add(origin)
    const newRel = allocate(loose.fileName, loose.archivePath)
    looseTargets.set(loose.archivePath, { newRel, originalPath: loose.originalPath })
    archiveTargets.set(loose.archivePath, newRel)
  }
  return { looseTargets, internalTargets, archiveTargets }
}

export function relocatedInternalPath(
  value: string,
  targets: Map<string, string>
): string | undefined {
  const normalized = normalizeSlashes(value)
  for (const prefix of [DRAFT_PATH_PLACEHOLDER + '/', './', '']) {
    if (!normalized.startsWith(prefix)) continue
    const relative = normalized.slice(prefix.length)
    const target = targets.get(relative)
    if (target) return target
  }
  return undefined
}

/** Do not let an incomplete old archive pass merely because originals still exist. */
export function verifyLocalMedia(folder: string, documents: Map<string, ProjectDocument>): void {
  const missing: string[] = []
  for (const doc of documents.values()) {
    walkJsonStrings(doc.value, (value, pointer) => {
      if (!value || pointer.includes('draft_materials_copied_info')) return undefined
      const isMedia =
        /\/materials\/(?:videos|audios)\/\d+\/path$/.test(pointer) || pointer.endsWith('/file_Path')
      if (!isMedia) return undefined
      const normalized = normalizeSlashes(value)
      let relative: string | null = null
      if (normalized.startsWith(DRAFT_PATH_PLACEHOLDER + '/'))
        relative = normalized.slice(DRAFT_PATH_PLACEHOLDER.length + 1)
      else if (normalized.startsWith('./')) relative = normalized.slice(2)
      else if (!/^(?:[A-Za-z]:|\/|[a-z]+:\/\/)/i.test(normalized)) relative = normalized
      const target = relative === null ? null : resolve(folder, relative)
      if (target === null || !target.startsWith(resolve(folder) + sep) || !existsSync(target)) {
        missing.push(`${doc.relativePath}${pointer}: ${value}`)
      }
      return undefined
    })
  }
  if (missing.length) {
    throw new CapShareError(
      'IMPORT_FAILED',
      `The package is not self-contained: ${missing.length} media reference(s) are unresolved.`,
      missing.join('\n')
    )
  }
}
