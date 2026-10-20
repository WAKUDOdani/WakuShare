import { useCallback, useEffect, useState, type JSX } from 'react'
import { Button, Input, Label, Switch, TextField } from '@heroui/react'
import {
  AlertCircle,
  Check,
  FolderOpen,
  FolderPlus,
  FolderSync,
  Pencil,
  Plus,
  RefreshCw,
  Unplug,
  X
} from 'lucide-react'
import { FormSelect } from '@/components/FormSelect'
import { t, useLanguage } from '@/lib/i18n'
import { unwrap, errorMessage } from '@/lib/ipc'
import type { ExplorerEdit, ExplorerSnapshot, ExplorerSource } from '@shared/explorer'
import { ImportProgress } from './ImportProgress'

const samePath = (a: string, b: string): boolean =>
  a.replaceAll('\\', '/').toLowerCase() === b.replaceAll('\\', '/').toLowerCase()

function SourceCard({
  source,
  snapshot,
  localTab,
  busy,
  edit,
  rescan
}: {
  source: ExplorerSource
  snapshot: ExplorerSnapshot
  localTab: boolean
  busy: boolean
  edit: (edit: ExplorerEdit) => Promise<boolean>
  rescan: (id: string) => Promise<void>
}): JSX.Element {
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(source.label)
  const [disconnecting, setDisconnecting] = useState(false)
  const inherited = localTab && source.scope === 'global'
  const paused =
    !source.enabled ||
    (inherited &&
      snapshot.configuration.overrides.some(
        (value) =>
          value.sourceId === source.id &&
          value.projectKey === snapshot.currentProject?.key &&
          !value.enabled
      ))
  const root = snapshot.roots.find((root) => samePath(root.rootPath, source.rootPath))
  const runtimeMissing = snapshot.status === 'WaitingForRuntime' || snapshot.status === 'Error'
  const toggle = (enabled: boolean): void => {
    void edit(
      inherited
        ? {
            type: 'projectEnabled',
            sourceId: source.id,
            enabled,
            expectedProjectKey: snapshot.currentProject!.key
          }
        : { type: 'sourceEnabled', sourceId: source.id, enabled }
    )
  }
  return (
    <article className="glass-subtle min-w-0 rounded-2xl p-4" data-source-id={source.id}>
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <FolderOpen size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="truncate text-sm font-semibold" title={source.label}>
              {source.label}
            </h3>
            <span className="rounded-full bg-foreground/5 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              {t(source.scope === 'global' ? 'All projects' : 'This project')}
            </span>
          </div>
          <p
            className="mt-1 truncate text-xs text-muted-foreground select-text"
            title={source.rootPath}
          >
            {source.rootPath}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            {paused
              ? t(inherited ? 'Paused in this project' : 'Paused')
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
          isDisabled={busy || (inherited && !source.enabled)}
          onChange={toggle}
        >
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
        </Switch>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5 pl-[52px]">
        <Button
          size="sm"
          variant="ghost"
          onPress={() => {
            void window.capshare.revealPath(source.rootPath)
          }}
          aria-label={t('Show folder')}
        >
          <FolderOpen size={14} />
          {t('Show folder')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          isDisabled={busy || paused || runtimeMissing}
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
        {!inherited && (
          <>
            <Button
              isIconOnly
              size="sm"
              variant="ghost"
              isDisabled={busy}
              onPress={() => {
                setName(source.label)
                setRenaming(!renaming)
                setDisconnecting(false)
              }}
              aria-label={t('Rename connection')}
            >
              <Pencil size={14} />
            </Button>
            <Button
              isIconOnly
              size="sm"
              variant="ghost"
              isDisabled={busy}
              onPress={() => {
                setDisconnecting(!disconnecting)
                setRenaming(false)
              }}
              aria-label={t('Disconnect folder')}
            >
              <Unplug size={14} />
            </Button>
          </>
        )}
      </div>
      {inherited && !source.enabled && (
        <p className="mt-2 pl-[52px] text-xs text-muted-foreground">
          {t('This source is paused for all projects.')}
        </p>
      )}
      {root?.warnings.length && !paused ? (
        <p className="mt-2 truncate pl-[52px] text-xs text-warning" title={root.warnings[0]}>
          {root.warnings[0]}
        </p>
      ) : null}
      {renaming && (
        <form
          className="mt-3 flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void edit({ type: 'rename', sourceId: source.id, label: name }).then((saved) => {
              if (saved) setRenaming(false)
            })
          }}
        >
          <TextField className="min-w-0 flex-1" value={name} onChange={setName} isDisabled={busy}>
            <Label>{t('Connection name')}</Label>
            <Input maxLength={80} />
          </TextField>
          <Button type="submit" size="sm" isDisabled={busy || !name.trim()} aria-label={t('Save')}>
            <Check size={16} />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onPress={() => setRenaming(false)}
            aria-label={t('Cancel')}
          >
            <X size={16} />
          </Button>
        </form>
      )}
      {disconnecting && (
        <div className="mt-3 rounded-xl bg-foreground/5 p-3">
          <p className="text-xs text-muted-foreground">
            {t('Disconnect this folder? Existing CapCut materials and clips will remain.')}
          </p>
          <div className="mt-2 flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              isDisabled={busy}
              onPress={() => {
                void edit({ type: 'detach', sourceId: source.id })
              }}
            >
              {t('Disconnect')}
            </Button>
            <Button size="sm" variant="ghost" onPress={() => setDisconnecting(false)}>
              {t('Cancel')}
            </Button>
          </div>
        </div>
      )}
    </article>
  )
}

