import { useCallback, useEffect, useMemo, useState, type JSX } from 'react'
import { Checkbox, Switch } from '@heroui/react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import {
  Check,
  Clapperboard,
  Copy,
  FolderOpen,
  Globe2,
  LockKeyhole,
  Plus,
  RefreshCw,
  Search,
  X
} from 'lucide-react'
import type { ExplorerEdit, ExplorerProjectChoice, ExplorerSnapshot } from '@shared/explorer'
import { folderPathKey, projectFolderChoices } from '@shared/explorer-folders'
import { t } from '@/lib/i18n'
import { errorMessage, unwrap } from '@/lib/ipc'
import { ExplorerButton as Button } from './ExplorerButton'
import { ConnectionActions } from './ConnectionActions'

export function ProjectFolders({
  snapshot,
  selectedKey,
  onSelect,
  onAdd,
  onCommon,
  busy,
  edit
}: {
  snapshot: ExplorerSnapshot
  selectedKey: string | null
  onSelect: (key: string) => void
  onAdd: (key: string) => void
  onCommon: () => void
  busy: boolean
  edit: (edit: ExplorerEdit) => Promise<boolean>
}): JSX.Element {
  const reducedMotion = useReducedMotion()
  const [catalog, setCatalog] = useState<ExplorerProjectChoice[]>([])
  const [loading, setLoading] = useState(true)
  const [failure, setFailure] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [folderSearch, setFolderSearch] = useState('')
  const [copying, setCopying] = useState(false)
  const [targets, setTargets] = useState<string[]>([])
  const [copySearch, setCopySearch] = useState('')
  const [copiedProject, setCopiedProject] = useState<string | null>(null)
  const refresh = useCallback(async (): Promise<void> => {
    try {
      setCatalog(unwrap(await window.capshare.explorerProjects()))
      setFailure(null)
    } catch (error) {
      setFailure(errorMessage(error))
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    let disposed = false
    void window.capshare
      .explorerProjects()
      .then((response) => {
        if (!disposed) {
          setCatalog(unwrap(response))
          setFailure(null)
        }
      })
      .catch((error) => {
        if (!disposed) setFailure(errorMessage(error))
      })
      .finally(() => {
        if (!disposed) setLoading(false)
      })
    return () => {
      disposed = true
    }
  }, [])
  const projects = useMemo(() => {
    const choices = new Map<string, ExplorerProjectChoice>(
      snapshot.configuration.projects.map((project) => [project.key, project])
    )
    for (const project of catalog) {
      for (const [key, previous] of choices)
        if (
          key !== project.key &&
          folderPathKey(previous.location) === folderPathKey(project.location)
        )
          choices.delete(key)
      choices.set(project.key, project)
    }
    return [...choices.values()].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true })
    )
  }, [catalog, snapshot.configuration.projects])
  const selected =
    projects.find((project) => project.key === selectedKey) ??
    projects.find((project) => project.key === snapshot.currentProject?.key) ??
    projects[0]
  useEffect(() => {
    if (selected && selected.key !== selectedKey) onSelect(selected.key)
  }, [selected, selectedKey, onSelect])
  const globals = snapshot.configuration.sources.filter(
    (source) => source.scope === 'global' && !source.detached
  )
  const choices = selected ? projectFolderChoices(snapshot.configuration, selected.key) : []
  const activeCount = choices.filter((choice) => choice.enabled).length
  const matches = projects.filter((project) =>
    (project.name + '\n' + project.location)
      .toLocaleLowerCase()
      .includes(search.toLocaleLowerCase())
  )
  const folders = choices.filter(({ source }) =>
    (source.label + '\n' + source.rootPath)
      .toLocaleLowerCase()
      .includes(folderSearch.toLocaleLowerCase())
  )
  const select = (key: string): void => {
    onSelect(key)
    setCopying(false)
    setTargets([])
    setCopiedProject(null)
    setFolderSearch('')
  }
  return (
    <div className="explorer-projects" data-testid="project-folders">
      <aside className="glass-subtle explorer-projects__list" aria-label={t('Choose a project')}>
        <div className="explorer-projects__list-header">
          <div className="flex items-center justify-between gap-2">
            <h3 className="ui-type-section">{t('Projects')}</h3>
            <Button
              isIconOnly
              aria-label={t('Refresh projects')}
              isDisabled={loading}
              onPress={() => {
                setLoading(true)
                void refresh()
              }}
            >
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            </Button>
          </div>
          <label className="explorer-search">
            <Search size={15} aria-hidden="true" />
            <input
              aria-label={t('Search projects')}
              placeholder={t('Search projects')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
        </div>
        <div className="explorer-projects__items" aria-busy={loading}>
          {matches.map((project) => {
            const count = snapshot.configuration.sources.filter(
              (source) => source.projectKey === project.key && source.enabled && !source.detached
            ).length
            const open = snapshot.currentProject?.key === project.key
            return (
              <button
                type="button"
                key={project.key}
                className="explorer-project-choice"
                aria-pressed={selected?.key === project.key}
                onClick={() => select(project.key)}
                title={project.location}
              >
                <span className="explorer-project-choice__cover">
                  {project.coverDataUrl ? (
                    <img src={project.coverDataUrl} alt="" loading="lazy" />
                  ) : (
                    <Clapperboard size={18} />
                  )}
                </span>
                <span className="min-w-0 flex-1 text-left">
                  <span className="block truncate ui-type-item">{project.name}</span>
                  <span className="mt-1 flex items-center gap-1.5 ui-type-caption text-muted-foreground">
                    {open && <span className="explorer-open-dot" />}
                    {open ? t('Open in CapCut') : t('Additional: {0}', [count])}
                  </span>
                </span>
              </button>
            )
          })}
          {!matches.length && (
            <p className="px-3 py-6 text-center text-xs leading-relaxed text-muted-foreground">
              {loading
                ? t('Loading projects…')
                : projects.length
                  ? t('No projects match your search.')
                  : t('Projects from your CapCut library will appear here.')}
            </p>
          )}
        </div>
        {failure && (
          <p role="status" className="px-4 pb-4 text-xs text-warning">
            {t(failure)}
          </p>
        )}
      </aside>
      <motion.div
        key={selected?.key ?? 'empty'}
        className="explorer-projects__detail"
        initial={{ y: reducedMotion ? 0 : 5 }}
        animate={{ y: 0 }}
        transition={{ duration: reducedMotion ? 0 : 0.2, ease: [0.22, 1, 0.36, 1] }}
      >
        {selected ? (
          <>
            <div className="explorer-projects__heading">
              <div className="min-w-0">
                <h3 className="truncate ui-type-section" title={selected.name}>
                  {selected.name}
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {selected.key === snapshot.currentProject?.key
                    ? t('Folders synchronize with the open project.')
                    : t(
                        'Settings are saved now. Synchronization starts when you open this project in CapCut.'
                      )}
                </p>
              </div>
              <Button className="shrink-0" isDisabled={busy} onPress={() => onAdd(selected.key)}>
                <Plus size={15} />
                {t('Add folder')}
              </Button>
            </div>
            <section
              className="glass-subtle explorer-common-folders"
              aria-label={t('Folders connected to every project')}
            >
              <div className="flex items-start gap-3">
                <span className="explorer-folder-icon">
                  <Globe2 size={18} />
                </span>
                <div className="min-w-0 flex-1">
                  <h4 className="ui-type-item">{t('Connected to every project')}</h4>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {t('Common folders stay active independently of the selected tab or project.')}
                  </p>
                </div>
                <LockKeyhole
                  size={15}
                  className="mt-0.5 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              </div>
              {globals.length > 0 && (
                <div className="mt-3 space-y-2">
                  {globals.map((source) => (
                    <div
                      key={source.id}
                      className="flex min-w-0 items-center gap-2.5 text-xs"
                      title={source.rootPath}
                    >
                      <FolderOpen size={14} className="shrink-0 text-muted-foreground" />
                      <span className="truncate">{source.label}</span>
                      <span className="ml-auto shrink-0 ui-type-caption text-muted-foreground">
                        {source.enabled ? t('All projects') : t('Paused in Common folders')}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <Button className="mt-3" onPress={onCommon}>
                {globals.length ? t('Manage common folders') : t('Add a common folder')}
              </Button>
            </section>
            <section
              className="glass-subtle explorer-project-sources"
              aria-label={t('Additional project folders')}
            >
              <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4">
                <h4 className="ui-type-item">
                  {t('Additional folders')}{' '}
                  <span className="ml-1 font-normal text-muted-foreground">{activeCount}</span>
                </h4>
                <Button
                  isDisabled={busy || !activeCount || projects.length < 2}
                  onPress={() => {
                    setCopying(!copying)
                    setTargets([])
                    setCopiedProject(null)
                    setCopySearch('')
                  }}
                >
                  <Copy size={14} />
                  {t('Apply set')}
                </Button>
              </div>
              <AnimatePresence initial={false}>
                {copying && (
                  <motion.div
                    key="copy-set"
                    initial={{ height: 0 }}
                    animate={{ height: 'auto' }}
                    exit={{ height: 0, pointerEvents: 'none' }}
                    transition={{ duration: reducedMotion ? 0 : 0.22, ease: [0.22, 1, 0.36, 1] }}
                    className="overflow-hidden"
                  >
                    <div className="explorer-copy-set mx-4 mt-3 rounded-xl p-3">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-xs leading-relaxed text-muted-foreground">
                          {t(
                            'Apply these additional folders to selected projects. Their previous additional selection will be replaced; imported media stays in place.'
                          )}
                        </p>
                        <Button
                          isIconOnly
                          aria-label={t('Close')}
                          onPress={() => setCopying(false)}
                        >
                          <X size={14} />
                        </Button>
                      </div>
                      <label className="explorer-search mt-3">
                        <Search size={14} />
                        <input
                          aria-label={t('Search target projects')}
                          placeholder={t('Search projects')}
                          value={copySearch}
                          onChange={(event) => setCopySearch(event.target.value)}
                        />
                      </label>
                      <div className="mt-2 max-h-44 overflow-y-auto">
                        {projects
                          .filter(
                            (project) =>
                              project.key !== selected.key &&
                              project.name
                                .toLocaleLowerCase()
                                .includes(copySearch.toLocaleLowerCase())
                          )
                          .map((project) => (
                            <Checkbox
                              key={project.key}
                              className="flex w-full gap-2 rounded-lg px-2 py-2"
                              isSelected={targets.includes(project.key)}
                              isDisabled={busy}
                              onChange={(checked) =>
                                setTargets((values) =>
                                  checked
                                    ? [...values, project.key]
                                    : values.filter((key) => key !== project.key)
                                )
                              }
                            >
                              <Checkbox.Control>
                                <Checkbox.Indicator />
                              </Checkbox.Control>
                              <span className="truncate text-xs">{project.name}</span>
                            </Checkbox>
                          ))}
                      </div>
                      <Button
                        className="mt-3"
                        isDisabled={busy || !targets.length}
                        onPress={() => {
                          void edit({
                            type: 'copyProjectFolders',
                            projectKey: selected.key,
                            targetProjectKeys: targets
                          }).then((ok) => {
                            if (ok) {
                              setCopying(false)
                              setCopiedProject(selected.key)
                            }
                          })
                        }}
                      >
                        {t('Apply to {0} projects', [targets.length])}
                      </Button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
              {copiedProject === selected.key && (
                <p
                  role="status"
                  className="mx-4 mt-2 flex items-center gap-1.5 text-xs text-success"
                >
                  <Check size={14} />
                  {t('Folder set applied.')}
                </p>
              )}
              {choices.length > 5 && (
                <label className="explorer-search mx-4 mt-3">
                  <Search size={14} />
                  <input
                    aria-label={t('Search folders')}
                    placeholder={t('Search folders')}
                    value={folderSearch}
                    onChange={(event) => setFolderSearch(event.target.value)}
                  />
                </label>
              )}
              <div className="space-y-1 p-2">
                {folders.map(({ source, enabled }) => (
                  <div key={source.id} className="explorer-project-folder">
                    <span className="explorer-folder-icon">
                      <FolderOpen size={18} />
                    </span>
                    <div className="min-w-0 flex-1 basis-40">
                      <p className="truncate ui-type-item">{source.label}</p>
                      <p
                        className="mt-1 truncate ui-type-caption text-muted-foreground"
                        title={source.rootPath}
                      >
                        {source.rootPath}
                      </p>
                    </div>
                    <Button
                      isIconOnly
                      aria-label={t('Show {0}', [source.label])}
                      onPress={() => void window.capshare.revealPath(source.rootPath)}
                    >
                      <FolderOpen size={15} />
                    </Button>
                    {source.projectKey === selected.key && (
                      <ConnectionActions source={source} busy={busy} edit={edit} />
                    )}
                    <Switch
                      className="explorer-switch"
                      aria-label={t('Enable {0} for {1}', [source.label, selected.name])}
                      isSelected={enabled}
                      isDisabled={busy}
                      onChange={(value) => {
                        setCopiedProject(null)
                        void edit({
                          type: 'projectFolder',
                          sourceId: source.id,
                          projectKey: selected.key,
                          enabled: value
                        })
                      }}
                    >
                      <Switch.Control>
                        <Switch.Thumb />
                      </Switch.Control>
                    </Switch>
                  </div>
                ))}
              </div>
              {!choices.length && (
                <div className="px-5 pb-5 text-xs leading-relaxed text-muted-foreground">
                  {t(
                    'Add a folder for this client or project. You can reuse it in other projects later.'
                  )}
                </div>
              )}
              {choices.length > 0 && !folders.length && (
                <p className="px-4 pb-4 text-xs text-muted-foreground">
                  {t('No folders match your search.')}
                </p>
              )}
            </section>
            <p className="px-1 text-[11px] leading-relaxed text-muted-foreground">
              {t(
                'Turning off an additional folder stops its synchronization. Imported media and timeline clips are kept.'
              )}
            </p>
          </>
        ) : (
          <div className="glass-subtle flex min-h-72 flex-col items-center justify-center rounded-2xl p-6 text-center">
            <Clapperboard size={28} className="mb-3 text-muted-foreground" />
            <h3 className="ui-type-state">{t('Choose a project')}</h3>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {t('Projects from your CapCut library will appear here.')}
            </p>
          </div>
        )}
      </motion.div>
    </div>
  )
}
