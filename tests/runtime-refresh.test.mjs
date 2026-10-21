import { afterEach, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import {
  securityRuntimeIndex,
  readPythonArchive,
  readDotnetArchive,
  pythonPathConfig,
  verifySecurityRuntime
} from '../scripts/runtime-refresh.mjs'
const temporary = []
afterEach(async () => {
  for (const directory of temporary.splice(0)) await rm(directory, { recursive: true, force: true })
})
it('keeps native DLL digests and replaces only the interpreter, runtime and their notices', async () => {
  const base = {
    files: {
      'artifacts/accepted.dll': 'native-digest',
      'tools/entry.py': 'source-digest',
      'python/old.dll': 'old-python',
      'dotnet/old.dll': 'old-dotnet',
      'licenses/runtime-sources.txt': 'old-notice'
    }
  }
  const py = new Map([
    ['python314.zip', Buffer.from('stdlib')],
    ['python314._pth', Buffer.from('foreign-path')]
  ])
  const net = new Map([
    ['dotnet.exe', Buffer.from('host')],
    ['LICENSE.txt', Buffer.from('license')],
    ['ThirdPartyNotices.txt', Buffer.from('notices')]
  ])
  const index = JSON.parse(
    await securityRuntimeIndex(base, py, 'CPython 3.11:\n.NET 10.0.12 runtime', net)
  )
  expect(index.files['artifacts/accepted.dll']).toBe('native-digest')
  expect(index.files['tools/entry.py']).toBe('source-digest')
  expect(index.files['python/old.dll']).toBeUndefined()
  expect(index.files['dotnet/old.dll']).toBeUndefined()
  expect(index.files['python/python314._pth']).toBe(
    createHash('sha256').update(pythonPathConfig).digest('hex')
  )
  expect(pythonPathConfig).toBe('python314.zip\n.\n../tools\n')
})
it('does not extract a substituted interpreter or .NET distribution', async () => {
  await expect(readPythonArchive(Buffer.from('not an official distribution'))).rejects.toThrow(
    /checksum/
  )
  await expect(readDotnetArchive(Buffer.from('not an official distribution'))).rejects.toThrow(
    /checksum/
  )
})
it('refuses a cached runtime with an untrusted index', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wakushare-runtime-security-'))
  temporary.push(root)
  await writeFile(join(root, 'runtime-files.json'), '{}')
  await expect(verifySecurityRuntime(root)).rejects.toThrow(/index differs/)
})
