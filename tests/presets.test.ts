import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { CapCutEnv } from '../src/main/core/capcut/model'
import { walkJsonStrings } from '../src/main/core/capcut/scanner'
import {
  detectPresetRoot,
  nativeGroups,
  readLibrary,
  selectNodes,
  STORE_PATH
} from '../src/main/core/presets/library'
import {
  exportPresets,
  importPresets,
  inspectPresetPackage,
  reviewPresetImport
} from '../src/main/core/presets/package'
import { readZipEntries, ZipWriter } from '../src/main/core/zip'

let tmp: string, root: string, env: CapCutEnv
const write = (path: string, value: unknown): void => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value))
}
const json = (path: string): Record<string, unknown> => JSON.parse(readFileSync(path, 'utf8'))
const slash = (path: string): string => path.replace(/\\/g, '/')

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'wakushare-presets-'))
  root = join(tmp, 'source/Presets')
  env = {
    os: 'windows',
    userDataDir: join(tmp, 'source'),
    draftRoot: join(tmp, 'source/projects'),
    cacheDir: join(tmp, 'source/CapCut/User Data/Cache'),
    canonicalCacheDirJson: '',
    fromOverride: false
  }
  const records = [
    { id: 'folder-a', name: 'Titles', type: 0 },
    { id: 'folder-b', name: 'Nested', type: 0 },
    { id: 'p1', name: 'One', type: 1, custom: 'keep' },
    { id: 'p2', name: 'Two', type: 1 },
    { id: 'p3', name: 'Private', type: 1 }
  ]
  write(join(root, STORE_PATH), {
    keep: { arbitrary: true },
    preset_virtual_store: [
      { type: 0, value: records },
      {
        type: 1,
        value: [
          { child_id: 'folder-a', parent_id: '' },
          { child_id: 'folder-b', parent_id: 'folder-a' },
          { child_id: 'p1', parent_id: 'folder-b' },
          { child_id: 'p2', parent_id: 'folder-a' },
          { child_id: 'p3', parent_id: '' }
        ]
      },
      { type: 7, value: ['unknown group'] }
    ]
  })
  write(join(tmp, 'source/font.ttf'), 'font bytes')
  write(join(root, 'Combination/Resources/shared.mov'), 'shared movie')
  write(join(root, 'Combination/Resources/private.mov'), 'unselected private movie')
  write(join(env.cacheDir, 'effect/123/config.json'), { name: 'effect' })
  write(join(env.cacheDir, 'effect/123/texture.png'), 'effect bytes')
  for (const [id, name] of [
    ['p1', 'One'],
    ['p2', 'Two'],
    ['p3', 'Private']
  ]) {
    const folder = join(root, 'Combination/Presets', name)
    write(join(folder, name + '.jpeg'), 'cover')
    write(join(folder, name + '.json'), {
      id,
      name,
      cover_path: slash(join(folder, name + '.jpeg')),
      type: 'video',
      version: '3.0'
    })
    const draft = {
      id: 'draft-' + id,
      nestedId: 'draft-' + id,
      untouched: { start: 20, duration: 100, animation: 'pop' },
      media: slash(join(root, 'Combination/Resources', id === 'p3' ? 'private.mov' : 'shared.mov')),
      content: JSON.stringify({ font: { path: slash(join(tmp, 'source/font.ttf')) } }),
      effect: slash(join(env.cacheDir, 'effect/123'))
    }
    write(join(folder, 'preset_draft/draft_content.json'), draft)
    write(join(folder, 'preset_draft/template.tmp'), draft)
    write(join(folder, 'preset_draft/template-2.tmp'), draft)
  }
})
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

