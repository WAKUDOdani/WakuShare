import { assertMainFrame } from '../ipc-security'
import { app, ipcMain, nativeImage, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { IPC } from '../../shared/channels'
import type { IpcResult } from '../../shared/types'
import type { ExplorerEdit } from '../../shared/explorer'
import { translateText } from '../../shared/i18n'
import { getSettings } from '../settings'
import { ExplorerConfigurationError, ExplorerConfigurationStore } from './configuration'
import { ExplorerSourcePolicy } from './source-policy'
import { ExplorerSupervisor } from './supervisor'
import { createExplorerWorker, explorerProductEnabled } from './runtime'
import { detectCapCutEnvFromProcess } from '../core/capcut/locator'
import { listExplorerProjects } from './project-catalog'

export const explorerEditSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('enabled'), enabled: z.boolean() }).strict(),
  z
    .object({
      type: z.literal('add'),
      rootPath: z.string().min(1).max(8192),
      label: z.string().max(80).optional(),
      scope: z.enum(['global', 'project']),
      expectedProjectKey: z
        .string()
        .regex(/^project-v1-[a-f0-9]{64}$/)
        .optional()
    })
    .strict(),
  z.object({ type: z.literal('sourceEnabled'), sourceId: z.uuid(), enabled: z.boolean() }).strict(),
  z
    .object({
      type: z.literal('rename'),
      sourceId: z.uuid(),
      label: z.string().trim().min(1).max(80)
    })
    .strict(),
  z.object({ type: z.literal('detach'), sourceId: z.uuid() }).strict(),
  z
    .object({
      type: z.literal('projectEnabled'),
      sourceId: z.uuid(),
      enabled: z.boolean(),
      expectedProjectKey: z.string().regex(/^project-v1-[a-f0-9]{64}$/)
    })
    .strict(),
  z
    .object({
      type: z.literal('projectFolder'),
      sourceId: z.uuid(),
      projectKey: z.string().regex(/^project-v1-[a-f0-9]{64}$/),
      enabled: z.boolean()
    })
    .strict(),
  z
    .object({
      type: z.literal('copyProjectFolders'),
      projectKey: z.string().regex(/^project-v1-[a-f0-9]{64}$/),
      targetProjectKeys: z
        .array(z.string().regex(/^project-v1-[a-f0-9]{64}$/))
        .min(1)
        .max(256)
        .refine((keys) => new Set(keys).size === keys.length)
    })
    .strict()
])
const MESSAGES: Record<string, string> = {
  EXPLORER_SOURCE_OVERLAP: 'This folder overlaps an existing source. Use its existing connection.',
  EXPLORER_SOURCE_UNAVAILABLE:
    'The source folder is unavailable. Check the path and access permissions.',
  EXPLORER_LOCAL_SOURCE_REQUIRED:
    'Choose a folder on a local drive. Network folders are not supported yet.',
  EXPLORER_LINKED_SOURCE: 'Linked folders and cloud placeholders are not supported yet.',
  EXPLORER_PROTECTED_SOURCE: 'Choose a media folder outside WakuShare and CapCut service folders.',
  EXPLORER_CONFIGURATION_CHANGED: 'Folder settings changed. Refresh and try again.',
  EXPLORER_CONFIGURATION_UNREADABLE:
    'Folder settings could not be read. Existing settings were preserved.',
  EXPLORER_NO_PROJECT: 'Select an available project and try again.',
  EXPLORER_GLOBAL_ALWAYS_ON:
    'Common folders apply to every project. Manage them in Common folders.',
  EXPLORER_NO_PROJECT_FOLDERS:
    'Add an additional folder before applying this set to other projects.',
  EXPLORER_SOURCE_NOT_FOUND: 'This source is no longer available in the current configuration.',
  EXPLORER_DISABLED: 'Enable folder synchronization before requesting a check.',
  EXPLORER_RUNTIME_UNAVAILABLE: 'The synchronization runtime is not included in this build yet.'
}
export function registerExplorerIpc(
  getWindow: () => BrowserWindow | null,
  supervisor: ExplorerSupervisor
): void {
  const guard = (event: IpcMainInvokeEvent): void => {
    assertMainFrame(event, getWindow())
  }
  async function result<T>(
    event: IpcMainInvokeEvent,
    action: () => Promise<T>
  ): Promise<IpcResult<T>> {
    try {
      guard(event)
      return { ok: true, data: await action() }
    } catch (error) {
      const message = error instanceof ExplorerConfigurationError ? MESSAGES[error.code] : null
      return {
        ok: false,
        error: {
          code: 'UNKNOWN',
          message: translateText(
            message ??
              'Folder settings could not be updated. Check the selected folder and try again.',
            getSettings().language
          )
        }
      }
    }
  }
  ipcMain.handle(IPC.explorerGet, (event) => result(event, () => supervisor.snapshot()))
  ipcMain.handle(IPC.explorerProjects, (event) => result(event, () => supervisor.projects()))
  ipcMain.handle(IPC.explorerEdit, (event, raw: unknown) =>
    result(event, async () => {
      const request = z
        .object({ expectedRevision: z.number().int().nonnegative(), edit: explorerEditSchema })
        .strict()
        .parse(raw)
      return supervisor.change(request.expectedRevision, request.edit as ExplorerEdit)
    })
  )
  ipcMain.handle(IPC.explorerRescan, (event, raw: unknown) =>
    result(event, () => supervisor.rescan(z.string().uuid().optional().parse(raw)))
  )
  supervisor.subscribe((snapshot) => {
    const window = getWindow()
    if (window && !window.isDestroyed()) window.webContents.send(IPC.explorerSnapshot, snapshot)
  })
}
export function createExplorerSupervisor(): ExplorerSupervisor {
  const store = new ExplorerConfigurationStore(
    join(app.getPath('userData'), 'explorer', 'configuration.json'),
    async (path) => {
      const local = process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local')
      const excluded = [
        app.getPath('userData'),
        join(local, 'CapCut'),
        join(homedir(), 'Documents', 'CapCut', 'User Data')
      ]
      const override = getSettings().draftRootOverride
      if (override) excluded.push(override)
      return new ExplorerSourcePolicy(excluded).resolve(path)
    }
  )
  return new ExplorerSupervisor({
    store,
    listProjects: (known) =>
      listExplorerProjects(
        detectCapCutEnvFromProcess(getSettings().draftRootOverride)?.draftRoot ?? null,
        known,
        (bytes) => {
          const image = nativeImage.createFromBuffer(bytes)
          if (image.isEmpty()) return null
          const { width, height } = image.getSize()
          if (width * height > 16_000_000 || width / height > 10 || height / width > 10) return null
          return (
            'data:image/jpeg;base64,' +
            image.resize({ width: 80, quality: 'good' }).toJPEG(80).toString('base64')
          )
        }
      ),
    createWorker: createExplorerWorker,
    nativeMode: explorerProductEnabled() ? 'product' : undefined
  })
}
