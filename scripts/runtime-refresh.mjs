// Build-time interpreter refresh; accepted native binaries remain byte-for-byte identical.
import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { copyFile, mkdir, readFile, writeFile, lstat, rename, readdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)
const yauzl = require('yauzl')
const project = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const security = JSON.parse(await readFile(join(project, 'runtime-security-lock.json'), 'utf8'))
const lock = security.python
const dotnetLock = security.dotnet
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
export const pythonPathConfig = 'python314.zip\n.\n../tools\n'

export async function securityRuntimeIndex(baseIndex, pythonFiles, notice, dotnetFiles) {
  const files = Object.fromEntries(
    Object.entries(baseIndex.files).filter(
      ([name]) => !name.startsWith('python/') && !name.startsWith('dotnet/')
    )
  )
  for (const [name, bytes] of pythonFiles) files['python/' + name] = sha(bytes)
  files['python/python314._pth'] = sha(Buffer.from(pythonPathConfig))
  files['licenses/runtime-sources.txt'] = sha(
    Buffer.from(
      notice.replace('CPython 3.11:', 'CPython 3.14.8:').replaceAll('.NET 10.0.12', '.NET 10.0.13')
    )
  )
  for (const [name, bytes] of dotnetFiles) files['dotnet/' + name] = sha(bytes)
  for (const name of ['LICENSE.txt', 'ThirdPartyNotices.txt'])
    files['licenses/dotnet-' + name] = sha(dotnetFiles.get(name))
  const sorted = Object.fromEntries(
    Object.entries(files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  )
  return Buffer.from(
    JSON.stringify({ version: 'security-python-3.14.8-dotnet-10.0.13', files: sorted }, null, 2)
  )
}

export const readPythonArchive = (bytes) => readDistribution(bytes, lock, 'sha256', true)
export const readDotnetArchive = (bytes) => readDistribution(bytes, dotnetLock, 'sha512', false)
async function readDistribution(bytes, policy, algorithm, flat) {
  if (
    bytes.length !== policy.bytes ||
    createHash(algorithm).update(bytes).digest('hex') !== policy[algorithm]
  )
    throw Error('Runtime distribution checksum differs')
  const zip = await new Promise((yes, no) =>
    yauzl.fromBuffer(
      bytes,
      { lazyEntries: true, validateEntrySizes: true, strictFileNames: true },
      (e, z) => (e ? no(e) : yes(z))
    )
  )
  return new Promise((yes, no) => {
    const files = new Map()
    let size = 0
    const fail = (e) => {
      zip.close()
      no(e)
    }
    zip.on('error', fail)
    zip.on('end', () => yes(files))
    zip.on('entry', (entry) => {
      void (async () => {
        if (
          !(flat ? /^[\w.-]+$/ : /^[\w./-]+$/).test(entry.fileName) ||
          entry.fileName.split('/').some((n) => n === '..' || n === '.') ||
          entry.fileName.startsWith('/') ||
          files.has(entry.fileName) ||
          files.size >= 500 ||
          ((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000 ||
          (size += entry.uncompressedSize) > 256 * 1024 ** 2
        )
          throw Error('Invalid Python distribution layout')
        if (entry.fileName.endsWith('/')) {
          zip.readEntry()
          return
        }
        const stream = await new Promise((yes, no) =>
          zip.openReadStream(entry, (e, s) => (e ? no(e) : yes(s)))
        )
        const chunks = []
        let count = 0
        for await (const chunk of stream) {
          count += chunk.length
          if (count > entry.uncompressedSize) throw Error('Invalid Python payload size')
          chunks.push(chunk)
        }
        if (count !== entry.uncompressedSize) throw Error('Invalid Python payload size')
        files.set(entry.fileName, Buffer.concat(chunks, count))
        zip.readEntry()
      })().catch(fail)
    })
    zip.readEntry()
  })
}

export async function verifySecurityRuntime(root) {
  const indexBytes = await readFile(join(root, 'runtime-files.json'))
  if (sha(indexBytes) !== security.indexSha256)
    throw Error('Security runtime index differs from lock')
  const index = JSON.parse(indexBytes)
  const found = []
  async function walk(dir, prefix = '') {
    for (const name of await readdir(dir)) {
      const file = join(dir, name),
        rel = prefix + name,
        info = await lstat(file)
      if (info.isSymbolicLink()) throw Error('Linked runtime file')
      if (info.isDirectory()) await walk(file, rel + '/')
      else found.push(rel)
    }
  }
  await walk(root)
  if (found.length !== Object.keys(index.files).length + 1)
    throw Error('Unexpected security runtime files')
  for (const [name, digest] of Object.entries(index.files))
    if (sha(await readFile(join(root, name))) !== digest)
      throw Error('Security runtime file differs: ' + name)
  return root
}

export async function prepareSecurityRuntime(base) {
  const cache = join(project, '.runtime-cache', 'security-' + security.indexSha256.slice(0, 16))
  const root = join(cache, 'runtime')
  try {
    await lstat(root)
    return await verifySecurityRuntime(root)
  } catch (e) {
    if (e.code !== 'ENOENT') throw e
  }
  await mkdir(cache, { recursive: true })
  const archive = join(cache, 'python.zip')
  let bytes
  try {
    bytes = await readFile(archive)
  } catch (e) {
    if (e.code !== 'ENOENT') throw e
    const response = await fetch(lock.url)
    if (!response.ok) throw Error('Python distribution download failed')
    const chunks = []
    let count = 0
    for await (const chunk of response.body) {
      count += chunk.length
      if (count > lock.bytes) throw Error('Python download exceeds pinned size')
      chunks.push(chunk)
    }
    bytes = Buffer.concat(chunks, count)
    if (bytes.length !== lock.bytes || sha(bytes) !== lock.sha256)
      throw Error('Python download checksum differs')
    await writeFile(archive, bytes, { flag: 'wx' })
  }
  const python = await readPythonArchive(bytes)
  const dotnetArchive = join(cache, 'dotnet.zip')
  let dotnetBytes
  try {
    dotnetBytes = await readFile(dotnetArchive)
  } catch (e) {
    if (e.code !== 'ENOENT') throw e
    const response = await fetch(dotnetLock.url)
    if (!response.ok) throw Error('.NET download failed')
    const chunks = []
    let size = 0
    for await (const chunk of response.body) {
      size += chunk.length
      if (size > dotnetLock.bytes) throw Error('.NET download exceeds pinned size')
      chunks.push(chunk)
    }
    dotnetBytes = Buffer.concat(chunks, size)
    if (
      size !== dotnetLock.bytes ||
      createHash('sha512').update(dotnetBytes).digest('hex') !== dotnetLock.sha512
    )
      throw Error('.NET download checksum differs')
    await writeFile(dotnetArchive, dotnetBytes, { flag: 'wx' })
  }
  const dotnet = await readDotnetArchive(dotnetBytes)
  const baseIndex = JSON.parse(await readFile(join(base, 'runtime-files.json'), 'utf8'))
  const notice = await readFile(join(base, 'licenses/runtime-sources.txt'), 'utf8')
  const index = await securityRuntimeIndex(baseIndex, python, notice, dotnet)
  if (sha(index) !== security.indexSha256)
    throw Error('Generated security runtime differs from lock')
  const stage = join(cache, 'stage-' + randomUUID())
  await mkdir(stage)
  for (const name of Object.keys(baseIndex.files).filter(
    (name) => !name.startsWith('python/') && !name.startsWith('dotnet/')
  )) {
    await mkdir(dirname(join(stage, name)), { recursive: true })
    await copyFile(join(base, name), join(stage, name))
  }
  await mkdir(join(stage, 'python'))
  for (const [name, data] of python)
    await writeFile(join(stage, 'python', name), data, { flag: 'wx' })
  for (const [name, data] of dotnet) {
    await mkdir(dirname(join(stage, 'dotnet', name)), { recursive: true })
    await writeFile(join(stage, 'dotnet', name), data, { flag: 'wx' })
  }
  for (const name of ['LICENSE.txt', 'ThirdPartyNotices.txt'])
    await writeFile(join(stage, 'licenses/dotnet-' + name), dotnet.get(name))
  await writeFile(join(stage, 'python/python314._pth'), pythonPathConfig)
  await writeFile(
    join(stage, 'licenses/runtime-sources.txt'),
    notice.replace('CPython 3.11:', 'CPython 3.14.8:').replaceAll('.NET 10.0.12', '.NET 10.0.13')
  )
  await writeFile(join(stage, 'runtime-files.json'), index, { flag: 'wx' })
  await verifySecurityRuntime(stage)
  await rename(stage, root)
  return root
}