export function ExplorerView(): JSX.Element {
  const language = useLanguage()
  const [snapshot, setSnapshot] = useState<ExplorerSnapshot | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState<'global' | 'project'>('global')
  const [draft, setDraft] = useState<{
    path: string
    label: string
    scope: 'global' | 'project'
    projectKey?: string
  } | null>(null)
  const apply = useCallback((value: ExplorerSnapshot): void => {
    setSnapshot((previous) => (!previous || value.sequence >= previous.sequence ? value : previous))
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
    if (!snapshot) return false
    setBusy(true)
    setFailure(null)
    try {
      apply(unwrap(await window.capshare.explorerEdit(snapshot.configuration.revision, change)))
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
  const chooseFolder = async (): Promise<void> => {
    try {
      const path = unwrap(await window.capshare.pickFolder(t('Choose a source folder')))
      if (path)
        setDraft({
          path,
          label:
            path
              .replace(/[\\/]+$/, '')
              .split(/[\\/]/)
              .at(-1)
              ?.slice(0, 80) || 'Folder',
          scope: tab,
          projectKey: snapshot?.currentProject?.key
        })
    } catch (error) {
      setFailure(errorMessage(error))
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
              variant="secondary"
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
    (source) =>
      !source.detached &&
      (tab === 'global'
        ? source.scope === 'global'
        : source.scope === 'global' || source.projectKey === snapshot.currentProject?.key)
  )
  const projectChanged =
    draft?.scope === 'project' &&
    (!snapshot.currentProject || draft.projectKey !== snapshot.currentProject.key)
  return (
    <section
      className="h-full overflow-y-auto px-4 pt-24 pb-8"
      aria-label={t('Folder synchronization')}
    >
      <div className="mx-auto flex max-w-4xl flex-col gap-4">
        <div className="glass flex items-center gap-4 rounded-2xl p-5">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <FolderSync size={24} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold">{t('Automatic synchronization')}</h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {t(
                enabled
                  ? 'Watching for changes'
                  : 'Choose folders once and reuse them in your CapCut projects.'
              )}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-xs text-muted-foreground">{t('Enable')}</span>
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
            <p>{t(failure)}</p>
          </div>
        )}
        {enabled ? (
          <>
            {window.capshare.env.platform === 'win32' && (
              <p className="px-1 text-xs text-muted-foreground">
                {t('When you close the window, WakuShare continues working in the system tray.')}
              </p>
            )}
            <div className="glass-subtle rounded-2xl px-4 py-3 text-xs leading-relaxed text-muted-foreground">
              <span className="mr-2 rounded-full bg-warning/10 px-2 py-0.5 font-medium text-warning">
                {t(
                  snapshot.nativeMode === 'product'
                    ? 'Automatic synchronization'
                    : snapshot.nativeMode === 'laboratory'
                      ? 'Laboratory mode'
                      : 'In development'
                )}
              </span>
              {snapshot.nativeMode === 'product'
                ? t(
                    'Media from selected folders is added to the open project, keeping its folder structure. Changes synchronize automatically.'
                  )
                : snapshot.nativeMode === 'laboratory'
                  ? t(
                      'Preview: automatic import and verified PNG path updates are available in CapSync-Lab-20261013-001. Other projects are not modified.'
                    )
                  : snapshot.status === 'WaitingForRuntime'
                    ? t('The synchronization runtime is not included in this build yet.')
                    : t(
                        'Folder settings and change tracking are available. Automatic importing into CapCut is still being connected.'
                      )}
            </div>
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
            <ImportProgress snapshot={snapshot} />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div
                className="glass-subtle inline-flex gap-1 rounded-full p-1"
                role="tablist"
                aria-label={t('Source scope')}
              >
                {(['global', 'project'] as const).map((scope) => (
                  <button
                    key={scope}
                    type="button"
                    role="tab"
                    aria-selected={tab === scope}
                    onClick={() => {
                      setTab(scope)
                      setDraft(null)
                    }}
                    className={`rounded-full px-4 py-2 text-xs font-medium transition-colors ${tab === scope ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                  >
                    {t(scope === 'global' ? 'All projects' : 'This project')}
                  </button>
                ))}
              </div>
              <Button
                size="sm"
                variant="secondary"
                isDisabled={busy || (tab === 'project' && !snapshot.currentProject)}
                onPress={() => {
                  void chooseFolder()
                }}
              >
                <Plus size={16} />
                {t('Add folder')}
              </Button>
            </div>
            {tab === 'project' && (
              <div className="glass-subtle min-w-0 rounded-2xl p-4">
                <p className="truncate text-sm font-medium">
                  {snapshot.currentProject?.name ?? t('No confirmed project')}
                </p>
                <p
                  className="mt-1 truncate text-xs text-muted-foreground"
                  title={snapshot.currentProject?.location}
                >
                  {snapshot.currentProject?.location ??
                    t('Local folders become available after a CapCut project is connected.')}
                </p>
              </div>
            )}
            {draft && (
              <form
                className="glass rounded-2xl p-4"
                onSubmit={(event) => {
                  event.preventDefault()
                  void edit({
                    type: 'add',
                    rootPath: draft.path,
                    label: draft.label,
                    scope: draft.scope,
                    expectedProjectKey: draft.projectKey
                  }).then((saved) => {
                    if (saved) setDraft(null)
                  })
                }}
              >
                <h3 className="mb-3 text-sm font-semibold">{t('New source folder')}</h3>
                <p className="mb-4 break-all text-xs text-muted-foreground select-text">
                  {draft.path}
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <TextField
                    value={draft.label}
                    onChange={(value) => setDraft({ ...draft, label: value })}
                    isDisabled={busy}
                  >
                    <Label>{t('Connection name')}</Label>
                    <Input maxLength={80} />
                  </TextField>
                  <div className="flex flex-col justify-end gap-1">
                    <span className="text-xs font-medium">{t('Source scope')}</span>
                    <FormSelect
                      label={t('Source scope')}
                      value={draft.scope}
                      options={[
                        { id: 'global', label: t('All projects') },
                        ...(snapshot.currentProject
                          ? [{ id: 'project', label: t('This project') }]
                          : [])
                      ]}
                      onChange={(value) =>
                        setDraft({
                          ...draft,
                          scope: value as 'global' | 'project',
                          projectKey: snapshot.currentProject?.key
                        })
                      }
                      disabled={busy}
                    />
                  </div>
                </div>
                {projectChanged && (
                  <p className="mt-3 text-xs text-warning">
                    {t('The project changed. Select the source scope again.')}
                  </p>
                )}
                <div className="mt-4 flex gap-2">
                  <Button
                    type="submit"
                    size="sm"
                    isDisabled={busy || !draft.label.trim() || projectChanged}
                  >
                    {t('Add folder')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    isDisabled={busy}
                    onPress={() => setDraft(null)}
                  >
                    {t('Cancel')}
                  </Button>
                </div>
              </form>
            )}
            {sources.length && (tab !== 'project' || snapshot.currentProject) ? (
              <div className="grid min-w-0 gap-3">
                {sources.map((source) => (
                  <SourceCard
                    key={source.id}
                    source={source}
                    snapshot={snapshot}
                    localTab={tab === 'project'}
                    busy={busy}
                    edit={edit}
                    rescan={rescan}
                  />
                ))}
              </div>
            ) : !draft && tab === 'global' ? (
              <div className="glass-subtle flex flex-col items-center rounded-2xl px-6 py-10 text-center">
                <FolderPlus size={30} className="mb-3 text-primary/70" />
                <h3 className="text-sm font-semibold">{t('Add your first folder')}</h3>
                <p className="mt-2 max-w-md text-xs leading-relaxed text-muted-foreground">
                  {t(
                    'Your folder structure is kept. Files are added to the media library, never to the timeline.'
                  )}
                </p>
                <Button
                  size="sm"
                  className="mt-5"
                  onPress={() => {
                    void chooseFolder()
                  }}
                >
                  <Plus size={15} />
                  {t('Add folder')}
                </Button>
              </div>
            ) : null}
            {snapshot.lastCheckedAt && (
              <p className="px-1 text-xs text-muted-foreground">
                {t('Last folder check: {0}', [
                  new Date(snapshot.lastCheckedAt).toLocaleTimeString(
                    language === 'ru' ? 'ru-RU' : 'en-US',
                    { hour: '2-digit', minute: '2-digit' }
                  )
                ])}
              </p>
            )}
          </>
        ) : (
          <div className="glass-subtle flex flex-col items-center rounded-2xl px-6 py-10 text-center">
            <FolderOpen size={32} className="mb-3 text-muted-foreground/60" />
            <h3 className="text-sm font-semibold">
              {t(
                sources.length
                  ? 'Your folders are ready'
                  : 'Your media folders, always close at hand'
              )}
            </h3>
            <p className="mt-2 max-w-md text-xs leading-relaxed text-muted-foreground">
              {t(
                sources.length
                  ? 'Turn on synchronization to watch your connected folders. Only file changes trigger synchronization.'
                  : 'Enable synchronization to choose folders. Saved connections will stay here when you turn it off.'
              )}
            </p>
            {sources.length > 0 && (
              <div className="mt-5 w-full max-w-lg space-y-2 text-left">
                {sources.map((source) => (
                  <div
                    key={source.id}
                    className="flex min-w-0 items-center gap-3 rounded-xl bg-foreground/5 px-4 py-3"
                  >
                    <FolderOpen size={17} className="shrink-0 text-primary" />
                    <div className="min-w-0">
                      <p className="text-xs font-medium">{source.label}</p>
                      <p
                        className="mt-1 truncate text-[11px] text-muted-foreground"
                        title={source.rootPath}
                      >
                        {source.rootPath}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