describe('composition preset transfer', () => {
  it('recognizes a relocated copy despite new IDs, name and paths', async () => {
    const archive = join(tmp, 'review.wakupresets'),
      target = join(tmp, 'target')
    await exportPresets(root, ['p1'], archive, env)
    await importPresets(archive, ['p1'], target, env, join(tmp, 'backups'))
    const review = await reviewPresetImport(archive, ['p1'], target, env)
    expect(review.presets[0].matches).toHaveLength(1)
    expect(review.presets[0].matches[0].location).toBe('Titles / Nested / One')
  })

  it('resolves native preset placeholders after CapCut saves an imported preset', async () => {
    const archive = join(tmp, 'placeholder.wakupresets'),
      target = join(tmp, 'target')
    await exportPresets(root, ['p1'], archive, env)
    await importPresets(archive, ['p1'], target, env, join(tmp, 'backups'))
    const storage = [...(await readLibrary(target)).storage.values()][0],
      path = join(storage.directory, storage.metadata),
      metadata = json(path)
    const actual = String(metadata['cover_path']),
      relative = slash(actual).split('/Combination/')[1]
    write(path, {
      ...metadata,
      cover_path: '##_presetpath_placeholder_0E685133-18CE-45ED-8CB8-2904A212EC80_##/' + relative
    })
    const review = await reviewPresetImport(archive, ['p1'], target, env)
    expect(review.presets[0].matches).toHaveLength(1)
    const exported = join(tmp, 'placeholder-export.wakupresets')
    await exportPresets(
      target,
      [(await readLibrary(target)).view.nodes.find((node) => node.kind === 'preset')!.id],
      exported,
      env
    )
    expect(
      (await inspectPresetPackage(exported)).manifest.references.some((ref) =>
        ref.from.startsWith('##_presetpath_placeholder_')
      )
    ).toBe(true)
  })

  it('merges nested folders only inside the chosen destination', async () => {
    const archive = join(tmp, 'merge.wakupresets')
    await exportPresets(root, ['p1'], archive, env)
    const result = await importPresets(archive, ['p1'], root, env, join(tmp, 'backups'), {
      importOptions: { folderMode: 'merge' }
    })
    expect(result).toMatchObject({ folders: 0, mergedFolders: 2, presets: 1 })
    const current = await readLibrary(root)
    expect(current.view.nodes.filter((node) => node.kind === 'folder')).toHaveLength(2)
    expect(current.view.nodes.find((node) => node.name === 'One 2')?.parentId).toBe('folder-b')
    const nested = await importPresets(archive, ['p1'], root, env, join(tmp, 'backups'), {
      importOptions: { targetFolderId: 'folder-b', newFolderName: 'Foreign', folderMode: 'merge' }
    })
    expect(nested.folders).toBe(3)
    const after = await readLibrary(root),
      wrapper = after.view.nodes.find((node) => node.name === 'Foreign')!
    expect(wrapper.parentId).toBe('folder-b')
    expect(
      after.view.nodes.find((node) => node.name === 'Titles' && node.parentId === wrapper.id)
    ).toBeDefined()
  })

  it('skips a reviewed full duplicate without changing the library', async () => {
    const archive = join(tmp, 'skip.wakupresets'),
      target = join(tmp, 'target')
    await exportPresets(root, ['p1'], archive, env)
    await importPresets(archive, ['p1'], target, env, join(tmp, 'backups'))
    const review = await reviewPresetImport(archive, ['p1'], target, env)
    const before = readFileSync(join(target, STORE_PATH))
    let wrotePayload = false
    const result = await importPresets(archive, ['p1'], target, env, join(tmp, 'backups'), {
      onProgress: () => {
        for (const name of readdirSync(target).filter((name) =>
          name.startsWith('.wakushare-presets-')
        ))
          wrotePayload ||= readdirSync(join(target, name)).length > 0
      },
      reviewToken: review.token,
      importOptions: { duplicates: { p1: { action: 'skip' } } }
    })
    expect(result).toMatchObject({ presets: 0, skipped: 1, folders: 0 })
    expect(readFileSync(join(target, STORE_PATH))).toEqual(before)
    expect(wrotePayload).toBe(false)
  })

  it('replaces a verified duplicate in its existing location with a full backup', async () => {
    const archive = join(tmp, 'replace.wakupresets'),
      target = join(tmp, 'target')
    await exportPresets(root, ['p1'], archive, env)
    await importPresets(archive, ['p1'], target, env, join(tmp, 'backups'))
    const review = await reviewPresetImport(archive, ['p1'], target, env),
      match = review.presets[0].matches[0]
    const library = await readLibrary(target),
      storage = library.storage.get(match.id)!
    const oldDraft = readFileSync(join(storage.directory, 'preset_draft/draft_content.json'))
    const result = await importPresets(archive, ['p1'], target, env, join(tmp, 'backups'), {
      reviewToken: review.token,
      importOptions: { duplicates: { p1: { action: 'replace', targetId: match.id } } }
    })
    expect(result).toMatchObject({ presets: 1, replaced: 1, folders: 0 })
    const after = await readLibrary(target)
    expect(after.view.nodes).toEqual(library.view.nodes)
    expect(after.storage.get(match.id)).toEqual(storage)
    expect(json(join(storage.directory, storage.metadata))['id']).toBe(match.id)
    expect(readFileSync(join(storage.directory, 'preset_draft/draft_content.json'))).not.toEqual(
      oldDraft
    )
    const backup = join(
      dirname(result.backupPath!),
      'preset-files-' + result.backupPath!.split('preset-catalog-')[1].slice(0, -5),
      match.id,
      'preset_draft/draft_content.json'
    )
    expect(readFileSync(backup)).toEqual(oldDraft)
  })

  it.each(['failure', 'cancel'])(
    'restores the previous folder after a replacement swap (%s)',
    async (mode) => {
      const archive = join(tmp, 'rollback.wakupresets'),
        target = join(tmp, 'target')
      await exportPresets(root, ['p1'], archive, env)
      await importPresets(archive, ['p1'], target, env, join(tmp, 'backups'))
      const review = await reviewPresetImport(archive, ['p1'], target, env),
        match = review.presets[0].matches[0]
      const storage = (await readLibrary(target)).storage.get(match.id)!,
        oldDraft = readFileSync(join(storage.directory, 'preset_draft/draft_content.json')),
        oldCatalog = readFileSync(join(target, STORE_PATH))
      let checks = 0
      const controller = new AbortController()
      await expect(
        importPresets(archive, ['p1'], target, env, join(tmp, 'backups'), {
          reviewToken: review.token,
          signal: controller.signal,
          importOptions: { duplicates: { p1: { action: 'replace', targetId: match.id } } },
          beforeCommit: async () => {
            if (++checks === 3) {
              if (mode === 'cancel') controller.abort()
              else throw new Error('CapCut started before catalog commit')
            }
          }
        })
      ).rejects.toThrow(mode === 'cancel' ? 'cancelled' : 'CapCut started')
      expect(checks).toBe(3)
      expect(readFileSync(join(storage.directory, 'preset_draft/draft_content.json'))).toEqual(
        oldDraft
      )
      expect(readFileSync(join(target, STORE_PATH))).toEqual(oldCatalog)
    }
  )

  it('does not call different text or changed media a full duplicate', async () => {
    const archive = join(tmp, 'different.wakupresets'),
      target = join(tmp, 'target')
    await exportPresets(root, ['p1'], archive, env)
    await importPresets(archive, ['p1'], target, env, join(tmp, 'backups'))
    const storage = [...(await readLibrary(target)).storage.values()][0]
    const draftPath = join(storage.directory, 'preset_draft/draft_content.json'),
      original = json(draftPath)
    write(draftPath, { ...original, extraText: 'Different text' })
    expect((await reviewPresetImport(archive, ['p1'], target, env)).presets[0].matches).toEqual([])
    write(draftPath, original)
    write(String(original['media']), 'changed movie bytes')
    expect((await reviewPresetImport(archive, ['p1'], target, env)).presets[0].matches).toEqual([])
  })

  it('does not normalize user-visible UUID text as a generated identifier', async () => {
    for (const [folder, id] of [
      ['One', '11111111-1111-4111-8111-111111111111'],
      ['Two', '22222222-2222-4222-8222-222222222222']
    ]) {
      for (const file of ['draft_content.json', 'template.tmp', 'template-2.tmp'])
        write(join(root, 'Combination/Presets', folder, 'preset_draft', file), { id, text: id })
    }
    const archive = join(tmp, 'uuid-text.wakupresets')
    await exportPresets(root, ['p1'], archive, env)
    const review = await reviewPresetImport(archive, ['p1'], root, env)
    expect(review.presets[0].matches.map((item) => item.id)).toEqual(['p1'])
  })

  it('rejects a stale review and an unverified replacement', async () => {
    const archive = join(tmp, 'stale.wakupresets'),
      target = join(tmp, 'target')
    await exportPresets(root, ['p1'], archive, env)
    await importPresets(archive, ['p1'], target, env, join(tmp, 'backups'))
    const review = await reviewPresetImport(archive, ['p1'], target, env),
      match = review.presets[0].matches[0]
    await expect(
      importPresets(archive, ['p1'], target, env, join(tmp, 'backups'), {
        importOptions: { duplicates: { p1: { action: 'replace', targetId: match.id } } }
      })
    ).rejects.toThrow(/verified duplicate review/)
    const storage = (await readLibrary(target)).storage.get(match.id)!
    write(join(storage.directory, storage.metadata), {
      ...json(join(storage.directory, storage.metadata)),
      import_time_ms: 42
    })
    await expect(
      importPresets(archive, ['p1'], target, env, join(tmp, 'backups'), {
        reviewToken: review.token,
        importOptions: { duplicates: { p1: { action: 'replace', targetId: match.id } } }
      })
    ).rejects.toThrow(/changed/)
  })

  it('keeps same-named independent media in Исходники with distinct names and correct references', async () => {
    const one = join(tmp, 'source/one/clip.mov'),
      two = join(tmp, 'source/two/clip.mov')
    write(one, 'first media')
    write(two, 'second media')
    const draftPath = join(root, 'Combination/Presets/One/preset_draft/draft_content.json')
    write(draftPath, {
      id: 'draft-p1',
      first: slash(one),
      second: slash(two),
      repeated: slash(one)
    })
    const archive = join(tmp, 'names.wakupresets')
    await exportPresets(root, ['p1'], archive, env)
    const { manifest } = await inspectPresetPackage(archive)
    expect(
      manifest.files
        .filter((file) => file.entry.startsWith('Исходники/clip'))
        .map((file) => file.entry)
    ).toEqual(['Исходники/clip.mov', 'Исходники/clip (2).mov'])
    const target = join(tmp, 'target')
    await importPresets(archive, ['p1'], target, env, join(tmp, 'backups'))
    const restored = await readLibrary(target),
      location = [...restored.storage.values()][0]
    const draft = json(join(location.directory, 'preset_draft/draft_content.json'))
    expect(draft['first']).toBe(draft['repeated'])
    expect(draft['first']).not.toBe(draft['second'])
    expect(String(draft['first'])).toContain('/Исходники/clip.mov')
    expect(readFileSync(String(draft['first']), 'utf8')).toBe('first media')
    expect(readFileSync(String(draft['second']), 'utf8')).toBe('second media')
  })

  it('follows external subdraft documents recursively, including their fonts and media', async () => {
    const sub = join(tmp, 'source/other-project/subdraft/draft_content.json')
    const media = join(tmp, 'source/other-project/sound.wav')
    write(media, 'subdraft sound')
    write(sub, {
      id: 'external-draft',
      path: slash(media),
      self: slash(sub),
      content: JSON.stringify({ font: slash(join(tmp, 'source/font.ttf')) })
    })
    const draftPath = join(root, 'Combination/Presets/One/preset_draft/draft_content.json')
    write(draftPath, { id: 'draft-p1', draft_file_path: slash(sub), external_id: 'external-draft' })
    const archive = join(tmp, 'nested.wakupresets')
    await exportPresets(root, ['p1'], archive, env)
    rmSync(join(tmp, 'source'), { recursive: true })
    const target = join(tmp, 'target')
    await importPresets(archive, ['p1'], target, env, join(tmp, 'backups'))
    const restored = await readLibrary(target),
      location = [...restored.storage.values()][0]
    const draft = json(join(location.directory, 'preset_draft/draft_content.json'))
    const nested = json(String(draft['draft_file_path']))
    expect(nested['id']).toBe(draft['external_id'])
    expect(nested['id']).not.toBe('external-draft')
    expect(nested['self']).toBe(draft['draft_file_path'])
    expect(readFileSync(String(nested['path']), 'utf8')).toBe('subdraft sound')
    expect(existsSync(JSON.parse(String(nested['content'])).font)).toBe(true)
  })

  it('reports all missing paths and accepts only explicit replacements', async () => {
    const draftPath = join(root, 'Combination/Presets/One/preset_draft/draft_content.json')
    const old = slash(join(tmp, 'missing/one.wav')),
      other = slash(join(tmp, 'missing/two.wav'))
    write(draftPath, { id: 'draft-p1', one: old, two: other })
    const archive = join(tmp, 'missing.wakupresets')
    await expect(exportPresets(root, ['p1'], archive, env)).rejects.toMatchObject({
      detail: expect.stringContaining(other)
    })
    const replacement = join(tmp, 'source/recovered.wav')
    write(replacement, 'approved replacement')
    await exportPresets(root, ['p1'], archive, env, {
      sourceOverrides: { [old]: replacement, [other]: replacement }
    })
    expect(
      (await inspectPresetPackage(archive)).manifest.references.filter(
        (ref) => ref.from === old || ref.from === other
      )
    ).toHaveLength(2)
    expect(json(draftPath)['one']).toBe(old)
  })

  it('aborts a final pre-commit check without leaving registered or copied presets', async () => {
    const archive = join(tmp, 'closed.wakupresets')
    await exportPresets(root, ['p1'], archive, env)
    const target = join(tmp, 'target')
    await expect(
      importPresets(archive, ['p1'], target, env, join(tmp, 'backups'), {
        beforeCommit: async () => {
          throw new Error('CapCut opened')
        }
      })
    ).rejects.toThrow('CapCut opened')
    expect(existsSync(join(target, STORE_PATH))).toBe(false)
    expect(existsSync(join(target, 'Combination/Presets/One'))).toBe(false)
  })

  it('honors the configured external library path', async () => {
    write(
      join(env.userDataDir, 'Config/globalSetting'),
      '[General]\ncustomPresetPath=' + root.replace(/\\/g, '\\\\') + '\n'
    )
    expect(await detectPresetRoot(env)).toBe(root)
  })

  it('selects folders recursively and retains only ancestors for a selected leaf', async () => {
    const { view } = await readLibrary(root)
    expect(selectNodes(view.nodes, ['p1']).map((n) => n.id)).toEqual(['folder-a', 'folder-b', 'p1'])
    expect(selectNodes(view.nodes, ['folder-a']).map((n) => n.id)).toEqual([
      'folder-a',
      'folder-b',
      'p1',
      'p2'
    ])
    expect(() =>
      selectNodes(
        [...view.nodes, { id: 'bad', name: 'bad', kind: 'folder', parentId: 'bad' }],
        ['bad']
      )
    ).toThrow(/hierarchy/)
  })

  it('moves selected presets, nested folders, explicit fonts, effects and embedded JSON without the old machine', async () => {
    const archive = join(tmp, 'selected.wakupresets')
    await exportPresets(root, ['folder-a'], archive, env)
    const { manifest } = await inspectPresetPackage(archive)
    expect(manifest.nodes.some((n) => n.id === 'p3')).toBe(false)
    expect(manifest.references.some((r) => r.from.endsWith('private.mov'))).toBe(false)
    expect(manifest.files.filter((f) => f.entry.endsWith('shared.mov'))).toHaveLength(1)
    const target = join(tmp, 'new-machine/Presets'),
      cache = join(tmp, 'new-machine/Cache')
    // Source disappears, so imports cannot fall back to original files.
    rmSync(join(tmp, 'source'), { recursive: true })
    const result = await importPresets(
      archive,
      ['p1'],
      target,
      { ...env, cacheDir: cache },
      join(tmp, 'backups')
    )
    expect(result).toMatchObject({ presets: 1, folders: 2 })
    const restored = await readLibrary(target)
    expect(restored.view.nodes.map((n) => n.name)).toEqual(['Titles', 'Nested', 'One'])
    expect(restored.view.nodes.every((n) => !manifest.nodes.some((old) => old.id === n.id))).toBe(
      true
    )
    const preset = restored.view.nodes.find((n) => n.kind === 'preset')!
    const location = restored.storage.get(preset.id)!
    const draft = json(join(location.directory, 'preset_draft/draft_content.json'))
    expect(draft['id']).not.toBe('draft-p1')
    expect(draft['nestedId']).toBe(draft['id'])
    expect(draft['untouched']).toEqual({ start: 20, duration: 100, animation: 'pop' })
    const paths: string[] = []
    walkJsonStrings(draft, (value) => {
      if (value.includes('/') && !value.startsWith('{')) paths.push(value)
      return undefined
    })
    expect(paths).toHaveLength(3)
    for (const path of paths) {
      expect(path).not.toContain('/source/')
      expect(existsSync(path)).toBe(true)
    }
    expect(json(join(location.directory, 'preset_draft/template.tmp'))).toEqual(draft)
    expect(json(join(location.directory, 'preset_draft/template-2.tmp'))).toEqual(draft)
    expect(json(join(location.directory, location.metadata))['id']).toBe(preset.id)
  })

  it('imports as new copies and leaves previous catalog records and files intact', async () => {
    const archive = join(tmp, 'copy.wakupresets')
    await exportPresets(root, ['p1'], archive, env)
    const before = readFileSync(
      join(root, 'Combination/Presets/One/preset_draft/draft_content.json')
    )
    const original = readFileSync(join(root, STORE_PATH))
    const result = await importPresets(archive, ['p1'], root, env, join(tmp, 'backups'))
    expect(readFileSync(result.backupPath!)).toEqual(original)
    expect(
      readFileSync(join(root, 'Combination/Presets/One/preset_draft/draft_content.json'))
    ).toEqual(before)
    const restored = await readLibrary(root)
    expect(restored.view.nodes).toHaveLength(8)
    expect(restored.view.nodes.some((n) => n.name === 'One 2')).toBe(true)
    expect(restored.catalog['keep']).toEqual({ arbitrary: true })
    expect((restored.catalog['preset_virtual_store'] as unknown[])[2]).toEqual({
      type: 7,
      value: ['unknown group']
    })
  })

  it('rejects missing dependencies without replacing a previous archive', async () => {
    const archive = join(tmp, 'existing.wakupresets')
    write(archive, 'previous')
    rmSync(join(tmp, 'source/font.ttf'))
    await expect(exportPresets(root, ['p1'], archive, env)).rejects.toThrow(/dependency is missing/)
    expect(readFileSync(archive, 'utf8')).toBe('previous')
  })

  it('rejects a source catalog changed while exporting', async () => {
    const archive = join(tmp, 'existing.wakupresets')
    write(archive, 'previous')
    let changed = false
    await expect(
      exportPresets(root, ['p1'], archive, env, {
        onProgress: () => {
          if (!changed) {
            changed = true
            write(join(root, STORE_PATH), { ...json(join(root, STORE_PATH)), concurrent: true })
          }
        }
      })
    ).rejects.toThrow(/catalog changed/)
    expect(readFileSync(archive, 'utf8')).toBe('previous')
  })

  it('rolls back files when the destination catalog changes during import', async () => {
    const archive = join(tmp, 'race.wakupresets')
    await exportPresets(root, ['p1'], archive, env)
    const catalog = json(join(root, STORE_PATH))
    let changed = false
    await expect(
      importPresets(archive, ['p1'], root, env, join(tmp, 'backups'), {
        onProgress: () => {
          if (!changed) {
            changed = true
            write(join(root, STORE_PATH), { ...catalog, concurrent: true })
          }
        }
      })
    ).rejects.toThrow(/catalog changed/)
    expect(nativeGroups(json(join(root, STORE_PATH))).records).toHaveLength(5)
    expect(existsSync(join(root, 'Combination/Presets/One 2'))).toBe(false)
    expect(json(join(root, STORE_PATH))['concurrent']).toBe(true)
  })

  it('validates hashes before registering any presets', async () => {
    const archive = join(tmp, 'original.wakupresets')
    await exportPresets(root, ['p1'], archive, env)
    const { manifest } = await inspectPresetPackage(archive)
    const contents = await readZipEntries(
      archive,
      manifest.files.map((f) => f.entry)
    )
    const corrupt = join(tmp, 'corrupt.wakupresets'),
      zip = new ZipWriter(corrupt)
    await zip.add({
      kind: 'buffer',
      zipPath: 'manifest.json',
      data: Buffer.from(JSON.stringify(manifest))
    })
    for (const file of manifest.files)
      await zip.add({
        kind: 'buffer',
        zipPath: file.entry,
        data: file === manifest.files[0] ? Buffer.from('tampered') : contents.get(file.entry)!
      })
    await zip.finish()
    const target = join(tmp, 'target')
    await expect(importPresets(corrupt, ['p1'], target, env, join(tmp, 'backups'))).rejects.toThrow(
      /Integrity/
    )
    expect(existsSync(join(target, STORE_PATH))).toBe(false)
  })

  it('cancels before publishing a catalog', async () => {
    const archive = join(tmp, 'cancel.wakupresets')
    await exportPresets(root, ['p1'], archive, env)
    const controller = new AbortController()
    controller.abort()
    const target = join(tmp, 'target')
    await expect(
      importPresets(archive, ['p1'], target, env, join(tmp, 'backups'), {
        signal: controller.signal
      })
    ).rejects.toThrow(/cancelled/)
    expect(existsSync(join(target, STORE_PATH))).toBe(false)
  })
})
