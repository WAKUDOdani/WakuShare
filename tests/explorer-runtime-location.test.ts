import { join } from 'node:path'
import { expect, it } from 'vitest'
import { explorerRuntimeLocation } from '../src/main/sync/runtime-location'

const workspace = join(process.cwd(), '..', '..')
const base = {
  packaged: true,
  appPath: join(process.cwd(), 'resources', 'app.asar'),
  resourcesPath: join(process.cwd(), 'resources'),
  localPreview: false,
  exists: () => true
}
it('keeps ordinary packaged releases on their bundled runtime', () => {
  expect(explorerRuntimeLocation(base)).toEqual({
    executable: join(base.resourcesPath, 'explorer', 'CapSync.Observer.exe'),
    nativeRoot: undefined
  })
})
it('never enables a linked workspace in a normal release', () => {
  expect(explorerRuntimeLocation({ ...base, previewWorkspace: workspace })).toBeNull()
})
it('ships the frozen product worker with its interpreters in ordinary releases', () => {
  const root = join(base.resourcesPath, 'explorer')
  const options = { ...base, productRuntime: true }
  expect(explorerRuntimeLocation(options)).toEqual({
    executable: join(root, 'artifacts', 'ExplorerProductWorkerV8', 'CapSync.Observer.exe'),
    nativeRoot: root,
    nativeMode: 'product'
  })
  for (const missing of [
    'python.exe',
    'dotnet.exe',
    'ffprobe.exe',
    'sdk-contract.json',
    'manifest.json'
  ])
    expect(explorerRuntimeLocation({ ...options, exists: (p) => !p.endsWith(missing) })).toBeNull()
})
it('connects only an explicit local preview with its complete fixed runtime', () => {
  expect(
    explorerRuntimeLocation({ ...base, localPreview: true, previewWorkspace: workspace })
  ).toEqual({
    executable: join(
      workspace,
      'src',
      'CapSync.Cli',
      'bin',
      'Debug',
      'net10.0',
      'CapSync.Observer.exe'
    ),
    nativeRoot: workspace
  })
  for (const missing of ['CapSync.Observer.exe', 'manifest.json', 'explorer_native_runtime.py'])
    expect(
      explorerRuntimeLocation({
        ...base,
        localPreview: true,
        previewWorkspace: workspace,
        exists: (path) => !path.endsWith(missing)
      })
    ).toBeNull()
})
it('rejects relative paths and does not manufacture a missing packaged runtime', () => {
  expect(
    explorerRuntimeLocation({ ...base, localPreview: true, previewWorkspace: '../other' })
  ).toBeNull()
  expect(explorerRuntimeLocation({ ...base, exists: () => false })).toBeNull()
})

it('selects the separate product worker only for an explicit local product preview', () => {
  const options = { ...base, localPreview: true, previewWorkspace: workspace, productRuntime: true }
  expect(explorerRuntimeLocation(options)).toEqual({
    executable: join(workspace, 'artifacts', 'ExplorerProductWorkerV8', 'CapSync.Observer.exe'),
    nativeRoot: workspace,
    nativeMode: 'product'
  })
  expect(explorerRuntimeLocation({ ...options, localPreview: false })).toBeNull()
  for (const missing of ['CapSync.Observer.exe', 'manifest.json', 'explorer_product_runtime_v6.py'])
    expect(
      explorerRuntimeLocation({ ...options, exists: (path) => !path.endsWith(missing) })
    ).toBeNull()
})
