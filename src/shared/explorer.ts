export interface ExplorerProject {
  key: string
  draftId: string
  location: string
  name: string
  containerFolderId: string
}
export interface ExplorerSource {
  id: string
  label: string
  rootPath: string
  scope: 'global' | 'project'
  projectKey: string | null
  enabled: boolean
  detached: boolean
}
export interface ExplorerAttachment {
  id: string
  sourceId: string
  projectKey: string
  destinationFolderId: string
}
export interface ExplorerConfiguration {
  schemaVersion: 1
  revision: number
  enabled: boolean
  sources: ExplorerSource[]
  projects: ExplorerProject[]
  attachments: ExplorerAttachment[]
  overrides: { sourceId: string; projectKey: string; enabled: boolean }[]
}
export type ExplorerEdit =
  | { type: 'enabled'; enabled: boolean }
  | {
      type: 'add'
      rootPath: string
      label?: string
      scope: 'global' | 'project'
      expectedProjectKey?: string
    }
  | { type: 'sourceEnabled'; sourceId: string; enabled: boolean }
  | { type: 'rename'; sourceId: string; label: string }
  | { type: 'detach'; sourceId: string }
  | { type: 'projectEnabled'; sourceId: string; enabled: boolean; expectedProjectKey: string }

export interface ExplorerImportProgress {
  projectKey: string
  total: number
  imported: number
  skipped: number
  phase: 'preparing' | 'folders' | 'importing' | 'placing' | 'checking' | 'ready' | 'waiting' | 'stopped'
}
export interface ExplorerSnapshot {
  sequence: number
  configuration: ExplorerConfiguration
  currentProject: ExplorerProject | null
  status:
    | 'Disabled'
    | 'Empty'
    | 'Starting'
    | 'WaitingForRuntime'
    | 'Indexing'
    | 'SourceUnavailable'
    | 'WaitingForAdapter'
    | 'WaitingForProject'
    | 'Watching'
    | 'Syncing'
    | 'Conflict'
    | 'Error'
  nativeMode?: 'laboratory' | 'product'
  nativeReason?: string | null
  reason: string | null
  indexedFiles: number
  pending: number
  importProgress?: ExplorerImportProgress | null
  roots: {
    rootPath: string
    available: boolean
    complete: boolean
    files: number
    waitingFiles: number
    warnings: string[]
  }[]
  lastCheckedAt: string | null
}
