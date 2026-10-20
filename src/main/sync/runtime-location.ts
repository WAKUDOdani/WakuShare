import { isAbsolute, join } from 'node:path'

export interface ExplorerRuntimeLocation {
  executable: string
  nativeRoot?: string
  nativeMode?: 'product'
}

/** The preview path is a build-time main constant; renderer/launch args never set it. */
export function explorerRuntimeLocation(options: {
  packaged: boolean
  appPath: string
  resourcesPath: string
  localPreview: boolean
  previewWorkspace?: string
  productRuntime?: boolean
  exists: (path: string) => boolean
}): ExplorerRuntimeLocation | null {
  if (options.previewWorkspace && !options.localPreview) return null
  const workspace =
    options.previewWorkspace || (!options.packaged ? join(options.appPath, '..', '..') : undefined)
  if (workspace && (!isAbsolute(workspace) || workspace.includes('\0'))) return null
  if (options.productRuntime) {
    const root = options.localPreview
      ? workspace
      : options.packaged
        ? join(options.resourcesPath, 'explorer')
        : workspace
    if (!root) return null
    const executable = join(root, 'artifacts', 'ExplorerProductWorkerV8', 'CapSync.Observer.exe')
    const required = [
      executable,
      join(root, 'artifacts', 'ExplorerProductCommandsV10', 'manifest.json'),
      join(root, 'artifacts', 'ExplorerProductObserveV6', 'manifest.json'),
      join(root, 'tools', 'explorer_product_runtime_v6.py'),
      ...(!options.localPreview && options.packaged
        ? [
            join(root, 'python', 'python.exe'),
            join(root, 'dotnet', 'dotnet.exe'),
            join(root, 'bin', 'ffprobe.exe'),
            join(root, 'sdk-contract.json')
          ]
        : [])
    ]
    return required.every(options.exists)
      ? { executable, nativeRoot: root, nativeMode: 'product' }
      : null
  }
  const executable = options.previewWorkspace
    ? join(
        options.previewWorkspace,
        'src',
        'CapSync.Cli',
        'bin',
        'Debug',
        'net10.0',
        'CapSync.Observer.exe'
      )
    : options.packaged
      ? join(options.resourcesPath, 'explorer', 'CapSync.Observer.exe')
      : join(
          options.appPath,
          '..',
          'CapSync.Cli',
          'bin',
          'Debug',
          'net10.0',
          'CapSync.Observer.exe'
        )
  if (!options.exists(executable)) return null
  const nativeRoot =
    workspace &&
    options.exists(join(workspace, 'artifacts', 'ExplorerRuntime', 'manifest.json')) &&
    options.exists(join(workspace, 'tools', 'explorer_native_runtime.py'))
      ? workspace
      : undefined
  if (options.previewWorkspace && !nativeRoot) return null
  return { executable, nativeRoot }
}
