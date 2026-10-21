import {
  assertDataFilename,
  assertDataSignature,
  approveResources,
  requiresContentTrust,
  type ApproveActiveContent
} from './payload-policy'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { stat, statfs } from 'node:fs/promises'
import { PassThrough, Transform, Writable, type Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import yauzl from 'yauzl'
import yazl from 'yazl'
import { CapShareError } from './errors'
import {
  ARCHIVE_LIMITS,
  ArchiveDestination,
  archiveError,
  archivePathKey,
  validateArchivePath
} from './archive-safety'

export interface ZipWriterEntryFile {
  kind: 'file'
  absPath: string
  zipPath: string
  /** Pre-read content to use instead of reading from disk (snapshot entries). */
  snapshot?: Buffer
}

export interface ZipWriterEntryBuffer {
  kind: 'buffer'
  data: Buffer
  zipPath: string
  /** Exclude from byte-progress (e.g. the manifest, unknown at planning time). */
  uncounted?: boolean
}

export type ZipWriterEntry = ZipWriterEntryFile | ZipWriterEntryBuffer

export interface AddedEntry {
  zipPath: string
  size: number
  sha256: string
}

/**
 * Streaming zip writer around yazl: one read pass per file computes the
 * SHA-256 inline while bytes flow into the archive (ZIP64-capable, no
 * whole-file buffering). `compress: false` for already-compressed media would
 * be possible, but uniform deflate keeps the format simple.
 */
export class ZipWriter {
  private readonly zip = new yazl.ZipFile()
  private readonly done: Promise<void>
  private readonly onBytes?: (chunkLength: number) => void
  private aborted = false

  constructor(destPath: string, onBytes?: (chunkLength: number) => void) {
    this.onBytes = onBytes
    this.zip.on('error', (error) => (this.zip.outputStream as Readable).destroy(error))
    const out = createWriteStream(destPath, { flags: 'wx' })
    this.done = pipeline(this.zip.outputStream, out)
    void this.done.catch(() => {}) // The caller reports failure through finish/abort.
  }

  /** Adds one entry, resolving with its size + sha256 once fully consumed. */
  async add(entry: ZipWriterEntry, signal?: AbortSignal): Promise<AddedEntry> {
    assertDataFilename(entry.zipPath)
    if (signal?.aborted || this.aborted) {
      this.aborted = true
      throw new CapShareError('CANCELLED', 'Operation cancelled')
    }

    if (entry.kind === 'buffer' || entry.snapshot) {
      const data = entry.kind === 'buffer' ? entry.data : entry.snapshot!
      assertDataSignature(data.subarray(0, 4))
      const sha256 = createHash('sha256').update(data).digest('hex')
      this.zip.addBuffer(data, entry.zipPath)
      if (!(entry.kind === 'buffer' && entry.uncounted)) this.onBytes?.(data.length)
      return { zipPath: entry.zipPath, size: data.length, sha256 }
    }

    const before = await stat(entry.absPath)
    const hash = createHash('sha256')
    let size = 0
    let prefix = Buffer.alloc(0)
    const onBytes = this.onBytes
    const counter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        try {
          if (prefix.length < 4) {
            prefix = Buffer.concat([prefix, chunk.subarray(0, 4 - prefix.length)])
            assertDataSignature(prefix)
          }
          hash.update(chunk)
          size += chunk.length
          onBytes?.(chunk.length)
          cb(null, chunk)
        } catch (error) {
          cb(error as Error)
        }
      }
    })

    const source = createReadStream(entry.absPath)
    const tee = new PassThrough()
    // yazl consumes `tee`; the pipeline below resolves when the file is fully read.
    this.zip.addReadStream(tee, entry.zipPath, {
      compress:
        !/\.(?:mp4|mov|mkv|webm|jpg|jpeg|png|gif|mp3|wav|aac|m4a|flac|webp|zip|capshare)$/i.test(
          entry.absPath
        )
    })
    const transfer = pipeline(source, counter, tee, { signal })
    try {
      await Promise.race([
        transfer,
        this.done.then(() => {
          throw new Error('Archive output closed during transfer')
        })
      ])
    } catch (error) {
      source.destroy(error as Error)
      tee.destroy(error as Error)
      await transfer.catch(() => {})
      throw error
    }
    const after = await stat(entry.absPath)
    if (before.size !== size || before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
      throw new CapShareError(
        'EXPORT_CHANGED_DURING',
        `File changed while being archived: ${entry.absPath}`
      )
    }
    return { zipPath: entry.zipPath, size, sha256: hash.digest('hex') }
  }

  /** Finalizes the archive and waits for the destination file to be flushed. */
  async finish(): Promise<void> {
    this.zip.end()
    await this.done
  }

  async abort(): Promise<void> {
    this.aborted = true
    ;(this.zip.outputStream as Readable).destroy()
    await this.done.catch(() => {})
  }
}

