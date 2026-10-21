import {
  assertExportResource,
  assertRelativeResource,
  isExternalResource
} from '../reference-policy'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, rename, rm, stat } from 'node:fs/promises'
import { basename, join, resolve, sep } from 'node:path'
import type { ExportResult } from '../../../shared/types'
import {
  DRAFT_META_FILENAME,
  JUNK_FILE_NAMES,
  REGENERABLE_DIRS,
  TIMELINE_FILENAMES,
  VOLATILE_FILE_PATTERNS
} from '../capcut/constants'
import { asString, findTimelinePath, getPlatformBlock, summarizeTimeline } from '../capcut/draft'
import { readProjectDocuments, validateTimelineGraph } from '../capcut/project'
import { toJsonPath } from '../capcut/locator'
import type { CapCutEnv } from '../capcut/model'
import { collectPaths } from '../capcut/scanner'
import { CapShareError } from '../errors'
import { sanitizeFolderName, walkFiles } from '../fsx'
import { ZipWriter } from '../zip'
import {
  CAPSHARE_FORMAT_VERSION,
  COVER_ENTRY_NAME,
  DRAFT_ENTRY_PREFIX,
  EFFECT_ASSET_PREFIX,
  LOOSE_MEDIA_PREFIX,
  MANIFEST_ENTRY_NAME,
  type CapShareManifest
} from './manifest'

export interface ExportDraftOptions {
  draftFolder: string
  env: CapCutEnv
  destinationPath: string
  includeCaches: boolean
  capshareVersion: string
  onProgress?: (processedBytes: number, totalBytes: number, phase: string) => void
  signal?: AbortSignal
  /** Injectable clock for deterministic tests. */
  now?: () => Date
  /** Explicit user-approved replacements for already-missing source paths. */
  sourceOverrides?: Record<string, string>
}

interface LoosePlan {
  archivePath: string
  originalPath: string
  fileName: string
  diskPath: string
  size: number
}

interface EffectPlan {
  archivePath: string
  cacheSuffix: string
  diskPath: string
  size: number
}

/**
 * Exports a draft folder into a single .capshare archive.
 *
 * All working project documents are snapshotted up front and checked again
 * before publication. A concurrent save aborts export, preserving any previous
 * destination archive.
 */
