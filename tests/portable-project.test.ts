import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { exportDraft } from '../src/main/core/capshare/export'
import { importCapshare as importCapshareCore } from '../src/main/core/capshare/import'
import { parseManifest } from '../src/main/core/capshare/manifest'
import { readProjectDocuments, validateTimelineGraph } from '../src/main/core/capcut/project'
import { DRAFT_PATH_PLACEHOLDER } from '../src/main/core/capcut/constants'
import { walkJsonStrings } from '../src/main/core/capcut/scanner'
import { readZipEntries, ZipWriter } from '../src/main/core/zip'
import type { CapCutEnv } from '../src/main/core/capcut/model'

// This compatibility fixture is trusted explicitly, never via a production bypass.
const importCapshare: typeof importCapshareCore = (options) =>
  importCapshareCore({ approveActiveContent: async () => true, ...options })

let root: string
let source: string
let env: CapCutEnv
let ids: string[]
let external: string[]
interface FixtureDocument {
  id: string
  tracks: unknown[]
  materials: {
    videos: { path: string; material_name: string }[]
    audios: { path: string }[]
    effects: { id: string; path: string }[]
  }
  unknown: string
  future_change?: boolean
}
const json = (p: string): FixtureDocument => JSON.parse(readFileSync(p, 'utf8')) as FixtureDocument
function write(p: string, value: unknown): void {
  mkdirSync(join(p, '..'), { recursive: true })
  writeFileSync(p, JSON.stringify(value))
}
function timeline(id: string, path: string, i: number): unknown {
  return {
    id,
    version: 360000,
    new_version: '189.0.0',
    duration: 1000000,
    platform: { app_version: '9.6.0', os: 'windows' },
    tracks: [
      {
        id: 'track-' + i,
        type: 'video',
        segments: [
          {
            id: 'segment-' + i,
            material_id: 'media-' + i,
            target_timerange: { start: 0, duration: 1000000 },
            future: { untouched: 'yes' }
          }
        ]
      }
    ],
    materials: {
      videos: [{ id: 'media-' + i, type: 'photo', path, material_name: 'Manual label ' + i }]
    }
  }
}
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'capshare-portable-'))
  env = {
    os: 'windows',
    userDataDir: join(root, 'machine/CapCut/User Data'),
    draftRoot: join(root, 'machine/CapCut/User Data/Projects/com.lveditor.draft'),
    cacheDir: join(root, 'machine/CapCut/User Data/Cache'),
    canonicalCacheDirJson: join(root, 'machine/CapCut/User Data/Cache').replace(/\\/g, '/'),
    fromOverride: true
  }
  source = join(env.draftRoot, '1012')
  ids = Array.from({ length: 4 }, () => randomUUID().toUpperCase())
  external = ['a', 'b', 'c'].map((part) => join(root, 'external', part, 'same.png'))
  external.forEach((p, i) => {
    mkdirSync(join(p, '..'), { recursive: true })
    writeFileSync(p, i === 2 ? 'bytes-0' : 'bytes-' + i)
  })
  const local = join(source, 'Resources/local/original.png')
  mkdirSync(join(local, '..'), { recursive: true })
  writeFileSync(local, 'local-bytes')
  const docs = ids.map((id, i) =>
    timeline(
      id,
      i === 0
        ? DRAFT_PATH_PLACEHOLDER + '/Resources/local/original.png'
        : external[i - 1].replace(/\\/g, '/'),
      i
    )
  )
  write(join(source, 'draft_content.json'), docs[0])
  docs.forEach((doc, i) => {
    write(join(source, 'Timelines', ids[i], 'draft_content.json'), doc)
    write(join(source, 'Timelines', ids[i], 'template-2.tmp'), doc)
  })
  write(join(source, 'Timelines/project.json'), {
    id: randomUUID().toUpperCase(),
    main_timeline_id: ids[0],
    timelines: ids.map((id, i) => ({ id, name: String(13 + i), is_marked_delete: false }))
  })
  write(join(source, 'timeline_layout.json'), {
    dockItems: [{ ratio: 1, timelineIds: ids, timelineNames: ['13', '14', '15', '16'] }]
  })
  write(join(source, 'draft_meta_info.json'), {
    draft_id: randomUUID().toUpperCase(),
    draft_name: '1012',
    draft_fold_path: source.replace(/\\/g, '/')
  })
  const onlySub = join(root, 'external/sub-only.wav')
  writeFileSync(onlySub, 'sub-only')
  write(join(source, 'subdraft/independent/draft_content.json'), {
    id: 'sub-id',
    materials: { audios: [{ id: 'sub-audio', path: onlySub.replace(/\\/g, '/') }] },
    tracks: [],
    unknown: 'keep'
  })
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

