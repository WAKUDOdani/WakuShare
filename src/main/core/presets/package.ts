import { createHash, randomUUID } from 'node:crypto'
import { constants, existsSync } from 'node:fs'
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile
} from 'node:fs/promises'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'
import { z } from 'zod'
import type {
  PresetLibrary,
  PresetTransferResult,
  PresetImportOptions,
  PresetImportReview
} from '../../../shared/types'
import { presetFingerprint, fingerprintDocument, legacyPresetTarget } from './fingerprint'
import { placeFolders } from './placement'
import { DRAFT_PATH_PLACEHOLDER } from '../capcut/constants'
import type { CapCutEnv } from '../capcut/model'
import { classifyString, walkJsonStrings } from '../capcut/scanner'
import { CapShareError } from '../errors'
import { atomicWriteFile, hashFile, sanitizeFolderName, uniqueName } from '../fsx'
import type { WalkedFile } from '../fsx'
import { extractZip, readZipEntries, ZipWriter } from '../zip'
import {
  nativeGroups,
  object,
  readLibrary,
  selectNodes,
  STORE_PATH,
  validateNodes
} from './library'

const nodeSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(['preset', 'folder']),
  parentId: z.string().nullable()
})
const manifestSchema = z.object({
  format: z.literal('wakushare-presets'),
  version: z.literal(1),
  nodes: z.array(nodeSchema),
  records: z.record(z.string(), z.record(z.string(), z.unknown())),
  storage: z.record(z.string(), z.object({ metadata: z.string() })),
  files: z.array(
    z.object({
      entry: z.string(),
      kind: z.enum(['preset', 'asset', 'effect']),
      owners: z.array(z.string()),
      size: z.number().int().nonnegative(),
      sha256: z.string().regex(/^[a-f0-9]{64}$/)
    })
  ),
  references: z.array(
    z.object({
      owner: z.string(),
      from: z.string(),
      target: z.string(),
      kind: z.enum(['preset', 'asset', 'effect'])
    })
  ),
  warnings: z.array(z.string())
})
export type Manifest = z.infer<typeof manifestSchema>
interface FilePlan {
  entry: string
  disk: string
  kind: 'preset' | 'asset' | 'effect'
  owners: Set<string>
  snapshot?: Buffer
  stamp: string
}
interface Options {
  signal?: AbortSignal
  onProgress?: (processed: number, total: number, phase: string) => void
  /** Replacements explicitly selected by the user; never inferred from a filename. */
  sourceOverrides?: Record<string, string>
  beforeCommit?: () => Promise<void>
  importOptions?: PresetImportOptions
  reviewToken?: string
  onComparisonFailure?: (id: string, error: unknown) => void
  onFingerprint?: (key: string, canonical: unknown) => void
}
const jsonPath = (path: string): string => path.replace(/\\/g, '/')
const MEDIA_EXTENSION =
  /\.(?:mp4|mov|mkv|avi|webm|m4v|mpg|mpeg|wav|mp3|m4a|aac|flac|ogg|aif|aiff|wma|opus|png|jpe?g|webp|gif|bmp|tiff?|heic|avif|svg|ttf|otf|ttc|woff2?)$/i
function mediaName(original: string, names: Set<string>): string {
  original = sanitizeFolderName(original, 'windows')
  const extension = extname(original),
    stem = original.slice(0, original.length - extension.length)
  let name = original,
    number = 2
  while (names.has(name.toLowerCase())) name = `${stem} (${number++})${extension}`
  names.add(name.toLowerCase())
  return name
}
const key = (path: string): string => jsonPath(resolve(path)).toLowerCase()
const safe = (path: string): boolean =>
  !!path &&
  !path.includes('\\') &&
  !path.includes(':') &&
  !path.startsWith('/') &&
  path
    .split('/')
    .every(
      (part) =>
        !!part &&
        part !== '.' &&
        part !== '..' &&
        ![...part].some((char) => char.charCodeAt(0) < 32)
    )
const stamp = async (path: string): Promise<string> => {
  const s = await stat(path)
  return `${s.size}/${s.mtimeMs}`
}
const checkCancel = (signal?: AbortSignal): void => {
  if (signal?.aborted) throw new CapShareError('CANCELLED', 'Operation cancelled')
}

/** An unreadable file or symlink must not silently disappear from a preset backup. */
async function* walkFiles(root: string, base = root): AsyncGenerator<WalkedFile> {
  for (const name of (await readdir(root)).sort()) {
    const path = join(root, name),
      info = await lstat(path)
    if (info.isSymbolicLink())
      throw new CapShareError('EXPORT_FAILED', `Linked preset resources are not supported: ${path}`)
    if (info.isDirectory()) yield* walkFiles(path, base)
    else if (info.isFile())
      yield {
        absPath: path,
        relPath: jsonPath(relative(base, path)),
        size: info.size,
        mtimeMs: info.mtimeMs
      }
  }
}

async function inventory(root: string): Promise<string> {
  const files: string[] = []
  for await (const file of walkFiles(root))
    files.push(`${file.relPath}:${file.size}:${file.mtimeMs}`)
  return files.join('\n')
}

const isDocument = (path: string): boolean =>
  /\.json$|(?:^|\/)template(?:-\d+)?\.tmp$/i.test(jsonPath(path))

