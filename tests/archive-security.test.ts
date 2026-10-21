import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createWriteStream } from 'node:fs'
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pipeline } from 'node:stream/promises'
import yazl from 'yazl'
import { extractZip, readZipEntries, ZipWriter } from '../src/main/core/zip'
import { validateArchivePath } from '../src/main/core/archive-safety'
import { walkJsonStrings } from '../src/main/core/capcut/scanner'
import {
  assertExportResource,
  assertRelativeResource,
  assertResourceScheme
} from '../src/main/core/reference-policy'

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'wakushare-security-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})
async function archive(entries: { name: string; data?: Buffer; mode?: number }[]): Promise<string> {
  const file = join(root, 'input.zip'),
    zip = new yazl.ZipFile()
  const done = pipeline(zip.outputStream, createWriteStream(file))
  for (const entry of entries)
    zip.addBuffer(entry.data ?? Buffer.from('inert fixture'), entry.name, { mode: entry.mode })
  zip.end()
  await done
  return file
}

it.each([
  '../outside',
  '/absolute',
  'C:/absolute',
  'a\\b',
  'safe/file:stream',
  'safe/NUL.txt',
  'COM¹.log',
  'conout$',
  'a./file',
  'a /file',
  'a//file',
  'a/./file',
  'a/../file',
  'file\0.txt'
])('rejects ambiguous portable path %s', (name) => {
  expect(() => validateArchivePath(name)).toThrow()
})
it('keeps Unicode media names and nested data paths', () => {
  expect(validateArchivePath('Resources/local/Исходники/Работа ①.png')).toContain('①.png')
})
it('rejects duplicate metadata before returning the manifest', async () => {
  const file = await archive([{ name: 'manifest.json' }, { name: 'manifest.json' }])
  await expect(readZipEntries(file, ['manifest.json'])).rejects.toThrow(/duplicate/i)
})
it('bounds metadata before decompressing it', async () => {
  const file = await archive([{ name: 'manifest.json', data: Buffer.alloc(1024 * 1024) }])
  await expect(readZipEntries(file, ['manifest.json'], { maxEntryBytes: 1024 })).rejects.toThrow(
    /too large/i
  )
})
it('rejects linked ZIP entries instead of materializing their contents', async () => {
  const file = await archive([{ name: 'link', data: Buffer.from('../../outside'), mode: 0o120777 }])
  await expect(extractZip(file, join(root, 'dest'), { mapEntry: (n) => n })).rejects.toThrow(
    /links/i
  )
})
it('does not traverse an existing junction in an extraction destination', async () => {
  const dest = join(root, 'dest'),
    outside = join(root, 'outside')
  await mkdir(dest)
  await mkdir(outside)
  await writeFile(join(outside, 'keep.txt'), 'keep')
  await symlink(outside, join(dest, 'redirect'), process.platform === 'win32' ? 'junction' : 'dir')
  const file = await archive([{ name: 'redirect/keep.txt' }])
  await expect(extractZip(file, dest, { mapEntry: (n) => n })).rejects.toThrow(/linked/i)
  expect(await readFile(join(outside, 'keep.txt'), 'utf8')).toBe('keep')
})
it('does not overwrite an existing file or hard link', async () => {
  const dest = join(root, 'dest')
  await mkdir(dest)
  await writeFile(join(dest, 'keep.txt'), 'keep')
  const file = await archive([{ name: 'keep.txt' }])
  await expect(extractZip(file, dest, { mapEntry: (n) => n })).rejects.toThrow()
  expect(await readFile(join(dest, 'keep.txt'), 'utf8')).toBe('keep')
})
it('preflights mapped collisions before writing any payload', async () => {
  const dest = join(root, 'dest')
  await mkdir(dest)
  const file = await archive([{ name: 'one' }, { name: 'two' }])
  await expect(
    extractZip(file, dest, { mapEntry: (n) => (n === 'one' ? 'A.txt' : 'a.txt') })
  ).rejects.toThrow(/duplicate/i)
  expect(await readdir(dest)).toEqual([])
})
it('rejects undeclared payloads and mapping errors without uncaught event exceptions', async () => {
  const file = await archive([{ name: 'payload.txt' }])
  await expect(
    extractZip(file, join(root, 'dest'), { mapEntry: (n) => n, expected: () => undefined })
  ).rejects.toThrow(/undeclared/i)
  await expect(
    extractZip(file, join(root, 'dest'), {
      mapEntry: () => {
        throw Error('mapping rejected')
      }
    })
  ).rejects.toThrow('mapping rejected')
})

