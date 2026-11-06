/* eslint-disable @typescript-eslint/explicit-function-return-type -- JavaScript helpers have no return type syntax. */
import { afterEach, beforeEach, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join, dirname, basename, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { verifyAdaptiveRuntime } from '../scripts/native-runtime-integrity.mjs'
let root, index, marker
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
async function put(path, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value))
  await mkdir(dirname(join(root, path)), { recursive: true })
  await writeFile(join(root, path), bytes)
  index[path] = digest(bytes)
}
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'WakuShare-native-integrity-'))
  index = {}
  const name = 'CapSync.AdaptiveFixtureV1.dll',
    bytes = Buffer.from('native fixture')
  marker = {
    nativeFiles: { [name]: digest(bytes) },
    nativeManifests: {
      'artifacts/AdaptiveObserveV1/manifest.json': { Events: name },
      'artifacts/AdaptiveCommandsV1/manifest.json': { Source: name },
      'artifacts/AdaptiveSavedReadV1/manifest.json': { Read: name },
      'artifacts/AdaptiveRootRelinkV1/manifest.json': { Root: name }
    }
  }
  await put('artifacts/NativeExplorerObserveBuild/' + name, bytes)
  for (const [path, bindings] of Object.entries(marker.nativeManifests))
    await put(path, {
      binaries: Object.fromEntries(Object.keys(bindings).map((key) => [key, digest(bytes)]))
    })
  await put('adaptive-runtime.json', marker)
})
afterEach(async () => {
  if (
    dirname(root) !== resolve(tmpdir()) ||
    !basename(root).startsWith('WakuShare-native-integrity-')
  )
    throw Error('Refusing cleanup outside the test directory')
  await rm(root, { recursive: true, force: true })
})
it('verifies the complete manifest-to-binary relationship', async () => {
  await expect(verifyAdaptiveRuntime(root, index)).resolves.toBeUndefined()
})
it('rejects an omitted native binary even if the remaining files are indexed', async () => {
  delete index['artifacts/NativeExplorerObserveBuild/CapSync.AdaptiveFixtureV1.dll']
  await expect(verifyAdaptiveRuntime(root, index)).rejects.toThrow(/not indexed/)
})
it('rejects stale command hashes in an otherwise consistently indexed package', async () => {
  await put('artifacts/AdaptiveCommandsV1/manifest.json', { binaries: { Source: '0'.repeat(64) } })
  await expect(verifyAdaptiveRuntime(root, index)).rejects.toThrow(/manifest binary differs/)
})