function parseDocument(path: string, raw: Buffer): unknown | null {
  if (!isDocument(path) || raw.length === 0) return null
  try {
    return JSON.parse(raw.toString('utf8').replace(/^\uFEFF/, ''))
  } catch {
    throw new CapShareError('DRAFT_UNREADABLE', `Cannot inspect preset document: ${basename(path)}`)
  }
}

function validateManifest(manifest: Manifest): void {
  validateNodes(manifest.nodes)
  const ids = new Set(manifest.nodes.map((node) => node.id)),
    entries = new Set<string>()
  for (const node of manifest.nodes) {
    if (!manifest.records[node.id] || manifest.records[node.id]['id'] !== node.id)
      throw new CapShareError('ARCHIVE_INVALID', 'Preset catalog record mismatch')
    if (manifest.records[node.id]['type'] !== (node.kind === 'preset' ? 1 : 0))
      throw new CapShareError('ARCHIVE_INVALID', 'Preset catalog type mismatch')
    const storage = manifest.storage[node.id]
    if (
      node.kind === 'preset' &&
      (!storage || !safe(storage.metadata) || storage.metadata.includes('/'))
    )
      throw new CapShareError('ARCHIVE_INVALID', 'Invalid preset storage')
  }
  for (const file of manifest.files) {
    if (
      !safe(file.entry) ||
      entries.has(file.entry.toLowerCase()) ||
      !file.owners.length ||
      file.owners.some((id) => !ids.has(id))
    )
      throw new CapShareError('ARCHIVE_INVALID', 'Invalid or duplicate preset file')
    if (file.kind === 'preset' && !file.entry.startsWith('payload/'))
      throw new CapShareError('ARCHIVE_INVALID', 'Invalid preset payload')
    if (file.kind === 'preset') {
      const owner = file.entry.split('/')[1]
      if (
        !file.entry.split('/')[2] ||
        manifest.nodes.find((node) => node.id === owner)?.kind !== 'preset' ||
        file.owners.length !== 1 ||
        file.owners[0] !== owner
      )
        throw new CapShareError('ARCHIVE_INVALID', 'Preset payload owner mismatch')
    }
    if (
      file.kind !== 'preset' &&
      !file.entry.startsWith('assets/') &&
      !(file.kind === 'asset' && file.entry.startsWith('Исходники/'))
    )
      throw new CapShareError('ARCHIVE_INVALID', 'Invalid preset dependency')
    entries.add(file.entry.toLowerCase())
  }
  for (const node of manifest.nodes.filter((node) => node.kind === 'preset')) {
    if (
      !manifest.files.some(
        (file) =>
          file.entry === `payload/${node.id}/${manifest.storage[node.id].metadata}` &&
          file.owners.includes(node.id)
      )
    )
      throw new CapShareError('ARCHIVE_INVALID', 'Preset metadata is missing')
  }
  for (const ref of manifest.references) {
    if (
      !ids.has(ref.owner) ||
      !safe(ref.target) ||
      !manifest.files.some(
        (file) =>
          file.owners.includes(ref.owner) &&
          file.kind === ref.kind &&
          (file.entry === ref.target || file.entry.startsWith(ref.target + '/'))
      )
    )
      throw new CapShareError('ARCHIVE_INVALID', 'Invalid preset resource reference')
  }
}

export async function inspectPresetPackage(
  path: string
): Promise<{ manifest: Manifest; view: PresetLibrary }> {
  const raw = (await readZipEntries(path, ['manifest.json'])).get('manifest.json')
  if (!raw || raw.length > 20 * 1024 * 1024)
    throw new CapShareError('ARCHIVE_INVALID', 'Not a WakuShare preset package')
  const manifest = manifestSchema.parse(JSON.parse(raw.toString('utf8')))
  validateManifest(manifest)
  return { manifest, view: { root: path, nodes: manifest.nodes, warnings: manifest.warnings } }
}

