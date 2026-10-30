import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { approveNewResources } from '../src/main/core/resource-trust'
import { effectResourceRequiresTrust } from '../src/main/core/payload-policy'
import { extractZip, ZipWriter } from '../src/main/core/zip'

let root: string
const hash = (data: string): string => createHash('sha256').update(data).digest('hex')
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'wakushare-known-effects-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

it('does not classify ordinary effect media as code; scripts and opaque configs stay gated', () => {
  for (const name of ['texture.png', 'preview.mp4', 'font.ttf'])
    expect(effectResourceRequiresTrust(name)).toBe(false)
  for (const name of [
    'main.lua',
    'code.js',
    'shader.frag',
    'resource.json',
    'unknown.bin',
    'image.svg'
  ])
    expect(effectResourceRequiresTrust(name)).toBe(true)
})
it('uses hashes of actual local files and asks only about new or changed resources', async () => {
  const cache = join(root, 'cache'),
    path = join(cache, 'effect/main.lua')
  await mkdir(join(cache, 'effect'), { recursive: true })
  await writeFile(path, 'return 1')
  const known = new Map([
    ['assets/main.lua', { relativePath: 'effect/main.lua', size: 8, sha256: hash('return 1') }]
  ])
  const ask = vi.fn(async () => false),
    approve = approveNewResources(cache, known, ask)
  expect(await approve(['assets/main.lua'])).toBe(true)
  expect(ask).not.toHaveBeenCalled()
  await writeFile(path, 'return 2') // Same name and size are insufficient.
  expect(await approve(['assets/main.lua', 'new.lua'])).toBe(false)
  expect(ask).toHaveBeenCalledExactlyOnceWith(['assets/main.lua', 'new.lua'])
  await writeFile(path, 'return 1')
  ask.mockClear()
  expect(await approve(['assets/main.lua', 'new.lua'])).toBe(false)
  expect(ask).toHaveBeenCalledExactlyOnceWith(['new.lua'])
})
it('does not infer trust from missing hashes, uninstalled files or cache junctions', async () => {
  const cache = join(root, 'cache'),
    outside = join(root, 'outside')
  await mkdir(cache)
  await mkdir(outside)
  await writeFile(join(outside, 'main.lua'), 'return 1')
  await symlink(outside, join(cache, 'effect'), 'junction')
  const known = new Map([
    ['main.lua', { relativePath: 'effect/main.lua', size: 8, sha256: hash('return 1') }],
    ['missing.lua', { relativePath: 'absent.lua', size: 8, sha256: hash('return 1') }],
    ['nohash.lua', { relativePath: 'effect/main.lua', size: 8 }]
  ])
  expect(await approveNewResources(cache, known)([...known.keys()])).toBe(false)
})
it('rejects forged archive bytes even when the declared hash matches an installed effect', async () => {
  const cache = join(root, 'cache')
  await mkdir(cache)
  await writeFile(join(cache, 'main.lua'), 'return 1')
  const declaration = { relativePath: 'main.lua', size: 8, sha256: hash('return 1') }
  const archive = join(root, 'forged.zip'),
    zip = new ZipWriter(archive)
  await zip.add({ kind: 'buffer', zipPath: 'main.lua', data: Buffer.from('return 2') })
  await zip.finish()
  await expect(
    extractZip(archive, join(root, 'staging'), {
      mapEntry: (name) => name,
      expected: () => declaration,
      approveActiveContent: approveNewResources(cache, new Map([['main.lua', declaration]]))
    })
  ).rejects.toThrow(/Integrity check/)
})
it('does not prompt for unselected scripts that are verified but never written', async () => {
  const archive = join(root, 'selection.zip'),
    zip = new ZipWriter(archive)
  await zip.add({ kind: 'buffer', zipPath: 'not-selected.lua', data: Buffer.from('return 1') })
  await zip.finish()
  await expect(
    extractZip(archive, join(root, 'staging'), {
      mapEntry: (name) => name,
      verifyOnly: () => true
    })
  ).resolves.toEqual({ files: 1 })
})
