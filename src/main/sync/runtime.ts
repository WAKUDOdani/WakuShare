import { app } from 'electron'
import { existsSync } from 'node:fs'
import { mkdir, open } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { ExplorerWorkerClient, type WorkerLaunchOptions } from './worker-client'
import { isLocalPreview } from '../../shared/build'
import { explorerRuntimeLocation } from './runtime-location'

declare const __WAKUSHARE_EXPLORER_WORKSPACE__: string
declare const __WAKUSHARE_EXPLORER_PRODUCT__: boolean

export function explorerProductEnabled(): boolean {
  return typeof __WAKUSHARE_EXPLORER_PRODUCT__ !== 'undefined' && __WAKUSHARE_EXPLORER_PRODUCT__
}

export function explorerPreviewWorkspace(): string | undefined {
  const value =
    typeof __WAKUSHARE_EXPLORER_WORKSPACE__ === 'undefined'
      ? undefined
      : __WAKUSHARE_EXPLORER_WORKSPACE__ || undefined
  return isLocalPreview() ? value : undefined
}

export async function createExplorerWorker(
  callbacks: Pick<WorkerLaunchOptions, 'onState' | 'onFailure'>
): Promise<ExplorerWorkerClient | null> {
  if (process.platform !== 'win32') return null
  const location = explorerRuntimeLocation({
    packaged: app.isPackaged,
    appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath,
    localPreview: isLocalPreview(),
    previewWorkspace: explorerPreviewWorkspace(),
    productRuntime: explorerProductEnabled(),
    exists: existsSync
  })
  if (!location) return null
  const { executable, nativeRoot, nativeMode } = location
  const bundled = nativeMode === 'product' && !isLocalPreview() && app.isPackaged
  const stateFile = join(app.getPath('userData'), 'explorer', 'worker-state.json')
  await mkdir(dirname(stateFile), { recursive: true })
  try {
    const file = await open(stateFile, 'wx')
    try {
      await file.writeFile(
        JSON.stringify({ SchemaVersion: 1, Bindings: [], Sources: [], Pending: [] })
      )
      await file.sync()
    } finally {
      await file.close()
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
  return new ExplorerWorkerClient({
    executable,
    stateFile,
    nativeRoot,
    nativeMode,
    environment:
      bundled && nativeRoot
        ? {
            ...safeRuntimeEnvironment(process.env),
            PATH: [join(nativeRoot, 'python'), join(nativeRoot, 'bin'), process.env.PATH]
              .filter(Boolean)
              .join(';'),
            DOTNET_ROOT: join(nativeRoot, 'dotnet'),
            DOTNET_ROOT_X64: join(nativeRoot, 'dotnet'),
            DOTNET_MULTILEVEL_LOOKUP: '0',
            PYTHONHOME: join(nativeRoot, 'python'),
            PYTHONNOUSERSITE: '1',
            PYTHONSAFEPATH: '1',
            PYTHONPATH: join(nativeRoot, 'tools'),
            PYTHONDONTWRITEBYTECODE: '1',
            WAKUSHARE_NATIVE_CACHE: join(app.getPath('userData'), 'explorer', 'native-modules')
          }
        : undefined,
    timeoutMs: nativeRoot ? 120000 : 10000,
    ...callbacks
  })
}

/** Ignore interpreter and profiler hooks inherited from the caller's environment. */
export function safeRuntimeEnvironment(input: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(input).filter(
      ([name]) =>
        !/^(?:PYTHON|DOTNET_|COMPLUS_|CORECLR_|COR_|NODE_OPTIONS$|ELECTRON_RUN_AS_NODE$)/i.test(
          name
        )
    )
  )
}
