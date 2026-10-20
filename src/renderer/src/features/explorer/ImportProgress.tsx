import type { JSX } from 'react'
import { Check, AlertCircle } from 'lucide-react'
import type { ExplorerSnapshot } from '@shared/explorer'
import { t } from '@/lib/i18n'
import { importPresentation } from './progress'

const titles = {
  preparing: 'Preparing files for CapCut…',
  folders: 'Creating folder structure…',
  importing: 'Importing files…',
  placing: 'Organizing imported files…',
  checking: 'Files imported — checking saved changes…',
  ready: 'Import complete — you can work',
  waiting: 'Waiting for CapCut…',
  stopped: 'Import paused'
}
export function ImportProgress({ snapshot }: { snapshot: ExplorerSnapshot }): JSX.Element | null {
  const p = importPresentation(snapshot)
  if (!p) return null
  const warning = p.phase === 'stopped' || p.phase === 'waiting'
  const count = t('Imported {0} of {1} files', [p.imported, p.total])
  return (
    <section
      className="glass-subtle rounded-2xl p-4"
      aria-label={t('Import progress')}
      data-testid="explorer-import-progress"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs text-muted-foreground">
            {t('Project: {0}', [snapshot.currentProject?.name])}
          </p>
          <p
            className={`mt-1 flex items-center gap-2 text-sm font-semibold ${warning ? 'text-warning' : ''}`}
            aria-live="polite"
          >
            {p.phase === 'ready' && <Check size={16} className="shrink-0 text-emerald-500" />}
            {p.phase === 'stopped' && <AlertCircle size={16} className="shrink-0" />}
            {t(titles[p.phase])}
          </p>
        </div>
        {p.determinate && (
          <span className="shrink-0 text-sm font-semibold tabular-nums">{p.percent}%</span>
        )}
      </div>
      <div
        role="progressbar"
        aria-label={t('Import progress')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={p.determinate ? p.percent : undefined}
        aria-valuetext={`${t(titles[p.phase])}. ${count}`}
        className="mt-3 h-2.5 overflow-hidden rounded-full bg-foreground/10"
      >
        <div
          className={`h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none ${p.phase === 'ready' ? 'bg-emerald-500' : warning ? 'bg-amber-500' : 'bg-violet-500'} ${!p.determinate ? 'animate-pulse motion-reduce:animate-none' : ''}`}
          style={{ width: p.determinate ? `${p.percent}%` : '35%' }}
        />
      </div>
      <div className="mt-2 flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground tabular-nums">
        <span>{count}</span>
        {p.skipped > 0 && <span>{t('{0} unsupported files skipped', [p.skipped])}</span>}
      </div>
      {p.phase === 'stopped' && (
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          {t(
            'Import has stopped before completion. Imported files are kept. WakuShare could not confirm the last operation.'
          )}
        </p>
      )}
      {p.phase === 'waiting' && (
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          {t('Waiting for the project or source folders to become available. Progress is kept.')}
        </p>
      )}
    </section>
  )
}
