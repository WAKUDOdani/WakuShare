import type { ExplorerSnapshot } from '@shared/explorer'

/** Project-owned durable counts only; indexing is never reported as completed import. */
export function importPresentation(snapshot: ExplorerSnapshot): {
  phase:
    | 'preparing'
    | 'folders'
    | 'importing'
    | 'placing'
    | 'checking'
    | 'ready'
    | 'waiting'
    | 'stopped'
  total: number
  imported: number
  skipped: number
  percent: number
  determinate: boolean
} | null {
  const p = snapshot.importProgress
  if (
    !snapshot.configuration.enabled ||
    !snapshot.currentProject ||
    !p ||
    p.projectKey !== snapshot.currentProject.key
  )
    return null
  let phase =
    snapshot.status === 'Conflict' || snapshot.status === 'Error'
      ? 'stopped'
      : snapshot.status === 'SourceUnavailable' || snapshot.status === 'WaitingForProject'
        ? 'waiting'
        : p.phase
  const total = Math.max(0, p.total),
    imported = Math.min(total, Math.max(0, p.imported)),
    skipped = Math.min(total - imported, Math.max(0, p.skipped))
  const done = imported + skipped
  // These counts already carry the native saved-comparison acknowledgement.
  // A routine catalog read must not reset a completed card to blue/99%.
  if (phase === 'checking' && total > 0 && done === total && snapshot.pending <= skipped)
    phase = 'ready'
  return {
    phase,
    total,
    imported,
    skipped,
    percent: phase === 'ready' ? 100 : total ? Math.min(99, Math.floor((done * 100) / total)) : 0,
    determinate: total > 0 || phase === 'ready' || phase === 'stopped'
  }
}
