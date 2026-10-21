import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC } from '../shared/channels'
import type { ExplorerEdit, ExplorerSnapshot } from '../shared/explorer'
import type {
  AppSettings,
  ExportResult,
  ImportPreview,
  ImportResult,
  IpcResult,
  PresetLibrary,
  PresetTransferRequest,
  PresetTransferResult,
  PresetImportReview,
  ProgressEvent,
  ProjectsResponse,
  UpdateProjectRequest,
  UpdateProjectResult,
  UpdateStatus
} from '../shared/types'

/**
 * The typed bridge exposed to the renderer as `window.capshare`.
 * One wrapper per IPC channel — `ipcRenderer` itself is never exposed.
 * Invoke-style calls resolve with IpcResult envelopes; event subscriptions
 * return unsubscribe functions.
 */
const api = {
  explorerGet: (): Promise<IpcResult<ExplorerSnapshot>> => ipcRenderer.invoke(IPC.explorerGet),
  explorerEdit: (
    expectedRevision: number,
    edit: ExplorerEdit
  ): Promise<IpcResult<ExplorerSnapshot>> =>
    ipcRenderer.invoke(IPC.explorerEdit, { expectedRevision, edit }),
  explorerRescan: (sourceId?: string): Promise<IpcResult<void>> =>
    ipcRenderer.invoke(IPC.explorerRescan, sourceId),
  onExplorerSnapshot: (callback: (snapshot: ExplorerSnapshot) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: ExplorerSnapshot): void =>
      callback(snapshot)
    ipcRenderer.on(IPC.explorerSnapshot, handler)
    return () => ipcRenderer.removeListener(IPC.explorerSnapshot, handler)
  },
  /** Announce the renderer is ready; resolves with a pending .capshare path if the app was opened via a file. */
  rendererReady: (): Promise<string | null> => ipcRenderer.invoke(IPC.rendererReady),

  /** Subscribe to OS open-file requests. Returns an unsubscribe function. */
  onOpenFile: (callback: (filePath: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, filePath: string): void =>
      callback(filePath)
    ipcRenderer.on(IPC.openFile, handler)
    return () => ipcRenderer.removeListener(IPC.openFile, handler)
  },

  /** Subscribe to long-task progress events. Returns an unsubscribe function. */
  onProgress: (callback: (event: ProgressEvent) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: ProgressEvent): void =>
      callback(progress)
    ipcRenderer.on(IPC.progress, handler)
    return () => ipcRenderer.removeListener(IPC.progress, handler)
  },

  listProjects: (): Promise<IpcResult<ProjectsResponse>> => ipcRenderer.invoke(IPC.listProjects),

  deleteProject: (request: { folderPath: string; draftId: string }): Promise<IpcResult<void>> =>
    ipcRenderer.invoke(IPC.deleteProject, request),

  /** Resolves a JPEG data URL for preview, or null if canceled. Nothing is written to the draft. */
  pickProjectCover: (): Promise<IpcResult<string | null>> =>
    ipcRenderer.invoke(IPC.pickProjectCover),

  updateProject: (request: UpdateProjectRequest): Promise<IpcResult<UpdateProjectResult>> =>
    ipcRenderer.invoke(IPC.updateProject, request),

  pickExportDestination: (defaultName: string): Promise<IpcResult<string | null>> =>
    ipcRenderer.invoke(IPC.pickExportDestination, defaultName),

  runExport: (request: {
    taskId: string
    folderPath: string
    destinationPath: string
    includeCaches: boolean
  }): Promise<IpcResult<ExportResult>> => ipcRenderer.invoke(IPC.runExport, request),

  pickImportFile: (): Promise<IpcResult<string | null>> => ipcRenderer.invoke(IPC.pickImportFile),

  inspectImport: (filePath: string): Promise<IpcResult<ImportPreview>> =>
    ipcRenderer.invoke(IPC.inspectImport, filePath),

  runImport: (request: {
    taskId: string
    filePath: string
    resolution?: 'copy' | 'replace'
  }): Promise<IpcResult<ImportResult>> => ipcRenderer.invoke(IPC.runImport, request),

  cancelTask: (taskId: string): Promise<IpcResult<boolean>> =>
    ipcRenderer.invoke(IPC.cancelTask, taskId),

  listPresets: (root?: string): Promise<IpcResult<PresetLibrary>> =>
    ipcRenderer.invoke(IPC.listPresets, root),
  pickPresetPackage: (): Promise<IpcResult<string | null>> =>
    ipcRenderer.invoke(IPC.pickPresetPackage),
  pickPresetDestination: (): Promise<IpcResult<string | null>> =>
    ipcRenderer.invoke(IPC.pickPresetDestination),
  pickPresetSource: (): Promise<IpcResult<string | null>> =>
    ipcRenderer.invoke(IPC.pickPresetSource),
  inspectPresetPackage: (path: string): Promise<IpcResult<PresetLibrary>> =>
    ipcRenderer.invoke(IPC.inspectPresetPackage, path),
  exportPresets: (request: PresetTransferRequest): Promise<IpcResult<PresetTransferResult>> =>
    ipcRenderer.invoke(IPC.exportPresets, request),
  importPresets: (request: PresetTransferRequest): Promise<IpcResult<PresetTransferResult>> =>
    ipcRenderer.invoke(IPC.importPresets, request),
  reviewPresets: (request: PresetTransferRequest): Promise<IpcResult<PresetImportReview>> =>
    ipcRenderer.invoke(IPC.reviewPresets, request),

  getSettings: (): Promise<IpcResult<AppSettings>> => ipcRenderer.invoke(IPC.getSettings),

  setSettings: (update: Partial<AppSettings>): Promise<IpcResult<AppSettings>> =>
    ipcRenderer.invoke(IPC.setSettings, update),

  revealPath: (path: string): Promise<IpcResult<void>> => ipcRenderer.invoke(IPC.revealPath, path),

  launchCapCut: (): Promise<IpcResult<boolean>> => ipcRenderer.invoke(IPC.launchCapCut),

  isCapCutRunning: (): Promise<IpcResult<boolean>> => ipcRenderer.invoke(IPC.isCapCutRunning),

  pickFolder: (title: string): Promise<IpcResult<string | null>> =>
    ipcRenderer.invoke(IPC.pickFolder, title),

  /** Resolves the filesystem path of a dropped File (File.path was removed in modern Electron). */
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),

  /** The running app's version (e.g. "1.0.0"). */
  getAppVersion: (): Promise<string> => ipcRenderer.invoke(IPC.getAppVersion),

  /** Only the distribution flag is exposed, never the launcher's filesystem paths. */
  isPortable: (): Promise<boolean> => ipcRenderer.invoke(IPC.isPortable),

  /** Trigger a manual update check; resolves with the resulting status. */
  checkForUpdates: (): Promise<UpdateStatus> => ipcRenderer.invoke(IPC.updateCheck),

  /** Snapshot the current update status (for initial render). */
  getUpdateStatus: (): Promise<UpdateStatus> => ipcRenderer.invoke(IPC.updateGetStatus),

  /** Quit and install a downloaded update, relaunching afterwards. */
  installUpdate: (): Promise<void> => ipcRenderer.invoke(IPC.updateInstall),

  /** Subscribe to update status changes. Returns an unsubscribe function. */
  onUpdateStatus: (callback: (status: UpdateStatus) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: UpdateStatus): void =>
      callback(status)
    ipcRenderer.on(IPC.updateStatus, handler)
    return () => ipcRenderer.removeListener(IPC.updateStatus, handler)
  },

  /**
   * Whether the window sits on a native translucent material (macOS vibrancy /
   * Windows 11 acrylic). When true the renderer leaves the backdrop to the OS;
   * when false it paints its own gradient wallpaper fallback.
   */
  env: {
    platform: process.platform as NodeJS.Platform,
    // Windows 11 22H2 (build 22621) is the floor for reliable acrylic/mica.
    nativeMaterial:
      process.platform === 'darwin' ||
      (process.platform === 'win32' &&
        Number(process.getSystemVersion().split('.')[2] ?? 0) >= 22621)
  }
}

export type CapShareApi = typeof api

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('capshare', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (defined in index.d.ts)
  window.capshare = api
}