async function buildPresetPlan(
  root: string,
  selection: string[],
  env: CapCutEnv,
  options: Options = {}
): Promise<{
  manifest: Manifest
  plans: FilePlan[]
  library: Awaited<ReturnType<typeof readLibrary>>
  directoryStamps: Map<string, string>
}> {
  root = resolve(root)
  const library = await readLibrary(root)
  const overrides = new Map(
    Object.entries(options.sourceOverrides ?? {}).map(([from, to]) => [
      jsonPath(from).toLowerCase(),
      to
    ])
  )
  const nodes = selectNodes(library.view.nodes, selection)
  const manifest: Manifest = {
    format: 'wakushare-presets',
    version: 1,
    nodes,
    records: Object.fromEntries(nodes.map((node) => [node.id, library.records.get(node.id)!])),
    storage: {},
    files: [],
    references: [],
    warnings: [...library.view.warnings]
  }
  const plans: FilePlan[] = [],
    documents: { owner: string; path: string; value: unknown; contextRoot: string }[] = []
  const queuedDocuments = new Set<string>()
  const enqueueDocument = async (
    plan: FilePlan,
    owner: string,
    contextRoot: string
  ): Promise<void> => {
    const documentKey = owner + ':' + plan.entry
    if (queuedDocuments.has(documentKey) || plan.kind === 'effect') return
    queuedDocuments.add(documentKey)
    if (!isDocument(plan.entry)) return
    plan.snapshot ??= await readFile(plan.disk)
    const value = parseDocument(plan.entry, plan.snapshot)
    if (value !== null) documents.push({ owner, path: plan.disk, value, contextRoot })
  }
  const directoryStamps = new Map<string, string>()
  const assetRoots = new Map<
    string,
    { entry: string; plans: FilePlan[]; kind: 'asset' | 'effect' }
  >()
  const missing = new Set<string>()
  const mediaArchiveNames = new Set<string>()
  const missingReferences: { owner: string; path: string }[] = []
  for (const node of nodes.filter((node) => node.kind === 'preset')) {
    const storage = library.storage.get(node.id)!
    if (existsSync(join(storage.directory, 'preset_draft/Timelines/project.json')))
      throw new CapShareError(
        'EXPORT_FAILED',
        'Multi-timeline preset storage needs a compatibility check before transfer'
      )
    manifest.storage[node.id] = { metadata: storage.metadata }
    directoryStamps.set(storage.directory, await inventory(storage.directory))
    for await (const file of walkFiles(storage.directory)) {
      const entry = `payload/${node.id}/${file.relPath}`
      const plan: FilePlan = {
        entry,
        disk: file.absPath,
        kind: 'preset',
        owners: new Set([node.id]),
        stamp: await stamp(file.absPath)
      }
      plans.push(plan)
      await enqueueDocument(plan, node.id, join(storage.directory, 'preset_draft'))
    }
  }
  for (const document of documents) {
    const found: { value: string; pointer: string }[] = []
    walkJsonStrings(document.value, (value, pointer) => {
      found.push({ value, pointer })
      return undefined
    })
    const ownerFolder = library.storage.get(document.owner)!.directory
    for (const ref of found) {
      checkCancel(options.signal)
      if (!ref.value || ref.pointer.includes('draft_materials_copied_info')) continue
      const cls = classifyString(ref.value)
      const presetPlaceholder = /^##_presetpath_placeholder_[0-9a-f-]+_##[/\\]/i.exec(ref.value)
      if (
        cls.cls !== 'absolute' &&
        cls.cls !== 'unc' &&
        cls.cls !== 'effect-cache' &&
        cls.cls !== 'placeholder' &&
        !presetPlaceholder
      )
        continue
      let disk = ref.value
      if (presetPlaceholder)
        disk = join(root, 'Combination', ref.value.slice(presetPlaceholder[0].length))
      if (cls.cls === 'placeholder')
        disk = join(
          document.contextRoot,
          ref.value.slice(DRAFT_PATH_PLACEHOLDER.length).replace(/^[/\\]+/, '')
        )
      if (cls.cls === 'effect-cache' && cls.cacheSuffix) {
        const cached = join(env.cacheDir, ...cls.cacheSuffix.split('/'))
        if (existsSync(cached)) disk = cached
      }
      if (!existsSync(disk)) {
        const logical = /(?:^|\/)Presets\/(Combination\/.+)$/i.exec(
          jsonPath(disk).replace(/\/+/g, '/')
        )
        if (logical && existsSync(join(root, logical[1]))) disk = join(root, logical[1])
      }
      if (!existsSync(disk)) disk = overrides.get(jsonPath(ref.value).toLowerCase()) ?? disk
      if (!existsSync(disk)) {
        missing.add(ref.value)
        if (
          !missingReferences.some(
            (item) => item.owner === document.owner && item.path === ref.value
          )
        )
          missingReferences.push({ owner: document.owner, path: ref.value })
        continue
      }
      let target: string, kind: 'preset' | 'asset' | 'effect'
      const inside = key(disk) === key(ownerFolder) || key(disk).startsWith(key(ownerFolder) + '/')
      if (inside) {
        const rel = jsonPath(relative(ownerFolder, resolve(disk)))
        target = `payload/${document.owner}${rel ? '/' + rel : ''}`
        kind = 'preset'
      } else {
        const rootKey = key(disk)
        let asset = assetRoots.get(rootKey)
        if (!asset) {
          const entry = `assets/${assetRoots.size + 1}`
          kind =
            cls.cls === 'effect-cache' || key(disk).startsWith(key(env.cacheDir) + '/')
              ? 'effect'
              : 'asset'
          const list: FilePlan[] = []
          const info = await stat(disk)
          if (info.isDirectory()) {
            directoryStamps.set(disk, await inventory(disk))
            for await (const file of walkFiles(disk))
              list.push({
                entry: `${entry}/${file.relPath}`,
                disk: file.absPath,
                kind,
                owners: new Set(),
                stamp: await stamp(file.absPath)
              })
          } else
            list.push({
              entry:
                kind === 'asset' && MEDIA_EXTENSION.test(disk)
                  ? `Исходники/${mediaName(basename(disk), mediaArchiveNames)}`
                  : `${entry}/${basename(disk)}`,
              disk,
              kind,
              owners: new Set(),
              stamp: await stamp(disk)
            })
          if (!list.length)
            throw new CapShareError('EXPORT_FAILED', `Preset resource is empty: ${disk}`)
          asset = { entry: info.isDirectory() ? entry : list[0].entry, plans: list, kind }
          assetRoots.set(rootKey, asset)
          plans.push(...list)
        }
        for (const file of asset.plans) {
          file.owners.add(document.owner)
          await enqueueDocument(file, document.owner, dirname(file.disk))
        }
        target = asset.entry
        kind = asset.kind
      }
      if (
        !manifest.references.some(
          (item) => item.owner === document.owner && item.from === ref.value
        )
      )
        manifest.references.push({ owner: document.owner, from: ref.value, target, kind })
    }
  }
  if (missing.size)
    throw new CapShareError(
      'EXPORT_FAILED',
      `Preset dependency is missing (${missing.size} file(s)). Locate the source files and export again.`,
      JSON.stringify({ missingPaths: [...missing], missingReferences })
    )
  return { manifest, plans, library, directoryStamps }
}

