import { beforeEach, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { IPC } from '../src/shared/channels'

const { handlers } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>()
}))
vi.mock('electron', () => ({
  app: {},
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
      handlers.set(channel, handler)
  }
}))
vi.mock('../src/main/settings', () => ({ getSettings: () => ({ language: 'en' }) }))
import { registerExplorerIpc } from '../src/main/sync/ipc'
import type { ExplorerSupervisor } from '../src/main/sync/supervisor'
import type { BrowserWindow } from 'electron'

const sender = {}
const supervisor = {
  snapshot: vi.fn(async () => ({ sequence: 1 })),
  change: vi.fn(async () => ({ sequence: 2 })),
  rescan: vi.fn(async () => {}),
  subscribe: vi.fn()
}
beforeEach(() => {
  vi.clearAllMocks()
  handlers.clear()
  registerExplorerIpc(
    () => ({ webContents: sender }) as BrowserWindow,
    supervisor as unknown as ExplorerSupervisor
  )
})
it('accepts only requests from the current main window', async () => {
  expect(await handlers.get(IPC.explorerGet)!({ sender: {} })).toMatchObject({ ok: false })
  expect(supervisor.snapshot).not.toHaveBeenCalled()
  expect(await handlers.get(IPC.explorerGet)!({ sender })).toMatchObject({ ok: true })
})
it('rejects extra fields and project changes without an expected project key', async () => {
  for (const edit of [
    { type: 'enabled', enabled: true, editorPid: 123 },
    { type: 'projectEnabled', enabled: true, sourceId: randomUUID() },
    { type: 'add', scope: 'global', rootPath: 'C:/media', projectKey: 'forged' }
  ])
    expect(
      await handlers.get(IPC.explorerEdit)!({ sender }, { expectedRevision: 0, edit })
    ).toMatchObject({ ok: false })
  expect(supervisor.change).not.toHaveBeenCalled()
})
it('passes a bounded typed edit and explicit manual check to the supervisor', async () => {
  const edit = {
    type: 'projectEnabled',
    enabled: false,
    sourceId: randomUUID(),
    expectedProjectKey: 'project-v1-' + 'a'.repeat(64)
  }
  expect(
    await handlers.get(IPC.explorerEdit)!({ sender }, { expectedRevision: 2, edit })
  ).toMatchObject({ ok: true })
  expect(supervisor.change).toHaveBeenCalledWith(2, edit)
  expect(await handlers.get(IPC.explorerRescan)!({ sender }, edit.sourceId)).toMatchObject({
    ok: true
  })
  expect(supervisor.rescan).toHaveBeenCalledWith(edit.sourceId)
})