export async function exportDraft(options: ExportDraftOptions): Promise<ExportResult> {
  const { draftFolder, env, destinationPath, includeCaches, signal } = options
  const warnings: string[] = []
  const missingAtExport: string[] = []
  const overrides = new Map(
    Object.entries(options.sourceOverrides ?? {}).map(([from, to]) => [
      from.replace(/\\/g, '/').toLowerCase(),
      to
    ])
  )
  if (resolve(destinationPath).startsWith(resolve(draftFolder) + sep)) {
    throw new CapShareError(
      'EXPORT_FAILED',
      'Choose an export destination outside the source project.'
    )
  }

  const paths = findTimelinePath(draftFolder)
  if (!paths) {
    throw new CapShareError('DRAFT_NOT_FOUND', `No CapCut timeline found in ${draftFolder}`)
  }

  const documents = await readProjectDocuments(draftFolder)
  const graph = validateTimelineGraph(documents)
  const timelineRaw =
    documents.get(paths.timelineFilename)?.raw ?? (await readFile(paths.timelinePath))
  let timeline: Record<string, unknown>
  try {
    timeline = JSON.parse(timelineRaw.toString('utf8')) as Record<string, unknown>
  } catch {
    throw new CapShareError(
      'DRAFT_ENCRYPTED',
      'The project file is not plain JSON — cannot export this draft.'
    )
  }

  let metaRaw: Buffer | null = null
  let meta: Record<string, unknown> | null = null
  if (existsSync(paths.metaPath)) {
    metaRaw = documents.get(DRAFT_META_FILENAME)?.raw ?? (await readFile(paths.metaPath))
    try {
      meta = JSON.parse(metaRaw.toString('utf8')) as Record<string, unknown>
    } catch {
      meta = null
    }
  }

  const draftFolderJson = toJsonPath(draftFolder)
  const scanned = [...documents.values()].flatMap((doc) =>
    collectPaths(doc.value, { draftFolderJson }).map((item) => ({
      ...item,
      document: doc.relativePath
    }))
  )

  const effectPlans = new Map<string, EffectPlan>()
  const effectRootsSeen = new Set<string>()
  const loosePlans = new Map<string, LoosePlan>()
  const missingSeen = new Set<string>()
  let looseIndex = 0

  for (const item of scanned) {
    // Provenance-only fields: where media was imported FROM originally. The
    // copies already live in Resources/local — bundling these would duplicate
    // gigabytes and rewrite fields CapCut treats as informational.
    if (
      item.pointer.includes('draft_materials_copied_info') ||
      /\/(?:draft_fold_path|draft_root_path)$/.test(item.pointer)
    )
      continue

    if (item.cls === 'effect-cache' && item.cacheSuffix) {
      assertRelativeResource(item.cacheSuffix)
      if (effectRootsSeen.has(item.cacheSuffix)) continue
      effectRootsSeen.add(item.cacheSuffix)
      // Resolve via this machine's cache dir first (spelling-independent),
      // falling back to the literal path.
      const candidates = [join(env.cacheDir, ...item.cacheSuffix.split('/')), item.normalized]
      const diskPath = candidates.find((p) => existsSync(p))
      if (diskPath) {
        const info = await stat(diskPath)
        if (info.isFile()) {
          effectPlans.set(item.cacheSuffix, {
            archivePath: `${EFFECT_ASSET_PREFIX}${item.cacheSuffix}`,
            cacheSuffix: item.cacheSuffix,
            diskPath,
            size: info.size
          })
        } else if (info.isDirectory()) {
          for await (const file of walkFiles(diskPath)) {
            const suffix = `${item.cacheSuffix}/${file.relPath}`
            effectPlans.set(suffix, {
              archivePath: EFFECT_ASSET_PREFIX + suffix,
              cacheSuffix: suffix,
              diskPath: file.absPath,
              size: file.size
            })
          }
        }
      } else {
        warnings.push(
          `Effect asset not in local cache (CapCut will re-download it): ${item.cacheSuffix}`
        )
      }
      continue
    }
    if (item.cls === 'absolute' || item.cls === 'unc') {
      if (!isExternalResource(item.normalized, item.pointer)) continue
      assertExportResource(item.normalized)
      const key = item.normalized.toLowerCase()
      if (loosePlans.has(key)) continue
      const override = overrides.get(key)
      if (override && existsSync(item.normalized)) {
        throw new CapShareError(
          'EXPORT_FAILED',
          `An override cannot replace a source that still exists: ${item.normalized}`
        )
      }
      const sourcePath = override ?? item.normalized
      assertExportResource(sourcePath)
      // Only fs-verified files are bundled — classifier hits alone never act.
      if (existsSync(sourcePath)) {
        const info = await stat(sourcePath)
        if (info.isFile()) {
          const fileName = basename(item.normalized)
          looseIndex++
          loosePlans.set(key, {
            archivePath: `${LOOSE_MEDIA_PREFIX}${looseIndex}-${sanitizeFolderName(fileName, 'windows')}`,
            originalPath: item.normalized,
            fileName,
            diskPath: sourcePath,
            size: info.size
          })
        }
      } else if (/\.[A-Za-z0-9]{1,12}$/.test(item.normalized) && !missingSeen.has(key)) {
        missingSeen.add(key)
        missingAtExport.push(item.normalized)
      }
    }
  }

  const timelineNames = new Set<string>(TIMELINE_FILENAMES)
  const leanSkips = new Set<string>(REGENERABLE_DIRS)
  const skip = (relPath: string, isDir: boolean): boolean => {
    if (isDir) {
      return !includeCaches && leanSkips.has(relPath)
    }
    const base = relPath.split('/').pop() ?? relPath
    if (JUNK_FILE_NAMES.has(base)) return true
    const modernTemplate = graph && /^template(-\d+)?\.tmp$/i.test(base)
    if (!modernTemplate && VOLATILE_FILE_PATTERNS.some((re) => re.test(base))) return true
    if (relPath === DRAFT_META_FILENAME) return true
    if (timelineNames.has(relPath)) return true
    return false
  }

  const draftFiles: { absPath: string; relPath: string; size: number; mtimeMs: number }[] = []
  for await (const file of walkFiles(draftFolder, { skip })) {
    draftFiles.push(file)
  }

  let coverBuffer: Buffer | null = null
  if (paths.coverPath) {
    coverBuffer = await readFile(paths.coverPath)
  }

  const totalBytes =
    timelineRaw.length +
    (metaRaw?.length ?? 0) +
    draftFiles.reduce((sum, f) => sum + f.size, 0) +
    [...effectPlans.values()].reduce((sum, e) => sum + e.size, 0) +
    [...loosePlans.values()].reduce((sum, l) => sum + l.size, 0) +
    (coverBuffer?.length ?? 0)

  const externalStates = new Map<string, { size: number; mtimeMs: number }>()
  for (const file of [...effectPlans.values(), ...loosePlans.values()]) {
    const info = await stat(file.diskPath)
    externalStates.set(file.diskPath, { size: info.size, mtimeMs: info.mtimeMs })
  }

  let processed = 0
  const onBytes = (n: number): void => {
    processed += n
    options.onProgress?.(processed, totalBytes, 'archive')
  }

  const temporaryPath = destinationPath + '.' + randomUUID() + '.partial'
  const writer = new ZipWriter(temporaryPath, onBytes)
  const integrity: CapShareManifest['integrity'] = {}
  const effectHashes = new Map<string, string>()
  let fileCount = 0

  try {
    const timelineEntry = await writer.add(
      {
        kind: 'file',
        absPath: paths.timelinePath,
        snapshot: timelineRaw,
        zipPath: `${DRAFT_ENTRY_PREFIX}${paths.timelineFilename}`
      },
      signal
    )
    integrity[paths.timelineFilename] = { size: timelineEntry.size, sha256: timelineEntry.sha256 }
    fileCount++

    if (metaRaw) {
      const metaEntry = await writer.add(
        {
          kind: 'file',
          absPath: paths.metaPath,
          snapshot: metaRaw,
          zipPath: `${DRAFT_ENTRY_PREFIX}${DRAFT_META_FILENAME}`
        },
        signal
      )
      integrity[DRAFT_META_FILENAME] = { size: metaEntry.size, sha256: metaEntry.sha256 }
      fileCount++
    }

    for (const file of draftFiles) {
      const entry = await writer.add(
        {
          kind: 'file',
          absPath: file.absPath,
          snapshot: documents.get(file.relPath)?.raw,
          zipPath: `${DRAFT_ENTRY_PREFIX}${file.relPath}`
        },
        signal
      )
      integrity[file.relPath] = { size: entry.size, sha256: entry.sha256 }
      fileCount++
    }

    for (const effect of effectPlans.values()) {
      const entry = await writer.add(
        { kind: 'file', absPath: effect.diskPath, zipPath: effect.archivePath },
        signal
      )
      effect.size = entry.size
      effectHashes.set(effect.cacheSuffix, entry.sha256)
      fileCount++
    }

    const looseManifest: CapShareManifest['looseMedia'] = []
    for (const loose of loosePlans.values()) {
      const entry = await writer.add(
        { kind: 'file', absPath: loose.diskPath, zipPath: loose.archivePath },
        signal
      )
      looseManifest.push({
        archivePath: loose.archivePath,
        originalPath: loose.originalPath,
        fileName: loose.fileName,
        size: entry.size,
        sha256: entry.sha256
      })
      fileCount++
    }

    if (coverBuffer) {
      await writer.add({ kind: 'buffer', data: coverBuffer, zipPath: COVER_ENTRY_NAME }, signal)
      fileCount++
    }

    // Consistency check: CapCut may have saved while we streamed media.
    const documentsNow = await readProjectDocuments(draftFolder)
    const digest = (data: Buffer): string => createHash('sha256').update(data).digest('hex')
    if (
      documentsNow.size !== documents.size ||
      [...documents].some(
        ([key, doc]) =>
          !documentsNow.has(key) || digest(doc.raw) !== digest(documentsNow.get(key)!.raw)
      )
    ) {
      throw new CapShareError(
        'EXPORT_CHANGED_DURING',
        'CapCut saved changes during export. The incomplete package was discarded; export again after saving has finished.'
      )
    }
    const filesNow: typeof draftFiles = []
    for await (const file of walkFiles(draftFolder, { skip })) filesNow.push(file)
    if (
      filesNow.length !== draftFiles.length ||
      filesNow.some(
        (file, i) =>
          file.relPath !== draftFiles[i].relPath ||
          file.size !== draftFiles[i].size ||
          file.mtimeMs !== draftFiles[i].mtimeMs
      )
    ) {
      throw new CapShareError(
        'EXPORT_CHANGED_DURING',
        'Project resources changed during export; the incomplete package was discarded.'
      )
    }
    for (const [path, before] of externalStates) {
      const after = await stat(path)
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
        throw new CapShareError(
          'EXPORT_CHANGED_DURING',
          `External resource changed during export: ${path}`
        )
      }
    }

    const platform =
      getPlatformBlock(timeline) ?? getPlatformBlock(timeline, 'last_modified_platform')
    const project = summarizeTimeline(timeline)
    const manifest: CapShareManifest = {
      formatVersion: CAPSHARE_FORMAT_VERSION,
      source: {
        os: env.os,
        capcutVersion: platform ? (asString(platform.app_version) ?? null) : null,
        newVersion: asString(timeline['new_version']),
        draftId:
          (meta && asString(meta['draft_id'])) ?? asString(timeline['id']) ?? 'unknown-draft-id',
        timelineId: asString(timeline['id']),
        draftName: (meta && asString(meta['draft_name'])) ?? basename(draftFolder),
        timelineFilename: paths.timelineFilename,
        exportedAt: (options.now?.() ?? new Date()).toISOString(),
        capshareVersion: options.capshareVersion
      },
      project: {
        durationUs: project.durationUs,
        fps: project.fps,
        canvas: project.canvas,
        mediaCounts: project.mediaCounts,
        tracks: project.tracks
      },
      contents: { includesCaches: includeCaches, fileCount, totalBytes },
      looseMedia: looseManifest,
      effectAssets: [...effectPlans.values()].map((e) => ({
        archivePath: e.archivePath,
        cacheSuffix: e.cacheSuffix,
        size: e.size,
        sha256: effectHashes.get(e.cacheSuffix)
      })),
      integrity,
      missingAtExport,
      warnings
    }
    if (overrides.size)
      manifest.resolvedSources = Object.entries(options.sourceOverrides ?? {}).map(
        ([originalPath, resolvedPath]) => ({
          originalPath,
          resolvedPath,
          reason: 'explicit-user-confirmation'
        })
      )

    await writer.add(
      {
        kind: 'buffer',
        data: Buffer.from(JSON.stringify(manifest, null, 2)),
        zipPath: MANIFEST_ENTRY_NAME,
        uncounted: true
      },
      signal
    )
    await writer.finish()
    await rename(temporaryPath, destinationPath)
  } catch (error) {
    await writer.abort()
    await rm(temporaryPath, { force: true })
    throw CapShareError.wrap(error, 'EXPORT_FAILED')
  }

  const outStat = await stat(destinationPath)
  for (const missing of missingAtExport) {
    warnings.push(`Media file referenced by the project was missing at export: ${missing}`)
  }

  return {
    capsharePath: destinationPath,
    sizeBytes: outStat.size,
    fileCount,
    warnings
  }
}