async function exportCase(): Promise<string> {
  const archive = join(root, 'project.capshare')
  await exportDraft({
    draftFolder: source,
    env,
    destinationPath: archive,
    includeCaches: true,
    capshareVersion: 'lab'
  })
  return archive
}

describe('complete portable multi-timeline project', () => {
  it('preserves the exact library hierarchy, root cards and unused media without a wrapper', async () => {
    const metaPath = join(source, 'draft_meta_info.json')
    const meta = JSON.parse(readFileSync(metaPath, 'utf8'))
    const unused = join(root, 'external/unused.wav')
    writeFileSync(unused, 'not used on any timeline')
    meta.draft_materials = [
      {
        type: 0,
        value: [
          { id: 'local-card', file_Path: './Resources/local/original.png', extra_info: 'My name' },
          { id: 'external-card', file_Path: external[0].replaceAll('\\', '/') },
          {
            id: 'unused-card',
            file_Path: unused.replaceAll('\\', '/'),
            extra_info: 'Unused manual name',
            custom: { untouched: 7 }
          }
        ]
      }
    ]
    write(metaPath, meta)
    write(join(source, 'draft_virtual_store.json'), {
      draft_virtual_store: [
        {
          type: 0,
          value: [
            { id: '', display_name: '' },
            { id: 'old-folder', display_name: 'My folder' }
          ]
        },
        {
          type: 1,
          value: [
            { child_id: 'old-folder', parent_id: '' },
            { child_id: 'external-card', parent_id: 'old-folder' }
          ]
        }
      ]
    })
    const original = readFileSync(metaPath)
    const originalStore = readFileSync(join(source, 'draft_virtual_store.json'))
    const archive = await exportCase()
    const imported = await importCapshare({
      filePath: archive,
      env,
      resolution: 'copy',
      backupDir: join(root, 'backups')
    })
    const store = JSON.parse(
      readFileSync(join(imported.folderPath, 'draft_virtual_store.json'), 'utf8')
    )
    expect(store).toEqual(JSON.parse(originalStore.toString()))
    const importedMeta = JSON.parse(
      readFileSync(join(imported.folderPath, 'draft_meta_info.json'), 'utf8')
    )
    const records = importedMeta.draft_materials[0].value
    expect(records.map((item: { id: string }) => item.id)).toEqual([
      'local-card',
      'external-card',
      'unused-card'
    ])
    expect(records[2].extra_info).toBe('Unused manual name')
    expect(records[2].custom).toEqual({ untouched: 7 })
    expect(readFileSync(join(imported.folderPath, records[2].file_Path.slice(2)), 'utf8')).toBe(
      'not used on any timeline'
    )
    expect(readFileSync(metaPath).equals(original)).toBe(true)
    expect(
      validateTimelineGraph(await readProjectDocuments(imported.folderPath))!.timelines
    ).toHaveLength(4)
  })
  it('preserves unused compounds and missing library cards while excluding proxy provenance', async () => {
    const orphan = 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE'
    write(join(source, `subdraft/${orphan}/draft_content.json`), {
      id: orphan,
      materials: { audios: [{ id: 'old', path: 'X:/unavailable/old.wav' }] },
      tracks: []
    })
    write(join(source, `subdraft/${orphan}/sub_draft_config.json`), { id: orphan })
    const metaPath = join(source, 'draft_meta_info.json')
    const originalMeta = JSON.parse(readFileSync(metaPath, 'utf8'))
    originalMeta.draft_materials = [
      {
        type: 0,
        value: [
          { id: 'used', file_Path: external[1].replaceAll('\\', '/') },
          { id: 'compound', file_Path: `./subdraft/${orphan}/sub_draft_config.json` },
          { id: 'unused', file_Path: 'X:/unavailable/library-only.mp4' },
          { id: 'local', file_Path: './Resources/local/original.png' }
        ]
      }
    ]
    write(metaPath, originalMeta)
    write(join(source, 'draft_agency_config.json'), {
      marterials: [{ source_path: 'X:/unavailable/proxy-original.mp4' }]
    })
    write(join(source, 'draft_agency_info.json'), {
      material: [{ source_path: 'X:/unavailable/old.mp4' }]
    })
    const archive = await exportCase()
    const metadata = await readZipEntries(archive, ['manifest.json', 'draft/draft_meta_info.json'])
    const manifest = JSON.parse(metadata.get('manifest.json')!.toString())
    expect(manifest.missingAtExport).toEqual([
      'X:/unavailable/library-only.mp4',
      'X:/unavailable/old.wav'
    ])
    expect(manifest.warnings).toEqual([])
    expect(
      Object.keys(manifest.integrity).some((name) => name.startsWith(`subdraft/${orphan}/`))
    ).toBe(true)
    expect(manifest.integrity['draft_agency_config.json']).toBeUndefined()
    expect(manifest.integrity['subdraft/independent/draft_content.json']).toBeDefined()
    expect(manifest.integrity[`Timelines/${ids[3]}/draft_content.json`]).toBeDefined()
    const packagedMeta = JSON.parse(metadata.get('draft/draft_meta_info.json')!.toString())
    expect(packagedMeta.draft_materials[0].value.map((item: { id: string }) => item.id)).toEqual([
      'used',
      'compound',
      'unused',
      'local'
    ])
    expect(JSON.parse(readFileSync(metaPath, 'utf8'))).toEqual(originalMeta)
    const imported = await importCapshare({
      filePath: archive,
      env,
      resolution: 'copy',
      backupDir: join(root, 'backups')
    })
    expect(imported.warnings.some((warning) => warning.includes('already unavailable'))).toBe(true)
    const restored = JSON.parse(
      readFileSync(join(imported.folderPath, 'draft_meta_info.json'), 'utf8')
    )
    expect(restored.draft_materials[0].value.map((item: { id: string }) => item.id)).toEqual([
      'used',
      'compound',
      'unused',
      'local'
    ])
    const absentPath = restored.draft_materials[0].value[2].file_Path.slice(2)
    expect(absentPath).toContain('Resources/unavailable/')
    expect(existsSync(join(imported.folderPath, absentPath))).toBe(false)
    const names = [
      'manifest.json',
      ...Object.keys(manifest.integrity).map((name) => 'draft/' + name),
      ...manifest.looseMedia.map((item: { archivePath: string }) => item.archivePath),
      ...manifest.effectAssets.map((item: { archivePath: string }) => item.archivePath)
    ]
    const bytes = await readZipEntries(archive, names)
    // A warning string or a wrong pointer cannot exempt unrelated missing media.
    for (const wrongPointer of [false, true]) {
      const old = structuredClone(manifest)
      if (wrongPointer) for (const ref of old.unavailableMedia) ref.pointer = '/wrong'
      else delete old.unavailableMedia
      const filePath = join(
        root,
        wrongPointer ? 'wrong-pointer.wakushare' : 'no-declaration.wakushare'
      )
      const writer = new ZipWriter(filePath)
      for (const [name, data] of bytes)
        await writer.add({
          kind: 'buffer',
          zipPath: name,
          data: name === 'manifest.json' ? Buffer.from(JSON.stringify(old)) : data
        })
      await writer.finish()
      await expect(
        importCapshare({ filePath, env, resolution: 'copy', backupDir: join(root, 'backups') })
      ).rejects.toThrow()
    }
    expect(
      validateTimelineGraph(await readProjectDocuments(imported.folderPath))!.timelines
    ).toHaveLength(4)
    rmSync(external[1])
    const missingArchive = join(root, 'missing-active.wakushare')
    const exported = await exportDraft({
      draftFolder: source,
      env,
      destinationPath: missingArchive,
      includeCaches: true,
      capshareVersion: 'test'
    })
    const missing = await readZipEntries(missingArchive, ['manifest.json'])
    const result = JSON.parse(missing.get('manifest.json')!.toString())
    expect(result.missingAtExport).toContain(external[1].replaceAll('\\', '/'))
    expect(exported.warnings.length).toBeGreaterThan(0)
  })

  it('keeps four named edits, mirrors and subdrafts; all media works after originals are removed', async () => {
    const archive = await exportCase()
    const manifest = parseManifest(
      (await readZipEntries(archive, ['manifest.json'])).get('manifest.json')!.toString()
    )
    expect(manifest.looseMedia).toHaveLength(4)
    // Originals disappear AFTER export. The importer must use only the archive.
    rmSync(join(root, 'external'), { recursive: true })
    const result = await importCapshare({
      filePath: archive,
      env,
      resolution: 'copy',
      backupDir: join(root, 'backups')
    })
    const docs = await readProjectDocuments(result.folderPath)
    const graph = validateTimelineGraph(docs)!
    expect(graph.timelines.map((t) => t.name)).toEqual(['13', '14', '15', '16'])
    expect(graph.mainId).not.toBe(ids[0])
    const paths: string[] = []
    for (let i = 0; i < graph.timelines.length; i++) {
      const t = graph.timelines[i]
      const restored = json(join(result.folderPath, t.relativePath))
      const original = json(join(source, 'Timelines', ids[i], 'draft_content.json'))
      expect(restored.tracks).toEqual(original.tracks)
      expect(restored.materials.videos[0].material_name).toBe('Manual label ' + i)
      expect(json(join(result.folderPath, 'Timelines', t.id, 'template-2.tmp'))).toEqual(restored)
      const path = restored.materials.videos[0].path
      paths.push(path)
      expect(path).toContain('/Resources/local/Исходники/')
      const actual = join(result.folderPath, path.slice(DRAFT_PATH_PLACEHOLDER.length + 1))
      expect(readFileSync(actual, 'utf8')).toBe(
        i === 0 ? 'local-bytes' : i === 3 ? 'bytes-0' : 'bytes-' + (i - 1)
      )
    }
    expect(new Set(paths).size).toBe(4) // Equal bytes in independent sources remain separate.
    for (const doc of docs.values()) {
      walkJsonStrings(doc.value, (value, pointer) => {
        if (pointer.endsWith('/path')) expect(value).not.toContain('/external/')
        return undefined
      })
    }
    const sub = json(join(result.folderPath, 'subdraft/independent/draft_content.json'))
    expect(sub.unknown).toBe('keep')
    expect(
      readFileSync(
        join(
          result.folderPath,
          sub.materials.audios[0].path.slice(DRAFT_PATH_PLACEHOLDER.length + 1)
        ),
        'utf8'
      )
    ).toBe('sub-only')
  })

  it('rejects a valid ZIP with falsified integrity before registering a copy', async () => {
    const archive = await exportCase()
    const entries = await readZipEntries(archive, ['manifest.json', 'draft/draft_content.json'])
    const manifest = parseManifest(entries.get('manifest.json')!.toString())
    const corrupt = join(root, 'corrupt.capshare')
    const writer = new ZipWriter(corrupt)
    await writer.add({
      kind: 'buffer',
      data: entries.get('draft/draft_content.json')!,
      zipPath: 'draft/draft_content.json'
    })
    manifest.integrity['draft_content.json'].sha256 = '0'.repeat(64)
    await writer.add({
      kind: 'buffer',
      data: Buffer.from(JSON.stringify(manifest)),
      zipPath: 'manifest.json'
    })
    await writer.finish()
    await expect(
      importCapshare({
        filePath: corrupt,
        env,
        resolution: 'copy',
        backupDir: join(root, 'backups')
      })
    ).rejects.toThrow('Integrity check failed')
    expect(existsSync(join(env.draftRoot, '1012 2'))).toBe(false)
  })

  it('uses explicitly approved missing-source overrides without modifying the original project', async () => {
    const missing = join(root, 'external/sub-only.wav')
    const replacement = join(root, 'confirmed.wav')
    writeFileSync(replacement, readFileSync(missing))
    rmSync(missing)
    const archive = join(root, 'confirmed.capshare')
    await exportDraft({
      draftFolder: source,
      env,
      destinationPath: archive,
      includeCaches: true,
      capshareVersion: 'lab',
      sourceOverrides: { [missing]: replacement }
    })
    const manifest = parseManifest(
      (await readZipEntries(archive, ['manifest.json'])).get('manifest.json')!.toString()
    )
    expect(manifest.missingAtExport).toEqual([])
    expect(manifest.resolvedSources).toEqual([
      { originalPath: missing, resolvedPath: replacement, reason: 'explicit-user-confirmation' }
    ])
    const result = await importCapshare({
      filePath: archive,
      env,
      resolution: 'copy',
      backupDir: join(root, 'backups')
    })
    expect(
      validateTimelineGraph(await readProjectDocuments(result.folderPath))!.timelines
    ).toHaveLength(4)
    expect(existsSync(missing)).toBe(false)
    expect(
      json(join(source, 'subdraft/independent/draft_content.json')).materials.audios[0].path
    ).toBe(missing.replace(/\\/g, '/'))
  })

  it('restores built-in effect data into the target cache without depending on the old installation', async () => {
    const effect = join(root, 'old/CapCut/Apps/9.6.0.4097/Resources/MixMode/example')
    write(join(effect, 'data.json'), { blend: 'preserved' })
    const path = join(source, 'draft_content.json')
    const doc = json(path)
    doc.materials.effects = [{ id: 'blend', path: effect.replace(/\\/g, '/') }]
    write(path, doc)
    const archive = await exportCase()
    rmSync(join(root, 'old'), { recursive: true })
    const result = await importCapshare({
      filePath: archive,
      env,
      resolution: 'copy',
      backupDir: join(root, 'backups')
    })
    const restored = json(join(result.folderPath, 'draft_content.json')).materials.effects[0].path
    expect(restored).toContain('/Cache/CapShare/ApplicationResources/')
    expect(json(join(restored, 'data.json'))).toEqual({ blend: 'preserved' })
    expect(result.warnings.some((w) => w.includes('could not be relocated'))).toBe(false)
  })

  it('rejects changes on an additional timeline during export and retains an existing archive', async () => {
    const destinationPath = join(root, 'existing.capshare')
    writeFileSync(destinationPath, 'previous-good-archive')
    let changed = false
    await expect(
      exportDraft({
        draftFolder: source,
        env,
        destinationPath,
        includeCaches: true,
        capshareVersion: 'lab',
        onProgress: () => {
          if (changed) return
          changed = true
          const path = join(source, 'Timelines', ids[2], 'draft_content.json')
          const doc = json(path)
          doc.future_change = true
          write(path, doc)
        }
      })
    ).rejects.toThrow('saved changes during export')
    expect(readFileSync(destinationPath, 'utf8')).toBe('previous-good-archive')
  })
})