function openZip(path: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(
      path,
      { lazyEntries: true, autoClose: false, strictFileNames: true, validateEntrySizes: true },
      (err, zip) => {
        if (err || !zip) reject(err ?? archiveError('Cannot open archive'))
        else resolve(zip)
      }
    )
  })
}

/** Read bounded central-directory metadata before any payload is materialized. */
function listEntries(zip: yauzl.ZipFile): Promise<yauzl.Entry[]> {
  return new Promise((resolve, reject) => {
    const entries: yauzl.Entry[] = [],
      names = new Set<string>()
    let bytes = 0
    zip.on('error', reject)
    zip.on('end', () => resolve(entries))
    zip.on('entry', (entry: yauzl.Entry) => {
      try {
        const directory = entry.fileName.endsWith('/')
        const name = directory ? entry.fileName.slice(0, -1) : entry.fileName
        validateArchivePath(name)
        const key = archivePathKey(name)
        if (names.has(key)) throw archiveError('Duplicate or ambiguous archive entry')
        names.add(key)
        const type = (entry.externalFileAttributes >>> 16) & 0xf000
        if (
          (type && type !== (directory ? 0x4000 : 0x8000)) ||
          entry.externalFileAttributes & 0x400
        )
          throw archiveError('Links and special archive entries are not supported')
        if (entry.generalPurposeBitFlag & 1)
          throw archiveError('Encrypted entries are not supported')
        if (
          !Number.isSafeInteger(entry.uncompressedSize) ||
          entry.uncompressedSize < 0 ||
          entry.uncompressedSize > ARCHIVE_LIMITS.entryBytes
        )
          throw archiveError('Archive entry is too large')
        bytes +=
          Buffer.byteLength(entry.fileName) +
          Buffer.byteLength(entry.fileComment) +
          entry.extraFields.reduce((n, field) => n + field.data.length, 0)
        if (names.size > ARCHIVE_LIMITS.entries || bytes > ARCHIVE_LIMITS.namesBytes)
          throw archiveError('Archive directory is too large')
        if (!directory) entries.push(entry)
        zip.readEntry()
      } catch (error) {
        reject(error)
      }
    })
    zip.readEntry()
  })
}

function entryStream(zip: yauzl.ZipFile, entry: yauzl.Entry): Promise<Readable> {
  return new Promise((resolve, reject) =>
    zip.openReadStream(entry, (error, stream) => {
      if (error || !stream) reject(error ?? archiveError('Cannot read archive entry'))
      else resolve(stream)
    })
  )
}

export interface ZipReadLimits {
  maxEntryBytes?: number | ((name: string) => number)
  maxTotalBytes?: number
}

/** Bounded buffers are reserved for metadata; media continues to stream. */
export async function readZipEntries(
  zipPath: string,
  names: readonly string[],
  limits: ZipReadLimits = {}
): Promise<Map<string, Buffer>> {
  const wanted = new Set(names),
    found = new Map<string, Buffer>()
  if (!wanted.size) return found
  const zip = await openZip(zipPath)
  try {
    const entries = (await listEntries(zip)).filter((entry) => wanted.has(entry.fileName))
    let total = 0
    for (const entry of entries) {
      const limit =
        typeof limits.maxEntryBytes === 'function'
          ? limits.maxEntryBytes(entry.fileName)
          : (limits.maxEntryBytes ?? ARCHIVE_LIMITS.metadataBytes)
      if (
        entry.uncompressedSize > limit ||
        (total += entry.uncompressedSize) >
          (limits.maxTotalBytes ?? ARCHIVE_LIMITS.metadataTotalBytes)
      )
        throw archiveError('Archive metadata is too large')
      const stream = await entryStream(zip, entry),
        chunks: Buffer[] = []
      let size = 0
      for await (const chunk of stream) {
        size += chunk.length
        if (size > entry.uncompressedSize || size > limit) {
          stream.destroy()
          throw archiveError('Archive metadata exceeded its declared size')
        }
        chunks.push(chunk)
      }
      if (size !== entry.uncompressedSize) throw archiveError('Archive metadata size mismatch')
      found.set(entry.fileName, Buffer.concat(chunks, size))
    }
  } finally {
    zip.close()
  }
  return found
}