export async function exportPresets(
  root: string,
  selection: string[],
  destination: string,
  env: CapCutEnv,
  options: Options = {}
): Promise<PresetTransferResult> {
  root = resolve(root)
  destination = resolve(destination)
  if (key(destination).startsWith(key(root) + '/'))
    throw new CapShareError('EXPORT_FAILED', 'Save the package outside the preset library')
  const { manifest, plans, library, directoryStamps } = await buildPresetPlan(
    root,
    selection,
    env,
    options
  )
  const nodes = manifest.nodes
  const temporary = destination + '.' + randomUUID() + '.partial'
  let processed = 0
  const total = (await Promise.all(plans.map(async (plan) => (await stat(plan.disk)).size))).reduce(
    (sum, size) => sum + size,
    0
  )
  const zip = new ZipWriter(temporary, (count) => {
    processed += count
    options.onProgress?.(processed, total, 'Exporting presets')
  })
  try {
    for (const plan of plans) {
      const added = await zip.add(
        { kind: 'file', absPath: plan.disk, zipPath: plan.entry, snapshot: plan.snapshot },
        options.signal
      )
      manifest.files.push({
        entry: plan.entry,
        kind: plan.kind,
        owners: [...plan.owners],
        size: added.size,
        sha256: added.sha256
      })
    }
    validateManifest(manifest)
    await zip.add({
      kind: 'buffer',
      zipPath: 'manifest.json',
      data: Buffer.from(JSON.stringify(manifest)),
      uncounted: true
    })
    await zip.finish()
    const current = await readLibrary(root)
    if (!current.raw?.equals(library.raw ?? Buffer.alloc(0)))
      throw new CapShareError('EXPORT_CHANGED_DURING', 'Preset catalog changed during export')
    for (const [directory, before] of directoryStamps)
      if ((await inventory(directory)) !== before)
        throw new CapShareError('EXPORT_CHANGED_DURING', 'Preset files changed during export')
    for (const plan of plans) {
      if (
        (await stamp(plan.disk)) !== plan.stamp ||
        (plan.snapshot && !(await readFile(plan.disk)).equals(plan.snapshot))
      )
        throw new CapShareError('EXPORT_CHANGED_DURING', 'Preset dependency changed during export')
    }
    checkCancel(options.signal)
    await rename(temporary, destination)
  } catch (error) {
    await zip.abort()
    await rm(temporary, { force: true })
    throw error
  }
  return {
    path: destination,
    presets: nodes.filter((node) => node.kind === 'preset').length,
    folders: nodes.filter((node) => node.kind === 'folder').length,
    warnings: manifest.warnings
  }
}

const sha = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex')

