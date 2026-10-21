import { z } from 'zod'
import { archivePathKey, validateArchivePath } from '../archive-safety'

/**
 * The .capshare manifest — format contract between exporter and importer.
 * Bump CAPSHARE_FORMAT_VERSION only for breaking layout changes; additive
 * fields should stay optional so older builds can import newer files.
 */
export const CAPSHARE_FORMAT_VERSION = 1

export const MANIFEST_ENTRY_NAME = 'manifest.json'
export const COVER_ENTRY_NAME = 'cover.jpg'
export const DRAFT_ENTRY_PREFIX = 'draft/'
export const EFFECT_ASSET_PREFIX = 'assets/effects/'
export const LOOSE_MEDIA_PREFIX = 'assets/loose/'

const trackSegmentSchema = z.object({
  startUs: z.number(),
  durationUs: z.number(),
  label: z.string().optional()
})

const trackSummarySchema = z.object({
  type: z.enum(['video', 'audio', 'text', 'sticker', 'effect', 'filter', 'adjust']),
  segments: z.array(trackSegmentSchema)
})

export const manifestSchema = z.object({
  formatVersion: z.number().int().min(1),
  source: z.object({
    os: z.enum(['mac', 'windows']),
    capcutVersion: z.string().nullable(),
    newVersion: z.string().nullable(),
    draftId: z.string(),
    timelineId: z.string().nullable(),
    draftName: z.string(),
    timelineFilename: z.enum(['draft_info.json', 'draft_content.json']),
    exportedAt: z.string(),
    capshareVersion: z.string()
  }),
  project: z.object({
    durationUs: z.number(),
    fps: z.number().nullable(),
    canvas: z.object({ width: z.number(), height: z.number() }).nullable(),
    mediaCounts: z.object({ video: z.number(), audio: z.number(), image: z.number() }),
    tracks: z.array(trackSummarySchema)
  }),
  contents: z.object({
    includesCaches: z.boolean(),
    fileCount: z.number().int().nonnegative().safe(),
    totalBytes: z.number().int().nonnegative().safe()
  }),
  /** Media that lived outside the draft folder on the source machine. */
  looseMedia: z.array(
    z.object({
      /** Entry name inside the archive (under assets/loose/). */
      archivePath: z.string(),
      /** The exact string as it appeared in the draft JSON (forward slashes). */
      originalPath: z.string(),
      fileName: z.string(),
      size: z.number().int().nonnegative().safe(),
      sha256: z.string().regex(/^[a-f0-9]{64}$/i)
    })
  ),
  /** Effect-cache files bundled for offline-exact import. */
  effectAssets: z.array(
    z.object({
      archivePath: z.string(),
      /** Path under <User Data>/Cache/, e.g. "effect/123/ab". */
      cacheSuffix: z.string(),
      size: z.number().int().nonnegative().safe(),
      sha256: z
        .string()
        .regex(/^[a-f0-9]{64}$/i)
        .optional()
    })
  ),
  /** sha256 + size per draft/ entry (relative path inside the draft). */
  integrity: z.record(
    z.string(),
    z.object({
      size: z.number().int().nonnegative().safe(),
      sha256: z.string().regex(/^[a-f0-9]{64}$/i)
    })
  ),
  missingAtExport: z.array(z.string()),
  resolvedSources: z
    .array(
      z.object({
        originalPath: z.string(),
        resolvedPath: z.string(),
        reason: z.literal('explicit-user-confirmation')
      })
    )
    .optional(),
  warnings: z.array(z.string())
})

export type CapShareManifest = z.infer<typeof manifestSchema>

export function parseManifest(raw: string): CapShareManifest {
  const json = JSON.parse(raw) as unknown
  const result = manifestSchema.safeParse(json)
  if (!result.success) {
    throw new Error(`Invalid .capshare manifest: ${result.error.issues[0]?.message ?? 'unknown'}`)
  }
  if (result.data.formatVersion > CAPSHARE_FORMAT_VERSION) {
    throw new Error(
      `This .capshare file uses format v${result.data.formatVersion}; this build of CapShare supports up to v${CAPSHARE_FORMAT_VERSION}. Please update CapShare.`
    )
  }
  const entries = new Set<string>()
  const declare = (path: string): void => {
    validateArchivePath(path)
    const key = archivePathKey(path)
    if (entries.has(key)) throw new Error('Duplicate manifest payload')
    entries.add(key)
  }
  for (const path of Object.keys(result.data.integrity)) {
    validateArchivePath(path)
    declare(DRAFT_ENTRY_PREFIX + path)
  }
  for (const file of result.data.looseMedia) {
    if (!file.archivePath.startsWith(LOOSE_MEDIA_PREFIX))
      throw new Error('Invalid loose-media namespace')
    declare(file.archivePath)
  }
  for (const file of result.data.effectAssets) {
    validateArchivePath(file.cacheSuffix)
    if (file.archivePath !== EFFECT_ASSET_PREFIX + file.cacheSuffix)
      throw new Error('Invalid effect-cache mapping')
    declare(file.archivePath)
  }
  return result.data
}
