import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import { Switch } from '@heroui/react'
import { motion, useReducedMotion } from 'motion/react'
import { AlertCircle, FolderOpen, FolderPlus, FolderSync, Plus, RefreshCw } from 'lucide-react'
import { ExplorerButton as Button } from './ExplorerButton'
import { AnimatedHeight } from '@/components/AnimatedHeight'
import { t, useLanguage } from '@/lib/i18n'
import { unwrap, errorMessage } from '@/lib/ipc'
import type { ExplorerEdit, ExplorerSnapshot, ExplorerSource } from '@shared/explorer'
import { ImportProgress } from './ImportProgress'
import { ProjectFolders } from './ProjectFolders'
import { ConnectionActions } from './ConnectionActions'

const samePath = (a: string, b: string): boolean =>
  a.replaceAll('\\', '/').toLowerCase() === b.replaceAll('\\', '/').toLowerCase()

function SourceCard({
  source,
  snapshot,
  busy,
  edit,
  rescan
}: {
  source: ExplorerSource
  snapshot: ExplorerSnapshot
  busy: boolean
  edit: (edit: ExplorerEdit) => Promise<boolean>
  rescan: (id: string) => Promise<void>
}): JSX.Element {
  const reducedMotion = useReducedMotion()
  const paused = !source.enabled
  const root = snapshot.roots.find((root) => samePath(root.rootPath, source.rootPath))
  const runtimeMissing = snapshot.status === 'WaitingForRuntime' || snapshot.status === 'Error'
  const toggle = (enabled: boolean): void => {
    void edit({ type: 'sourceEnabled', sourceId: source.id, enabled })
  }
  return (
    <motion.article
      className="glass-subtle min-w-0 rounded-2xl p-4"
      data-source-id={source.id}
      initial={{ y: reducedMotion ? 0 : 4 }}
      animate={{ y: 0 }}
      transition={{ duration: reducedMotion ? 0 : 0.2 }}
    >
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <FolderOpen size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="ui-type-item truncate" title={source.label}>
              {source.label}
            </h3>
            <span className="rounded-full bg-foreground/5 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              {t(source.scope === 'global' ? 'All projects' : 'This project')}
            </span>
          </div>
          <p
            className="mt-1 truncate ui-type-caption text-muted-foreground select-text"
            title={source.rootPath}
          >
            {source.rootPath}
          </p>
          <p className="mt-2 ui-type-caption text-muted-foreground">
            {paused
              ? t('Paused')
              : root
                ? !root.available
                  ? t('Source unavailable')
                  : root.waitingFiles > 0
                    ? t('Waiting for files to finish writing')
                    : t('{0} files found', [root.files])
                : t('Waiting for folder check')}
          </p>
        </div>
        <Switch
          className="explorer-switch"
          aria-label={t('Enable {0}', [source.label])}
          isSelected={!paused}
          isDisabled={busy}
          onChange={toggle}
        >
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
        </Switch>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5 pl-[52px]">
        <Button
          onPress={() => {
            void window.capshare.revealPath(source.rootPath)
          }}
          aria-label={t('Show folder')}
        >
          <FolderOpen size={14} />
          {t('Show folder')}
        </Button>
        <Button
          isDisabled={busy || paused || runtimeMissing || !snapshot.configuration.enabled}
          onPress={() => {
            void rescan(source.id)
          }}
          aria-label={t(
            'Check folder changes now and add missing files without duplicating imported materials'
          )}
        >
          <RefreshCw size={14} />
          {t('Check now')}
        </Button>
        <ConnectionActions source={source} busy={busy} edit={edit} />
      </div>
      {root?.warnings.length && !paused ? (
        <p className="mt-2 truncate pl-[52px] text-xs text-warning" title={root.warnings[0]}>
          {root.warnings[0]}
        </p>
      ) : null}
    </motion.article>
  )
}

