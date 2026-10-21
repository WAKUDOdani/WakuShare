import { prepareSecurityRuntime } from './runtime-refresh.mjs'
// Immutable build input. Never reads userData or loads a DLL into CapCut.
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { createReadStream, createWriteStream, existsSync } from 'node:fs'
import { mkdir, readFile, rename, lstat, open } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pipeline } from 'node:stream/promises'
import { Readable, Transform } from 'node:stream'

const require = createRequire(import.meta.url)
const yauzl = require('yauzl')
export const project = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const lock = JSON.parse(await readFile(join(project, 'runtime-lock.json'), 'utf8'))
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')

export async function verifyRuntime(root) {
  if (!isAbsolute(root) || root.includes('\0')) throw Error('Absolute runtime directory required')
  const bytes = await readFile(join(root, 'runtime-files.json'))
  if (hash(bytes) !== lock.indexSha256) throw Error('Runtime index differs from release lock')
  const index = JSON.parse(bytes)
  if (Object.keys(index.files).length !== lock.files) throw Error('Runtime file count differs')
  for (const [relative, expected] of Object.entries(index.files)) {
    const file = resolve(root, relative)
    if (!file.startsWith(root + sep) || (await lstat(file)).isSymbolicLink())
      throw Error('Invalid runtime file location')
    if (hash(await readFile(file)) !== expected) throw Error(`Runtime file differs: ${relative}`)
  }
  return root
}

async function extract(archive, root) {
  await mkdir(root, { recursive: true })
  await new Promise((resolvePromise, reject) => {
    yauzl.open(archive, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => {
      if (error) return reject(error)
      let count = 0,
        size = 0
      zip.on('error', reject)
      zip.on('end', resolvePromise)
      zip.on('entry', (entry) => {
        void (async () => {
          if (++count > lock.files + 1 || (size += entry.uncompressedSize) > 512 * 1024 * 1024)
            throw Error('Runtime archive bounds exceeded')
          const file = resolve(root, entry.fileName)
          if (
            !file.startsWith(root + sep) ||
            entry.fileName.includes('\\') ||
            entry.fileName.endsWith('/')
          )
            throw Error('Invalid runtime archive entry')
          if (((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000)
            throw Error('Runtime symlink rejected')
          await mkdir(dirname(file), { recursive: true })
          const stream = await new Promise((yes, no) =>
            zip.openReadStream(entry, (e, s) => (e ? no(e) : yes(s)))
          )
          await pipeline(stream, createWriteStream(file, { flags: 'wx' }))
          zip.readEntry()
        })().catch((e) => {
          zip.close()
          reject(e)
        })
      })
      zip.readEntry()
    })
  })
}

export async function prepareRuntime() {
  const fixed = process.env.WAKUSHARE_RUNTIME_DIR
  if (fixed) return prepareSecurityRuntime(await verifyRuntime(resolve(fixed)))
  const cache = join(project, '.runtime-cache', lock.sha256.slice(0, 16))
  const root = join(cache, 'runtime')
  if (existsSync(join(root, 'runtime-files.json')))
    return prepareSecurityRuntime(await verifyRuntime(root))
  await mkdir(cache, { recursive: true })
  const archive = join(cache, lock.asset)
  if (!existsSync(archive)) {
    const headers = {
      'User-Agent': 'WakuShare-runtime-build',
      Accept: 'application/vnd.github+json'
    }
    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
    let url = `https://github.com/WAKUDOdani/WakuShare/releases/download/${lock.tag}/${lock.asset}`
    if (token) {
      headers.Authorization = `Bearer ${token}`
      const response = await fetch(
        'https://api.github.com/repos/WAKUDOdani/WakuShare/releases?per_page=50',
        { headers }
      )
      if (!response.ok) throw Error(`Runtime release lookup failed (${response.status})`)
      const release = (await response.json()).find((value) => value.tag_name === lock.tag)
      const asset = release?.assets.find((value) => value.name === lock.asset)
      if (!asset || asset.size !== lock.bytes || asset.digest !== `sha256:${lock.sha256}`)
        throw Error('Runtime release asset differs from pinned input')
      url = asset.url
      headers.Accept = 'application/octet-stream'
    }
    const response = await fetch(url, { headers })
    if (!response.ok || !response.body) throw Error(`Runtime download failed (${response.status})`)
    let size = 0
    const digest = createHash('sha256')
    const guard = new Transform({
      transform(chunk, _encoding, callback) {
        size += chunk.length
        if (size > lock.bytes) return callback(Error('Runtime download exceeds pinned size'))
        digest.update(chunk)
        callback(null, chunk)
      }
    })
    const partial = archive + '.partial'
    await pipeline(
      Readable.fromWeb(response.body),
      guard,
      createWriteStream(partial, { flags: 'wx' })
    )
    if (size !== lock.bytes || digest.digest('hex') !== lock.sha256)
      throw Error('Runtime download checksum differs')
    await rename(partial, archive)
  }
  // Independently recheck the cached archive, including a resumed local build.
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(archive)) digest.update(chunk)
  if (digest.digest('hex') !== lock.sha256 || (await lstat(archive)).size !== lock.bytes)
    throw Error('Cached runtime archive checksum differs')
  const marker = await open(join(cache, 'extract.lock'), 'wx')
  try {
    await extract(archive, root)
  } finally {
    await marker.close()
  }
  return prepareSecurityRuntime(await verifyRuntime(root))
}
