import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const object = (value) => value && typeof value === 'object' && !Array.isArray(value)

export async function verifyAdaptiveRuntime(root, indexed) {
  let bytes
  try {
    bytes = await readFile(join(root, 'adaptive-runtime.json'))
  } catch (error) {
    if (error.code === 'ENOENT') return
    throw error
  }
  if (indexed['adaptive-runtime.json'] !== sha(bytes))
    throw Error('Adaptive runtime marker is not indexed')
  const marker = JSON.parse(bytes)
  if (
    !object(marker.nativeFiles) ||
    !object(marker.nativeManifests) ||
    Object.keys(marker.nativeFiles).length < 1 ||
    Object.keys(marker.nativeFiles).length > 32 ||
    Object.keys(marker.nativeManifests).length !== 4
  )
    throw Error('Adaptive native manifest declarations are incomplete')
  for (const [name, expected] of Object.entries(marker.nativeFiles)) {
    if (!/^CapSync\.Adaptive[A-Za-z0-9]+V\d+\.dll$/.test(name) || !/^[a-f0-9]{64}$/.test(expected))
      throw Error('Invalid adaptive native binary declaration')
    const relative = 'artifacts/NativeExplorerObserveBuild/' + name
    if (indexed[relative] !== expected || sha(await readFile(join(root, relative))) !== expected)
      throw Error('Native binary differs or is not indexed: ' + name)
  }
  for (const [path, bindings] of Object.entries(marker.nativeManifests)) {
    if (
      !/^artifacts\/Adaptive(?:Observe|Commands|SavedRead|RootRelink)V\d+\/manifest\.json$/.test(
        path
      ) ||
      !object(bindings)
    )
      throw Error('Invalid adaptive manifest location')
    const bytes = await readFile(join(root, path))
    if (indexed[path] !== sha(bytes)) throw Error('Native manifest is not indexed: ' + path)
    const declared = JSON.parse(bytes).binaries
    if (
      !object(declared) ||
      Object.keys(bindings).sort().join(',') !== Object.keys(declared).sort().join(',')
    )
      throw Error('Native manifest membership differs: ' + path)
    for (const [operation, name] of Object.entries(bindings)) {
      if (
        !/^[A-Z][A-Za-z]+$/.test(operation) ||
        !Object.hasOwn(marker.nativeFiles, name) ||
        declared[operation] !== marker.nativeFiles[name]
      )
        throw Error('Native manifest binary differs: ' + path + ':' + operation)
    }
  }
}