export interface ExtractOptions {
  /** Map an entry to a destination-relative path, or null to skip it. */
  mapEntry: (entryName: string) => string | null
  onBytes?: (chunkLength: number) => void
  signal?: AbortSignal
  /** When supplied, every selected entry MUST have a declaration. */
  expected?: (entryName: string, entrySize: number) => { size: number; sha256?: string } | undefined
  approveActiveContent?: ApproveActiveContent
  /** Configured by the importer, never by the archive manifest. */
  activeResource?: (entryName: string) => boolean
  verifyOnly?: (entryName: string) => boolean
}

/** One streaming read per payload, exclusive creation, and no archive-provided links. */
export async function extractZip(
  zipPath: string,
  destDir: string,
  options: ExtractOptions
): Promise<{ files: number }> {
  const zip = await openZip(zipPath)
  try {
    const selected: {
      entry: yauzl.Entry
      mapped: string
      expected: { size: number; sha256?: string } | undefined
      verify: boolean
    }[] = []
    const targets = new Set<string>()
    let total = 0
    for (const entry of await listEntries(zip)) {
      if (options.signal?.aborted) throw new CapShareError('CANCELLED', 'Operation cancelled')
      const mapped = options.mapEntry(entry.fileName)
      if (mapped === null) continue
      assertDataFilename(entry.fileName)
      assertDataFilename(mapped)
      const key = archivePathKey(mapped)
      if (targets.has(key)) throw archiveError('Duplicate archive destination')
      targets.add(key)
      const expected = options.expected?.(entry.fileName, entry.uncompressedSize)
      if (options.expected && !expected) throw archiveError('Undeclared archive payload')
      if (
        expected &&
        (!Number.isSafeInteger(expected.size) ||
          expected.size !== entry.uncompressedSize ||
          (expected.sha256 && !/^[a-f0-9]{64}$/i.test(expected.sha256)))
      )
        throw archiveError('Integrity check failed: archive payload declaration mismatch')
      const verify = options.verifyOnly?.(entry.fileName) ?? false
      if (!verify) total += entry.uncompressedSize
      if (!Number.isSafeInteger(total)) throw archiveError('Archive is too large')
      selected.push({ entry, mapped, expected, verify })
    }
    for (const target of targets) {
      const parts = target.split('/')
      for (let i = 1; i < parts.length; i++)
        if (targets.has(parts.slice(0, i).join('/')))
          throw archiveError('Archive file/directory collision')
    }
    await approveResources(
      selected
        .filter(
          ({ entry }) =>
            requiresContentTrust(entry.fileName) || options.activeResource?.(entry.fileName)
        )
        .map(({ entry }) => entry.fileName),
      options.approveActiveContent
    )
    const destination = await ArchiveDestination.create(destDir)
    const disk = await statfs(destination.root)
    if (total > Math.max(0, disk.bavail * disk.bsize - 64 * 1024 ** 2))
      throw archiveError('Not enough free space for this archive')
    let files = 0
    for (const { entry, mapped, expected, verify } of selected) {
      if (options.signal?.aborted) throw new CapShareError('CANCELLED', 'Operation cancelled')
      const target = verify ? null : await destination.target(mapped)
      const stream = await entryStream(zip, entry)
      const hash = expected?.sha256 ? createHash('sha256') : null
      let size = 0
      let prefix = Buffer.alloc(0)
      const counter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          size += chunk.length
          if (size > entry.uncompressedSize) {
            callback(archiveError('Payload exceeded its declared size'))
            return
          }
          try {
            if (prefix.length < 4) {
              prefix = Buffer.concat([prefix, chunk.subarray(0, 4 - prefix.length)])
              assertDataSignature(prefix)
            }
            hash?.update(chunk)
            options.onBytes?.(chunk.length)
            callback(null, chunk)
          } catch (error) {
            callback(error as Error)
          }
        }
      })
      const sink = target
        ? createWriteStream(target, { flags: 'wx' })
        : new Writable({
            write(_chunk, _encoding, callback) {
              callback()
            }
          })
      await pipeline(stream, counter, sink, { signal: options.signal })
      if (
        size !== entry.uncompressedSize ||
        (hash && hash.digest('hex') !== expected!.sha256!.toLowerCase())
      )
        throw archiveError('Integrity check failed: archive payload mismatch')
      files++
    }
    return { files }
  } finally {
    zip.close()
  }
}