export async function reviewPresetImport(
  path: string,
  selection: string[],
  root: string,
  env: CapCutEnv,
  importOptions: PresetImportOptions = {},
  options: Options = {}
): Promise<PresetImportReview> {
  const { manifest } = await inspectPresetPackage(path),
    nodes = selectNodes(manifest.nodes, selection)
  const library = await readLibrary(root),
    placement = placeFolders(nodes, library.view.nodes, importOptions)
  const owners = new Set(nodes.filter((node) => node.kind === 'preset').map((node) => node.id))
  const contents = await readZipEntries(
    path,
    manifest.files
      .filter(
        (file) =>
          file.kind !== 'effect' &&
          fingerprintDocument(file.entry) &&
          file.owners.some((id) => owners.has(id))
      )
      .map((file) => file.entry)
  )
  for (const [entry, raw] of contents)
    if (sha(raw) !== manifest.files.find((file) => file.entry === entry)!.sha256)
      throw new CapShareError('ARCHIVE_INVALID', 'Preset document checksum mismatch')
  const incoming = new Map(
    [...owners].map((id) => [
      id,
      presetFingerprint(manifest, id, contents, (value) =>
        options.onFingerprint?.('incoming-' + id, value)
      )
    ])
  )
  const existing: {
    id: string
    name: string
    location: string
    fingerprint: string
    revision: string
  }[] = []
  let unreadable = 0
  const hashCache = new Map<string, string>()
  for (const node of library.view.nodes.filter((node) => node.kind === 'preset')) {
    checkCancel(options.signal)
    try {
      const plan = await buildPresetPlan(root, [node.id], env, options)
      const documents = new Map<string, Buffer>(),
        revisions: string[] = []
      for (const file of plan.plans) {
        const cacheKey = file.disk + ':' + file.stamp
        let hash = file.snapshot ? sha(file.snapshot) : hashCache.get(cacheKey)
        if (!hash) {
          hash = await hashFile(file.disk)
          hashCache.set(cacheKey, hash)
        }
        const size = file.snapshot?.length ?? (await stat(file.disk)).size
        plan.manifest.files.push({
          entry: file.entry,
          kind: file.kind,
          owners: [...file.owners],
          size,
          sha256: hash
        })
        revisions.push(file.disk + ':' + hash)
        if (file.snapshot) documents.set(file.entry, file.snapshot)
      }
      const parts = [node.name]
      let parent = node.parentId
      while (parent) {
        const folder = library.view.nodes.find((item) => item.id === parent)!
        parts.unshift(folder.name)
        parent = folder.parentId
      }
      existing.push({
        id: node.id,
        name: node.name,
        location: parts.join(' / '),
        fingerprint: presetFingerprint(plan.manifest, node.id, documents, (value) =>
          options.onFingerprint?.('existing-' + node.id, value)
        ),
        revision: sha(JSON.stringify(revisions))
      })
    } catch (error) {
      if (options.signal?.aborted) throw error
      options.onComparisonFailure?.(node.id, error)
      unreadable++
    }
  }
  const latest = await readLibrary(root)
  if (library.raw ? !latest.raw?.equals(library.raw) : latest.raw !== null)
    throw new CapShareError(
      'IMPORT_FAILED',
      'Library changed while checking duplicates. Review again.'
    )
  const token = sha(
    JSON.stringify({
      archive: await hashFile(path),
      catalog: library.raw ? sha(library.raw) : null,
      selection: [...selection].sort(),
      target: importOptions.targetFolderId ?? null,
      wrapper: importOptions.newFolderName?.trim() ?? '',
      folders: importOptions.folderMode ?? 'merge',
      revisions: existing.map((item) => [item.id, item.revision])
    })
  )
  return {
    token,
    destination: root,
    folders: placement.folders,
    presets: [...owners].map((id) => ({
      sourceId: id,
      name: nodes.find((node) => node.id === id)!.name,
      matches: existing
        .filter((item) => item.fingerprint === incoming.get(id))
        .map(({ id, name, location }) => ({ id, name, location }))
    })),
    warnings: unreadable
      ? [
          `${unreadable} existing preset(s) could not be fully compared because their files or resources are unavailable. No replacements are suggested for them.`
        ]
      : []
  }
}