export function ExplorerView(): JSX.Element {
  const language = useLanguage()
  const [snapshot, setSnapshot] = useState<ExplorerSnapshot | null>(null)
  const latestSnapshot = useRef<ExplorerSnapshot | null>(null)
  const choosingFolder = useRef(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState<'global' | 'project'>('global')
  const [projectsVisited, setProjectsVisited] = useState(false)
  const changeTab = useCallback((scope: 'global' | 'project'): void => {
    if (scope === 'project') setProjectsVisited(true)
    setTab(scope)
  }, [])
  const [selectedProjectKey, setSelectedProjectKey] = useState<string | null>(null)
  const apply = useCallback((value: ExplorerSnapshot): void => {
    if (!latestSnapshot.current || value.sequence >= latestSnapshot.current.sequence) {
      latestSnapshot.current = value
      setSnapshot(value)
    }
  }, [])
  useEffect(() => {
    let disposed = false
    const unsubscribe = window.capshare.onExplorerSnapshot((value) => {
      if (!disposed) apply(value)
    })
    void window.capshare
      .explorerGet()
      .then((result) => {
        if (!disposed) apply(unwrap(result))
      })
      .catch((error) => {
        if (!disposed) setFailure(errorMessage(error))
      })
    return () => {
      disposed = true
      unsubscribe()
    }
  }, [apply])
  const refresh = async (): Promise<void> => {
    try {
      apply(unwrap(await window.capshare.explorerGet()))
    } catch (error) {
      setFailure(errorMessage(error))
    }
  }
  const edit = async (change: ExplorerEdit): Promise<boolean> => {
    const current = latestSnapshot.current
    if (!current) return false
    setBusy(true)
    setFailure(null)
    try {
      apply(unwrap(await window.capshare.explorerEdit(current.configuration.revision, change)))
      return true
    } catch (error) {
      setFailure(errorMessage(error))
      await refresh()
      return false
    } finally {
      setBusy(false)
    }
  }
  const rescan = async (id: string): Promise<void> => {
    setBusy(true)
    setFailure(null)
    try {
      unwrap(await window.capshare.explorerRescan(id))
    } catch (error) {
      setFailure(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }
  const selectProject = useCallback((key: string): void => {
    setSelectedProjectKey(key)
  }, [])
  const chooseFolder = async (projectKey?: string): Promise<void> => {
    if (busy || choosingFolder.current) return
    choosingFolder.current = true
    setBusy(true)
    setFailure(null)
    try {
      const path = unwrap(await window.capshare.pickFolder(t('Choose a source folder')))
      if (path)
        await edit({
          type: 'add',
          rootPath: path,
          scope: projectKey ? 'project' : 'global',
          expectedProjectKey: projectKey
        })
    } catch (error) {
      setFailure(errorMessage(error))
    } finally {
      choosingFolder.current = false
      setBusy(false)
    }
  }
  if (!snapshot)
    return (
      <div className="h-full overflow-y-auto px-4 pt-24 pb-6">
        <div className="glass rounded-2xl p-6 text-sm text-muted-foreground">
          {failure ? t(failure) : t('Loading folder settings…')}
          {failure && (
            <Button
              className="mt-3"
              onPress={() => {
                void refresh()
              }}
            >
              {t('Try again')}
            </Button>
          )}
        </div>
      </div>
    )
  const enabled = snapshot.configuration.enabled
  const sources = snapshot.configuration.sources.filter(
    (source) => !source.detached && source.scope === 'global'
  )
  return (
    <section
      className="h-full overflow-y-auto px-4 pt-24 pb-8"
      aria-label={t('Folder synchronization')}
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-4">
        <div className="glass flex items-center gap-4 rounded-2xl p-5">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <FolderSync size={24} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="ui-type-section">{t('Automatic synchronization')}</h2>
            <p className="mt-1 ui-type-body text-muted-foreground">
              {t(
                enabled
                  ? ['Error', 'Conflict', 'WaitingForRuntime', 'SourceUnavailable'].includes(
                      snapshot.status
                    )
                    ? 'Synchronization needs attention'
                    : snapshot.status === 'WaitingForProject'
                      ? 'Waiting for CapCut project'
                      : 'Watching for changes'
                  : 'Choose folders once and reuse them in your CapCut projects.'
              )}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="ui-type-caption text-muted-foreground">{t('Enable')}</span>
            <Switch
              className="explorer-switch"
              aria-label={t('Enable automatic synchronization')}
              isSelected={enabled}
              isDisabled={busy}
              onChange={(value) => {
                void edit({ type: 'enabled', enabled: value })
              }}
            >
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
            </Switch>
          </div>
        </div>
        {failure && (
          <div role="alert" className="glass-subtle flex items-start gap-3 rounded-2xl p-4 text-sm">
            <AlertCircle className="mt-0.5 shrink-0 text-warning" size={18} />
            <p className="min-w-0 break-words">{t(failure)}</p>
          </div>
        )}
        <>
          {!enabled && (
            <p className="glass-subtle rounded-2xl px-4 py-3 ui-type-body text-muted-foreground">
              {t('Synchronization is off. You can still prepare folder settings for any project.')}
            </p>
          )}
          {enabled && tab === 'global' && snapshot.nativeMode !== 'product' && (
            <div className="glass-subtle rounded-2xl px-4 py-3 ui-type-body text-muted-foreground">
              <span className="mr-2 rounded-full bg-warning/10 px-2 py-0.5 font-medium text-warning">
                {t(snapshot.nativeMode === 'laboratory' ? 'Laboratory mode' : 'In development')}
              </span>
              {snapshot.nativeMode === 'laboratory'
                ? t(
                    'Preview: automatic import and verified PNG path updates are available in CapSync-Lab-20261013-001. Other projects are not modified.'
                  )
                : snapshot.status === 'WaitingForRuntime'
                  ? t('The synchronization runtime is not included in this build yet.')
                  : t(
                      'Folder settings and change tracking are available. Automatic importing into CapCut is still being connected.'
                    )}
            </div>
          )}
          {['Error', 'Conflict', 'WaitingForRuntime', 'SourceUnavailable'].includes(
            snapshot.status
          ) && (
            <div
              role="status"
              className="glass-subtle flex items-start gap-2 rounded-2xl p-4 text-xs text-warning"
            >
              <AlertCircle size={16} className="shrink-0" />
              {t(
                snapshot.reason ||
                  (snapshot.status === 'WaitingForRuntime'
                    ? 'Runtime not available'
                    : snapshot.status === 'SourceUnavailable'
                      ? 'Check source folders'
                      : 'Synchronization needs attention')
              )}
            </div>
          )}
          {enabled && <ImportProgress snapshot={snapshot} />}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div
              className="glass-subtle explorer-scope"
              role="tablist"
              aria-label={t('Source scope')}
              data-scope={tab}
            >
              <span className="explorer-scope__selection" aria-hidden="true" />
              {(['global', 'project'] as const).map((scope) => (
                <button
                  key={scope}
                  type="button"
                  role="tab"
                  id={'explorer-tab-' + scope}
                  aria-controls={'explorer-' + scope + '-panel'}
                  aria-selected={tab === scope}
                  tabIndex={tab === scope ? 0 : -1}
                  onKeyDown={(event) => {
                    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
                    event.preventDefault()
                    const next =
                      event.key === 'Home'
                        ? 'global'
                        : event.key === 'End'
                          ? 'project'
                          : tab === 'global'
                            ? 'project'
                            : 'global'
                    changeTab(next)
                    document.getElementById('explorer-tab-' + next)?.focus()
                  }}
                  onClick={() => {
                    changeTab(scope)
                  }}
                  className="explorer-scope__tab"
                >
                  <span className="relative">
                    {t(scope === 'global' ? 'Common folders' : 'By project')}
                  </span>
                </button>
              ))}
            </div>
            {tab === 'global' && (
              <Button
                isDisabled={busy}
                onPress={() => {
                  void chooseFolder()
                }}
              >
                <Plus size={16} />
                {t('Add folder')}
              </Button>
            )}
          </div>
          <AnimatedHeight>
            <div
              id="explorer-global-panel"
              role="tabpanel"
              aria-labelledby="explorer-tab-global"
              hidden={tab !== 'global'}
              className={tab === 'global' ? 'flex min-w-0 flex-col gap-4' : 'hidden'}
            >
              {
                <p className="px-1 ui-type-body text-muted-foreground">
                  {t(
                    'Enabled common folders synchronize with every project. Add client-specific folders in By project.'
                  )}
                </p>
              }
              {sources.length ? (
                <div className="grid min-w-0 gap-3">
                  {sources.map((source) => (
                    <SourceCard
                      key={source.id}
                      source={source}
                      snapshot={snapshot}
                      busy={busy}
                      edit={edit}
                      rescan={rescan}
                    />
                  ))}
                </div>
              ) : (
                <div className="glass-subtle flex flex-col items-center rounded-2xl px-6 py-10 text-center">
                  <FolderPlus size={30} className="mb-3 text-primary/70" />
                  <h3 className="ui-type-state">{t('Add your first folder')}</h3>
                  <p className="mt-2 max-w-md ui-type-body text-muted-foreground">
                    {t(
                      'Your folder structure is kept. Files are added to the media library, never to the timeline.'
                    )}
                  </p>
                  <Button
                    className="mt-5"
                    isDisabled={busy}
                    onPress={() => {
                      void chooseFolder()
                    }}
                  >
                    <Plus size={15} />
                    {t('Add folder')}
                  </Button>
                </div>
              )}
            </div>
            {projectsVisited && (
              <div
                id="explorer-project-panel"
                role="tabpanel"
                aria-labelledby="explorer-tab-project"
                hidden={tab !== 'project'}
                className={tab === 'project' ? 'min-w-0' : 'hidden'}
              >
                <ProjectFolders
                  snapshot={snapshot}
                  selectedKey={selectedProjectKey}
                  onSelect={selectProject}
                  busy={busy}
                  edit={edit}
                  onAdd={(key) => void chooseFolder(key)}
                  onCommon={() => changeTab('global')}
                />
              </div>
            )}
          </AnimatedHeight>
          <footer className="flex flex-wrap justify-between gap-x-4 gap-y-2 px-1 ui-type-body text-muted-foreground">
            {snapshot.lastCheckedAt && (
              <p className="px-1 ui-type-caption text-muted-foreground">
                {t('Last folder check: {0}', [
                  new Date(snapshot.lastCheckedAt).toLocaleTimeString(
                    language === 'ru' ? 'ru-RU' : 'en-US',
                    { hour: '2-digit', minute: '2-digit' }
                  )
                ])}
              </p>
            )}
            {enabled && window.capshare.env.platform === 'win32' && (
              <p>
                {t('When you close the window, WakuShare continues working in the system tray.')}
              </p>
            )}
          </footer>
        </>
      </div>
    </section>
  )
}
