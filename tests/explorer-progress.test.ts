import { describe, expect, it } from 'vitest'
import type { ExplorerSnapshot } from '../src/shared/explorer'
import { importPresentation } from '../src/renderer/src/features/explorer/progress'
import { workerStateSchema } from '../src/main/sync/protocol'
const snapshot = (
  phase: NonNullable<ExplorerSnapshot['importProgress']>['phase'],
  imported = 1024
): ExplorerSnapshot => ({
  sequence: 1,
  configuration: {
    schemaVersion: 1,
    revision: 1,
    enabled: true,
    sources: [],
    projects: [],
    attachments: [],
    overrides: []
  },
  currentProject: {
    key: 'current',
    draftId: 'draft',
    location: 'C:/project',
    name: 'New project',
    containerFolderId: 'container'
  },
  status: 'Syncing',
  reason: null,
  indexedFiles: 2830,
  pending: 2830 - imported,
  roots: [],
  lastCheckedAt: null,
  importProgress: { projectKey: 'current', total: 2830, imported, skipped: 0, phase }
})
describe('durable import progress', () => {
  it('keeps preparation, import, folder placement and saved verification distinct', () => {
    for (const phase of ['preparing', 'importing', 'placing', 'checking'] as const) {
      expect(importPresentation(snapshot(phase, 0))).toMatchObject({
        phase,
        imported: 0,
        percent: 0
      })
    }
  })
  it('does not treat a complete disk index as an imported project', () => {
    expect(importPresentation(snapshot('folders', 0))).toMatchObject({
      percent: 0,
      imported: 0,
      total: 2830,
      phase: 'folders'
    })
  })
  it('reports only acknowledged files and holds 100 percent until verification finishes', () => {
    expect(importPresentation(snapshot('importing'))?.percent).toBe(36)
    expect(importPresentation({ ...snapshot('checking', 2830), pending: 1 })?.percent).toBe(99)
    expect(importPresentation({ ...snapshot('ready', 2830), status: 'Watching' })?.percent).toBe(
      100
    )
  })
  it('keeps acknowledged completion green during a routine catalog check', () => {
    expect(importPresentation(snapshot('checking', 2830))).toMatchObject({
      phase: 'ready',
      percent: 100
    })
    expect(importPresentation(snapshot('preparing', 2830))?.phase).toBe('preparing')
    expect(importPresentation({ ...snapshot('checking', 2830), status: 'Conflict' })?.phase).toBe(
      'stopped'
    )
  })
  it('preserves the last verified count when stopped or disconnected', () => {
    expect(importPresentation({ ...snapshot('importing'), status: 'Conflict' })).toMatchObject({
      phase: 'stopped',
      percent: 36,
      imported: 1024
    })
    expect(
      importPresentation({ ...snapshot('importing'), status: 'SourceUnavailable' })
    ).toMatchObject({ phase: 'waiting', imported: 1024 })
  })
  it('never leaks the previous project progress into a new project', () => {
    const s = snapshot('ready', 2830)
    s.currentProject = { ...s.currentProject!, key: 'other' }
    expect(importPresentation(s)).toBeNull()
  })
  it('keeps skipped formats separate from imported cards', () => {
    const s = snapshot('ready', 2820)
    s.importProgress!.skipped = 10
    expect(importPresentation(s)).toMatchObject({ imported: 2820, skipped: 10, percent: 100 })
  })
  it('does not show progress while the feature is disabled', () => {
    const s = snapshot('importing')
    s.configuration.enabled = false
    expect(importPresentation(s)).toBeNull()
  })
  it('rejects inconsistent worker counters', () => {
    const base = {
      phase: 'Running',
      planningOnly: false,
      editorCommands: 0,
      sources: 1,
      pending: 1,
      runtimeEpoch: 1,
      batches: 1,
      work: { FullScans: 0, PartialScans: 0, MetadataEntries: 0, HashedFiles: 0, HashedBytes: 0 },
      readiness: {
        WaitingFiles: 0,
        ScheduledFiles: 0,
        ExhaustedFiles: 0,
        TotalAttempts: 0,
        DeferredFiles: 0
      },
      watches: [],
      editorBlocked: false,
      blockedProjects: [],
      importProgress: {
        projectKey: 'project-v1-' + 'a'.repeat(64),
        phase: 'importing',
        total: 1,
        imported: 2,
        skipped: 0
      }
    }
    expect(workerStateSchema.safeParse(base).success).toBe(false)
    expect(
      workerStateSchema.safeParse({
        ...base,
        importProgress: { ...base.importProgress, imported: 0 }
      }).success
    ).toBe(true)
  })
})