export async function importPresets(
  path: string,
  selection: string[],
  root: string,
  env: CapCutEnv,
  backupDir: string,
  options: Options = {}
): Promise<PresetTransferResult> {
  root = resolve(root)
  const { manifest } = await inspectPresetPackage(path)
  const allNodes = selectNodes(manifest.nodes, selection),
    allSelected = new Set(allNodes.map((node) => node.id))
  const importOptions = options.importOptions ?? { folderMode: 'copies' as const }
  const decisions = importOptions.duplicates ?? {}
  const review = options.reviewToken
    ? await reviewPresetImport(path, selection, root, env, importOptions, options)
    : null
  if (review && review.token !== options.reviewToken)
    throw new CapShareError(
      'IMPORT_FAILED',
      'The package or library changed. Review the import again.'
    )
  const replacementTargets = new Set<string>()
  for (const [id, decision] of Object.entries(decisions)) {
    if (!allNodes.some((node) => node.id === id && node.kind === 'preset'))
      throw new CapShareError('IMPORT_FAILED', 'Duplicate decision refers to an unselected preset')
    if (
      decision.action !== 'copy' &&
      (!review || !review.presets.find((item) => item.sourceId === id)?.matches.length)
    )
      throw new CapShareError(
        'IMPORT_FAILED',
        'A verified duplicate review is required before skipping or replacing presets'
      )
    if (decision.action === 'replace') {
      if (
        !decision.targetId ||
        !review!.presets
          .find((item) => item.sourceId === id)!
          .matches.some((item) => item.id === decision.targetId) ||
        replacementTargets.has(decision.targetId)
      )
        throw new CapShareError('IMPORT_FAILED', 'Choose a distinct verified replacement target')
      replacementTargets.add(decision.targetId)
    }
  }
  const neededFolders = new Set<string>()
  const includeParents = (id: string | null): void => {
    while (id) {
      neededFolders.add(id)
      id = allNodes.find((node) => node.id === id)!.parentId
    }
  }
  for (const node of allNodes) {
    if (
      (node.kind === 'preset' && (!decisions[node.id] || decisions[node.id].action === 'copy')) ||
      (node.kind === 'folder' && !manifest.nodes.some((child) => child.parentId === node.id))
    ) {
      if (node.kind === 'folder') neededFolders.add(node.id)
      includeParents(node.parentId)
    }
  }
  const nodes = allNodes.filter((node) =>
    node.kind === 'folder' ? neededFolders.has(node.id) : decisions[node.id]?.action !== 'skip'
  )
  const selected = new Set(nodes.map((node) => node.id))
  const files = manifest.files.filter((file) => file.owners.some((id) => selected.has(id)))
  const allFiles = manifest.files.filter((file) => file.owners.some((id) => allSelected.has(id)))
  const library = await readLibrary(root)
  const placement = placeFolders(
    nodes.filter((node) => decisions[node.id]?.action !== 'replace'),
    library.view.nodes,
    importOptions
  )
  const importId = randomUUID(),
    staging = join(root, '.wakushare-presets-' + importId)
  const presetParent = join(root, 'Combination/Presets')
  const assetRoot = join(root, 'Combination/Resources/WakuShare', importId)
  const effectRoot = join(env.cacheDir, 'WakuSharePresets', importId)
  const idMap = new Map(placement.ids)
  const names = new Set(library.view.nodes.map((node) => node.name))
  const takenDirectories = new Set(await readdir(presetParent).catch(() => []))
  const namesMap = new Map<string, string>()
  const folders = new Map<string, string>()
  const replacementDirectories = new Map<string, string>()
  const replacementInventories = new Map<string, string>()
  const mediaTargets = new Map<string, string>()
  const mediaNames = new Set<string>()
  for (const file of files) {
    if (file.kind !== 'asset' || !MEDIA_EXTENSION.test(file.entry)) continue
    // A directory resource keeps its internal layout and relative references.
    if (
      manifest.references.some(
        (ref) => ref.kind === 'asset' && file.entry.startsWith(ref.target + '/')
      )
    )
      continue
    const name = mediaName(basename(file.entry), mediaNames)
    mediaTargets.set(file.entry, join(assetRoot, 'Исходники', name))
  }
  for (const node of nodes) {
    if (node.kind === 'folder') {
      namesMap.set(node.id, placement.names.get(node.id)!)
      continue
    }
    const replaced =
      decisions[node.id]?.action === 'replace'
        ? library.view.nodes.find((item) => item.id === decisions[node.id].targetId)!
        : null
    const name = replaced ? replaced.name : uniqueName(node.name, names)
    idMap.set(node.id, replaced ? replaced.id : randomUUID().toUpperCase())
    names.add(name)
    namesMap.set(node.id, name)
    if (node.kind === 'preset') {
      const folder = replaced
        ? basename(library.storage.get(replaced.id)!.directory)
        : uniqueName(sanitizeFolderName(name, 'windows'), takenDirectories)
      takenDirectories.add(folder)
      folders.set(node.id, folder)
      if (replaced) {
        const directory = library.storage.get(replaced.id)!.directory
        replacementDirectories.set(node.id, join(staging, 'replacements', node.id))
        replacementInventories.set(node.id, await inventory(directory))
      }
    }
  }
  const targetFor = (entry: string, kind: 'preset' | 'asset' | 'effect'): string => {
    if (!safe(entry)) throw new CapShareError('ARCHIVE_INVALID', 'Unsafe preset path')
    if (kind !== 'preset')
      return (
        mediaTargets.get(entry) ??
        join(kind === 'effect' ? effectRoot : join(assetRoot, 'Служебные'), ...entry.split('/'))
      )
    const [, id, ...parts] = entry.split('/')
    if (!folders.has(id))
      throw new CapShareError('ARCHIVE_INVALID', 'Preset payload owner mismatch')
    if (parts.join('/') === manifest.storage[id].metadata)
      return join(presetParent, folders.get(id)!, folders.get(id)! + '.json')
    const oldStem = basename(manifest.storage[id].metadata, '.json')
    if (
      parts.length === 1 &&
      /\.(?:jpe?g|png)$/i.test(parts[0]) &&
      basename(parts[0], extname(parts[0])) === oldStem
    )
      return join(presetParent, folders.get(id)!, folders.get(id)! + extname(parts[0]))
    return join(presetParent, folders.get(id)!, ...parts)
  }
  const writeTargetFor = (entry: string, kind: 'preset' | 'asset' | 'effect'): string => {
    const target = targetFor(entry, kind),
      owner = entry.split('/')[1]
    return kind === 'preset' && replacementDirectories.has(owner)
      ? join(
          replacementDirectories.get(owner)!,
          relative(join(presetParent, folders.get(owner)!), target)
        )
      : target
  }
  const checkedWithin = (base: string, target: string): string => {
    if (!key(target).startsWith(key(base) + '/'))
      throw new CapShareError('IMPORT_FAILED', 'Preset transaction path escapes its directory')
    return resolve(target)
  }
  const owned: string[] = []
  const swaps: { original: string; rollback: string }[] = []
  let keepStaging = false
  let operationError: unknown
  let committed = false,
    backup: string | undefined
  await mkdir(root, { recursive: true })
  await mkdir(staging, { recursive: false })
  try {
    const entries = new Map(allFiles.map((file) => [file.entry, file]))
    const restoredEntries = new Set(files.map((file) => file.entry))
    const total = allFiles.reduce((sum, file) => sum + file.size, 0)
    let processed = 0
    await extractZip(path, staging, {
      signal: options.signal,
      mapEntry: (entry) => (entries.has(entry) ? entry : null),
      expected: (entry) => entries.get(entry),
      verifyOnly: (entry) => !restoredEntries.has(entry),
      onBytes: (count) => {
        processed += count
        options.onProgress?.(processed, total, 'Importing presets')
      }
    })
    for (const file of files)
      if (!existsSync(join(staging, file.entry)))
        throw new CapShareError('ARCHIVE_INVALID', 'Preset package is missing declared files')
    if (!nodes.length) {
      await options.beforeCommit?.()
      if (
        review &&
        (await reviewPresetImport(path, selection, root, env, importOptions, options)).token !==
          review.token
      )
        throw new CapShareError('IMPORT_FAILED', 'Library changed. Review again.')
      return {
        path: root,
        presets: 0,
        folders: 0,
        skipped: allNodes.filter((node) => node.kind === 'preset').length,
        replaced: 0,
        mergedFolders: 0,
        warnings: ['All selected duplicates were skipped. The library was not changed.']
      }
    }
    const transformed = new Map<string, Buffer>()
    const documentFiles = files.filter((file) => file.kind !== 'effect' && isDocument(file.entry))
    for (const file of documentFiles) {
      const source = join(staging, file.entry),
        raw = await readFile(source),
        value = parseDocument(file.entry, raw)
      if (value !== null) {
        const primaryId = object(value)['id']
        if (
          typeof primaryId === 'string' &&
          /(?:draft_content|draft_info)\.json$/.test(file.entry) &&
          !idMap.has(primaryId)
        )
          idMap.set(primaryId, randomUUID().toUpperCase())
      }
    }
    for (const file of documentFiles) {
      const raw = await readFile(join(staging, file.entry)),
        value = parseDocument(file.entry, raw)
      if (value === null) continue
      const owner =
        file.kind === 'preset'
          ? file.entry.split('/')[1]
          : file.owners.find((id) => selected.has(id))!
      const refs = manifest.references.filter((ref) => ref.owner === owner)
      const nativePaths: string[] = []
      walkJsonStrings(value, (current) => {
        if (current.startsWith('##_presetpath_placeholder_')) nativePaths.push(current)
        return undefined
      })
      if (
        nativePaths.some(
          (current) =>
            !refs.some((ref) => ref.from === current) &&
            !legacyPresetTarget(manifest, owner, current)
        )
      )
        throw new CapShareError(
          'ARCHIVE_INVALID',
          'An older package contains an unresolved preset resource. Export it again with the current version.'
        )
      walkJsonStrings(value, (current) => {
        if (idMap.has(current)) return idMap.get(current)
        const ref = refs.find((ref) => ref.from === current)
        const legacy = !ref ? legacyPresetTarget(manifest, owner, current) : null
        if (!ref && !legacy && current.startsWith('##_presetpath_placeholder_'))
          throw new CapShareError(
            'ARCHIVE_INVALID',
            'An older package contains an unresolved preset resource. Export it again with the current version.'
          )
        return ref
          ? jsonPath(targetFor(ref.target, ref.kind))
          : legacy
            ? jsonPath(targetFor(legacy, 'preset'))
            : undefined
      })
      if (
        file.kind === 'preset' &&
        file.entry === `payload/${owner}/${manifest.storage[owner].metadata}`
      ) {
        object(value)['id'] = idMap.get(owner)
        object(value)['name'] = namesMap.get(owner)
      }
      transformed.set(file.entry, Buffer.from(JSON.stringify(value)))
    }
    // Reserve fresh destinations. Existing folders, resources and files are never overwritten.
    for (const [id, name] of folders) {
      const directory = replacementDirectories.get(id) ?? join(presetParent, name)
      await mkdir(dirname(directory), { recursive: true })
      await mkdir(directory)
      owned.push(directory)
    }
    for (const [kind, directory] of [
      ['asset', assetRoot],
      ['effect', effectRoot]
    ] as const)
      if (files.some((file) => file.kind === kind)) {
        await mkdir(dirname(directory), { recursive: true })
        await mkdir(directory)
        owned.push(directory)
      }
    for (const file of files) {
      checkCancel(options.signal)
      const destination = writeTargetFor(file.entry, file.kind)
      await mkdir(dirname(destination), { recursive: true })
      const changed = transformed.get(file.entry)
      if (changed) await writeFile(destination, changed, { flag: 'wx' })
      else await copyFile(join(staging, file.entry), destination, constants.COPYFILE_EXCL)
      if (!changed && (await hashFile(destination)) !== file.sha256)
        throw new CapShareError('IMPORT_FAILED', 'Restored preset resource checksum mismatch')
      if (changed && !(await readFile(destination)).equals(changed))
        throw new CapShareError('IMPORT_FAILED', 'Restored preset document differs')
    }
    for (const ref of manifest.references.filter((ref) => selected.has(ref.owner))) {
      if (!existsSync(writeTargetFor(ref.target, ref.kind)))
        throw new CapShareError('IMPORT_FAILED', 'Restored preset dependency is missing')
    }
    const { records, links } = nativeGroups(library.catalog)
    if (placement.wrapper) {
      const now = Date.now()
      records.push({
        id: placement.wrapper.id,
        name: placement.wrapper.name,
        type: 0,
        create_time: Math.floor(now / 1000),
        import_time: Math.floor(now / 1000),
        import_time_us: now * 1000
      })
      links.push({ child_id: placement.wrapper.id, parent_id: placement.wrapper.parentId ?? '' })
    }
    for (const node of nodes) {
      if (
        decisions[node.id]?.action === 'replace' ||
        placement.folders.some((folder) => folder.sourceId === node.id && folder.action === 'merge')
      )
        continue
      records.push({
        ...manifest.records[node.id],
        id: idMap.get(node.id),
        name: namesMap.get(node.id)
      })
      links.push({
        child_id: idMap.get(node.id),
        parent_id: placement.parents.get(node.id) ?? ''
      })
    }
    const groups = library.catalog['preset_virtual_store'] as Record<string, unknown>[]
    groups.find((group) => group['type'] === 0)!['value'] = records
    groups.find((group) => group['type'] === 1)!['value'] = links
    await options.beforeCommit?.()
    const latest = await readFile(join(root, STORE_PATH)).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    })
    if (library.raw ? !latest?.equals(library.raw) : latest !== null)
      throw new CapShareError(
        'IMPORT_FAILED',
        'Preset catalog changed during import; nothing was registered'
      )
    checkCancel(options.signal)
    if (library.raw) {
      await mkdir(backupDir, { recursive: true })
      backup = join(backupDir, 'preset-catalog-' + importId + '.json')
      await writeFile(backup, library.raw, { flag: 'wx' })
    }
    if (replacementDirectories.size) {
      if (
        !review ||
        (await reviewPresetImport(path, selection, root, env, importOptions, options)).token !==
          review.token
      )
        throw new CapShareError('IMPORT_FAILED', 'A replacement source changed. Review again.')
      const replacementBackup = checkedWithin(
        backupDir,
        join(backupDir, 'preset-files-' + importId)
      )
      for (const [owner, prepared] of replacementDirectories) {
        const original = checkedWithin(presetParent, join(presetParent, folders.get(owner)!))
        if ((await inventory(original)) !== replacementInventories.get(owner))
          throw new CapShareError('IMPORT_FAILED', 'Preset files changed before replacement')
        for await (const file of walkFiles(original)) {
          checkCancel(options.signal)
          const destination = checkedWithin(
            replacementBackup,
            join(replacementBackup, idMap.get(owner)!, file.relPath)
          )
          await mkdir(dirname(destination), { recursive: true })
          await copyFile(file.absPath, destination, constants.COPYFILE_EXCL)
          if ((await hashFile(file.absPath)) !== (await hashFile(destination)))
            throw new CapShareError('IMPORT_FAILED', 'Replacement backup verification failed')
        }
        const rollback = checkedWithin(staging, join(staging, 'rollback', owner))
        await mkdir(dirname(rollback), { recursive: true })
        await options.beforeCommit?.()
        checkCancel(options.signal)
        await rename(original, rollback)
        swaps.push({ original, rollback })
        await rename(checkedWithin(staging, prepared), original)
      }
    }
    await options.beforeCommit?.()
    checkCancel(options.signal)
    const finalCatalog = await readFile(join(root, STORE_PATH)).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    })
    if (library.raw ? !finalCatalog?.equals(library.raw) : finalCatalog !== null)
      throw new CapShareError('IMPORT_FAILED', 'Preset catalog changed before commit')
    await mkdir(dirname(join(root, STORE_PATH)), { recursive: true })
    await atomicWriteFile(join(root, STORE_PATH), JSON.stringify(library.catalog))
    committed = true
  } catch (error) {
    operationError = error
  } finally {
    if (!committed)
      for (const swap of swaps.reverse()) {
        try {
          if (existsSync(swap.original)) {
            const discarded = checkedWithin(staging, join(staging, 'discarded', randomUUID()))
            await mkdir(dirname(discarded), { recursive: true })
            await rename(checkedWithin(presetParent, swap.original), discarded)
          }
          await rename(
            checkedWithin(staging, swap.rollback),
            checkedWithin(presetParent, swap.original)
          )
        } catch {
          keepStaging = true
        }
      }
    if (!committed && !keepStaging)
      for (const directory of owned.reverse())
        if (!key(directory).startsWith(key(staging) + '/'))
          await rm(
            checkedWithin(
              key(directory).startsWith(key(env.cacheDir) + '/') ? env.cacheDir : root,
              directory
            ),
            { recursive: true, force: true }
          )
    if (!keepStaging) await rm(checkedWithin(root, staging), { recursive: true, force: true })
  }
  if (keepStaging)
    throw new CapShareError(
      'IMPORT_FAILED',
      'Automatic rollback could not finish. Preserved recovery files.',
      staging
    )
  if (operationError) throw operationError
  return {
    path: root,
    presets: nodes.filter((node) => node.kind === 'preset').length,
    folders:
      placement.folders.filter((folder) => folder.action === 'create').length +
      (placement.wrapper ? 1 : 0),
    mergedFolders: placement.folders.filter((folder) => folder.action === 'merge').length,
    skipped: allNodes.filter(
      (node) => node.kind === 'preset' && decisions[node.id]?.action === 'skip'
    ).length,
    replaced: replacementDirectories.size,
    warnings: [...manifest.warnings, 'Restart CapCut to reload the preset library.'],
    backupPath: backup,
    sourcesPath: mediaTargets.size ? join(assetRoot, 'Исходники') : undefined
  }
}