it.each(['plugin.dll', 'run.cmd', 'image.png.lnk', 'startup.ps1', 'dir.exe/content.png'])(
  'rejects launchable payload %s even when trust is granted',
  async (name) => {
    const file = await archive([{ name }])
    await expect(
      extractZip(file, join(root, 'dest'), {
        mapEntry: (n) => n,
        approveActiveContent: async () => true
      })
    ).rejects.toThrow(/executable/i)
  }
)
it.each(['MZinert', '#!inert', '\x7fELFinert'])(
  'rejects disguised executable header %s without executing it',
  async (header) => {
    const file = await archive([{ name: 'photo.png', data: Buffer.from(header) }])
    await expect(extractZip(file, join(root, 'dest'), { mapEntry: (n) => n })).rejects.toThrow(
      /disguised/i
    )
  }
)
it('denies scripts by default and asks once before writing a trusted resource set', async () => {
  const file = await archive([{ name: 'effect/main.lua' }, { name: 'effect/view.js' }])
  await expect(extractZip(file, join(root, 'denied'), { mapEntry: (n) => n })).rejects.toThrow(
    /explicit trust/i
  )
  expect(await readdir(root)).toEqual(['input.zip'])
  const approve = vi.fn(async () => true)
  await extractZip(file, join(root, 'approved'), {
    mapEntry: (n) => n,
    approveActiveContent: approve
  })
  expect(approve).toHaveBeenCalledExactlyOnceWith(['effect/main.lua', 'effect/view.js'])
  expect(await readFile(join(root, 'approved/effect/main.lua'), 'utf8')).toBe('inert fixture')
})
it('does not ask for plain media and does ask for opaque effect configurations', async () => {
  const approve = vi.fn(async () => true)
  const file = await archive([{ name: 'photo.png' }])
  await extractZip(file, join(root, 'plain'), { mapEntry: (n) => n, approveActiveContent: approve })
  expect(approve).not.toHaveBeenCalled()
  await extractZip(file, join(root, 'effect'), {
    mapEntry: (n) => n,
    activeResource: () => true,
    approveActiveContent: approve
  })
  expect(approve).toHaveBeenCalledOnce()
})
it('propagates security failures in embedded JSON and bounds nested JSON', () => {
  const document = { inner: JSON.stringify({ path: 'forbidden' }) }
  expect(() =>
    walkJsonStrings(document, (value) => {
      if (value === 'forbidden') throw Error('Security rejection')
      return undefined
    })
  ).toThrow('Security rejection')
  let nested: unknown = 'text'
  for (let i = 0; i < 140; i++) nested = { child: nested }
  expect(() => walkJsonStrings(nested, () => undefined)).toThrow(/complexity/)
})
it('rejects local secret, UNC, traversal and shell URI resource references', () => {
  for (const path of ['C:/private/token.txt', '//server/share/a.png', 'C:/private/key.pem'])
    expect(() => assertExportResource(path)).toThrow()
  for (const path of ['../a.png', 'effect/../../a.lua', 'file:ads'])
    expect(() => assertRelativeResource(path)).toThrow()
  for (const value of ['file:///C:/Windows/a.exe', 'javascript:inert', 'ms-msdt:inert'])
    expect(() => assertResourceScheme(value, '/materials/0/path')).toThrow()
  expect(() => assertExportResource('C:/media/Съёмка.mp4')).not.toThrow()
})
it('turns a failing progress subscriber into a rejected operation', async () => {
  const file = await archive([{ name: 'photo.png' }])
  await expect(
    extractZip(file, join(root, 'dest'), {
      mapEntry: (n) => n,
      onBytes: () => {
        throw Error('Subscriber failed')
      }
    })
  ).rejects.toThrow('Subscriber failed')
})
it('settles export if the destination fails while a large source is streaming', async () => {
  const source = join(root, 'source.mp4')
  await writeFile(source, Buffer.alloc(2 * 1024 ** 2, 42))
  const writer = new ZipWriter(join(root, 'missing-parent', 'archive.zip'))
  try {
    await expect(
      writer.add({ kind: 'file', absPath: source, zipPath: 'media.mp4' })
    ).rejects.toThrow()
  } finally {
    await writer.abort()
  }
})
