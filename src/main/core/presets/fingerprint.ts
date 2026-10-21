import { walkJsonStrings } from '../capcut/scanner'
import { createHash } from 'node:crypto'
import { basename, extname } from 'node:path'
import type { Manifest } from './package'
import { CapShareError } from '../errors'

const digest = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex')
const document = (entry: string): boolean => /\.json$|(?:^|\/)template(?:-\d+)?\.tmp$/i.test(entry)
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i
const metadataFields = new Set([
  'id',
  'name',
  'user_id',
  'create_time',
  'import_time',
  'import_time_ms',
  'import_time_us'
])

/** Older packages left this native cover spelling untouched, but contain its exact local file. */
export function legacyPresetTarget(
  manifest: Manifest,
  owner: string,
  value: string
): string | null {
  const match = /^##_presetpath_placeholder_[0-9a-f-]+_##\/Presets\/(.+)$/i.exec(
    value.replace(/\\/g, '/')
  )
  if (!match || !manifest.storage[owner]) return null
  const stem = basename(manifest.storage[owner].metadata, '.json')
  if (!match[1].startsWith(stem + '/')) return null
  const entry = `payload/${owner}/${match[1].slice(stem.length + 1)}`
  return manifest.files.some(
    (file) => file.entry === entry && file.kind === 'preset' && file.owners.includes(owner)
  )
    ? entry
    : null
}

/** Conservative content equality, independent of relocated paths, display name and generated IDs. */
export function presetFingerprint(
  manifest: Manifest,
  owner: string,
  contents: Map<string, Buffer>,
  onCanonical?: (value: unknown) => void
): string {
  const files = manifest.files.filter((file) => file.owners.includes(owner))
  const byEntry = new Map(files.map((file) => [file.entry, file]))
  const parsed = new Map<string, unknown>()
  const identifiers = new Set([owner])
  const collect = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(collect)
      return
    }
    if (value && typeof value === 'object')
      for (const [key, child] of Object.entries(value)) {
        if (key === 'id' && typeof child === 'string' && uuid.test(child))
          identifiers.add(child.toLowerCase())
        collect(child)
      }
    if (typeof value === 'string' && /^[\s]*[[{]/.test(value)) {
      try {
        collect(JSON.parse(value))
      } catch {
        /* Plain text. */
      }
    }
  }
  for (const file of files.filter((file) => file.kind !== 'effect' && document(file.entry))) {
    const raw = contents.get(file.entry)
    if (!raw)
      throw new CapShareError('ARCHIVE_INVALID', 'Missing document during duplicate comparison')
    const value = raw.length ? JSON.parse(raw.toString('utf8').replace(/^\uFEFF/, '')) : null
    walkJsonStrings(value, () => undefined) // Bound depth/embedded JSON before recursive canonicalization.
    parsed.set(file.entry, value)
    if (value && typeof value === 'object' && typeof value['id'] === 'string')
      identifiers.add(value['id'].toLowerCase())
    collect(value)
  }
  const ids = new Map<string, number>(),
    resources = new Map<string, number>(),
    graph: unknown[] = []
  const references = new Map(
    manifest.references.filter((ref) => ref.owner === owner).map((ref) => [ref.from, ref.target])
  )
  const canonical = (value: unknown, field = ''): unknown => {
    if (typeof value === 'string') {
      const target = references.get(value) ?? legacyPresetTarget(manifest, owner, value)
      if (target) return { $resource: resource(target) }
      if (value.startsWith('##_presetpath_placeholder_'))
        throw new CapShareError(
          'ARCHIVE_INVALID',
          'An older package contains an unresolved preset resource. Export it again with the current version.'
        )
      if (
        identifiers.has(value.toLowerCase()) &&
        !/^(?:text|title|name|family|content)$/i.test(field)
      ) {
        if (!ids.has(value.toLowerCase())) ids.set(value.toLowerCase(), ids.size)
        return { $id: ids.get(value.toLowerCase()) }
      }
      if (/^[\s]*[[{]/.test(value)) {
        let decoded: unknown
        try {
          decoded = JSON.parse(value)
        } catch {
          return value
        }
        return { $json: canonical(decoded) }
      }
      return value
    }
    if (Array.isArray(value)) return value.map((item) => canonical(item, field))
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((key) => [key, canonical(value[key], key)])
      )
    return value
  }
  const fileValue = (entry: string): unknown => {
    const file = byEntry.get(entry)
    if (!file) throw new CapShareError('ARCHIVE_INVALID', 'Unknown duplicate comparison dependency')
    if (!parsed.has(entry)) return { bytes: file.size, sha256: file.sha256 }
    let value = parsed.get(entry)
    if (
      entry === `payload/${owner}/${manifest.storage[owner].metadata}` &&
      value &&
      typeof value === 'object'
    )
      value = Object.fromEntries(Object.entries(value).filter(([key]) => !metadataFields.has(key)))
    return { document: canonical(value) }
  }
  const resource = (target: string): number => {
    if (resources.has(target)) return resources.get(target)!
    const id = graph.length
    resources.set(target, id)
    graph.push(null)
    graph[id] = byEntry.has(target)
      ? fileValue(target)
      : files
          .filter((file) => file.entry.startsWith(target + '/'))
          .sort((a, b) => a.entry.localeCompare(b.entry, 'en'))
          .map((file) => [file.entry.slice(target.length + 1), fileValue(file.entry)])
    return id
  }
  const metadata = manifest.storage[owner].metadata
  const stem = basename(metadata, '.json')
  const path = (entry: string): string => {
    const relative = entry.slice(`payload/${owner}/`.length)
    if (relative === metadata) return '$metadata.json'
    if (
      !relative.includes('/') &&
      basename(relative, extname(relative)) === stem &&
      /\.(?:jpe?g|png)$/i.test(relative)
    )
      return '$cover' + extname(relative)
    return relative
  }
  const payload = files
    .filter((file) => file.kind === 'preset')
    .map((file) => ({ entry: file.entry, path: path(file.entry) }))
    .sort((a, b) => a.path.localeCompare(b.path, 'en'))
    .map((file) => [file.path, fileValue(file.entry)])
  const result = { version: 1, payload, graph }
  onCanonical?.(result)
  return digest(result)
}

export const fingerprintDocument = document
