import { toast } from '@/lib/notifications'
import { t, useLanguage } from '@/lib/i18n'
import { useCallback, useEffect, useState, type JSX } from 'react'
import { Button, Checkbox, Input, Label, TextField } from '@heroui/react'
import { FormSelect } from '@/components/FormSelect'
import { ChevronRight, Folder, Package, RefreshCw } from 'lucide-react'
import type {
  PresetLibrary,
  PresetNode,
  PresetTransferResult,
  PresetImportReview,
  PresetImportOptions
} from '@shared/types'
import { newTaskId } from '@/lib/format'
import { errorMessage, unwrap } from '@/lib/ipc'

function branch(nodes: PresetNode[], id: string): string[] {
  return [
    id,
    ...nodes.filter((node) => node.parentId === id).flatMap((node) => branch(nodes, node.id))
  ]
}

export function PresetsView({
  onBusyChange
}: {
  onBusyChange: (busy: boolean) => void
}): JSX.Element {
  useLanguage()

  const [library, setLibrary] = useState<PresetLibrary | null>(null)
  const [destination, setDestination] = useState('')
  const [targetLibrary, setTargetLibrary] = useState<PresetLibrary | null>(null)
  const [targetFolder, setTargetFolder] = useState('')
  const [newFolder, setNewFolder] = useState('')
  const [folderMode, setFolderMode] = useState<'merge' | 'copies'>('merge')
  const [review, setReview] = useState<PresetImportReview | null>(null)
  const [duplicates, setDuplicates] = useState<NonNullable<PresetImportOptions['duplicates']>>({})
  const [capcutRunning, setCapcutRunning] = useState<boolean | null>(null)
  const [archive, setArchive] = useState<string | null>(null)
  const [parent, setParent] = useState<string | null>(null)
  const [selection, setSelection] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [task, setTask] = useState<{ id: string; ratio: number; phase: string } | null>(null)
  const [result, setResult] = useState<PresetTransferResult | null>(null)
  const [missing, setMissing] = useState<string[]>([])
  const [missingOwners, setMissingOwners] = useState<Record<string, string[]>>({})
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    onBusyChange(busy)
    return () => onBusyChange(false)
  }, [busy, onBusyChange])

  const showLibrary = useCallback((next: PresetLibrary): void => {
    setLibrary(next)
    setParent(null)
    setSelection(new Set(next.nodes.map((node) => node.id)))
    setResult(null)
    setMissing([])
    setOverrides({})
    setError(null)
    setReview(null)
    setDuplicates({})
  }, [])
  const load = useCallback(
    async (root?: string): Promise<void> => {
      setBusy(true)
      try {
        const next = unwrap(await window.capshare.listPresets(root))
        if (!root) setDestination(next.root)
        if (!root) setTargetLibrary(next)
        setArchive(null)
        showLibrary(next)
      } catch (error) {
        setError(errorMessage(error))
      } finally {
        setBusy(false)
      }
    },
    [showLibrary]
  )
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])
  useEffect(
    () =>
      window.capshare.onProgress((event) =>
        setTask((current) =>
          current?.id === event.taskId
            ? { id: current.id, ratio: event.ratio, phase: event.phase }
            : current
        )
      ),
    []
  )
  useEffect(() => {
    let disposed = false
    const check = async (): Promise<void> => {
      try {
        const running = unwrap(await window.capshare.isCapCutRunning())
        if (!disposed) setCapcutRunning(running)
      } catch {
        if (!disposed) setCapcutRunning(null)
      }
    }
    void check()
    const timer = window.setInterval(() => void check(), 5000)
    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [])

  const openArchive = async (existing?: string): Promise<void> => {
    setBusy(true)
    try {
      const path = existing ?? unwrap(await window.capshare.pickPresetPackage())
      if (path) {
        const target = unwrap(await window.capshare.listPresets())
        setDestination(target.root)
        setTargetLibrary(target)
        if (
          targetFolder &&
          !target.nodes.some((node) => node.id === targetFolder && node.kind === 'folder')
        )
          setTargetFolder('')
        showLibrary(unwrap(await window.capshare.inspectPresetPackage(path)))
        setArchive(path)
      }
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }
  const chooseLibrary = async (): Promise<void> => {
    try {
      const root = unwrap(await window.capshare.pickFolder('Choose the CapCut Presets folder'))
      if (root) await load(root)
    } catch (error) {
      setError(errorMessage(error))
    }
  }
  const toggle = (id: string): void => {
    if (!library) return
    const ids = branch(library.nodes, id)
    const next = new Set(selection)
    const terminals = ids.filter((id) => !library.nodes.some((node) => node.parentId === id))
    const remove = terminals.every((id) => next.has(id))
    for (const id of ids) {
      if (remove) next.delete(id)
      else next.add(id)
    }
    // A partially selected folder must not expand back to all its children on export.
    let ancestor = library.nodes.find((node) => node.id === id)?.parentId
    while (ancestor) {
      next.delete(ancestor)
      ancestor = library.nodes.find((node) => node.id === ancestor)?.parentId
    }
    setSelection(next)
    setResult(null)
    setReview(null)
  }
  const run = async (): Promise<void> => {
    if (!library) return
    setBusy(true)
    setResult(null)
    setError(null)
    setMissing([])
    try {
      const packagePath = archive ?? unwrap(await window.capshare.pickPresetDestination())
      if (!packagePath) return
      const id = newTaskId()
      setTask({ id, ratio: 0, phase: 'Preparing presets' })
      const request = {
        taskId: id,
        root: library.root,
        packagePath,
        selection: [...selection],
        sourceOverrides: overrides,
        importOptions: {
          targetFolderId: targetFolder || null,
          newFolderName: newFolder,
          folderMode,
          duplicates
        },
        reviewToken: review?.token
      }
      const response = archive
        ? await window.capshare.importPresets(request)
        : await window.capshare.exportPresets(request)
      if (!response.ok && response.error.detail) {
        try {
          const detail = JSON.parse(response.error.detail)
          const owners: Record<string, string[]> = {}
          if (Array.isArray(detail.missingReferences))
            for (const item of detail.missingReferences) {
              const name = library.nodes.find((node) => node.id === item.owner)?.name
              if (typeof item.path === 'string' && name)
                owners[item.path] = [...new Set([...(owners[item.path] ?? []), name])]
            }
          setMissingOwners(owners)
          if (Array.isArray(detail.missingPaths)) {
            setMissing(
              detail.missingPaths.filter(
                (path: unknown): path is string => typeof path === 'string'
              )
            )
            setError(response.error.message)
            return
          }
        } catch {
          /* Other errors have plain-text diagnostics. */
        }
      }
      setResult(unwrap(response))
      if (archive) {
        setReview(null)
        setTargetLibrary(unwrap(await window.capshare.listPresets()))
      }
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setBusy(false)
      setTask(null)
    }
  }
  const checkImport = async (): Promise<void> => {
    if (!archive || !library) return
    setBusy(true)
    setError(null)
    setReview(null)
    setResult(null)
    const id = newTaskId()
    setTask({ id, ratio: 0, phase: 'Checking duplicates' })
    try {
      const next = unwrap(
        await window.capshare.reviewPresets({
          taskId: id,
          root: library.root,
          packagePath: archive,
          selection: [...selection],
          importOptions: {
            targetFolderId: targetFolder || null,
            newFolderName: newFolder,
            folderMode
          }
        })
      )
      setReview(next)
      setDuplicates(
        Object.fromEntries(
          next.presets
            .filter((item) => item.matches.length)
            .map((item) => [item.sourceId, { action: 'skip' as const }])
        )
      )
      setCapcutRunning(unwrap(await window.capshare.isCapCutRunning()))
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setBusy(false)
      setTask(null)
    }
  }
  const launch = async (): Promise<void> => {
    setBusy(true)
    try {
      if (!unwrap(await window.capshare.launchCapCut()))
        throw new Error('Could not find CapCut to launch.')
      setCapcutRunning(true)
    } catch (error) {
      toast.danger(t(errorMessage(error)))
    } finally {
      setBusy(false)
    }
  }
  const locate = async (oldPath: string, folder = false): Promise<void> => {
    try {
      const replacement = unwrap(
        folder
          ? await window.capshare.pickFolder('Locate the missing resource folder')
          : await window.capshare.pickPresetSource()
      )
      if (replacement) setOverrides((current) => ({ ...current, [oldPath]: replacement }))
    } catch (error) {
      toast.danger(t(errorMessage(error)))
    }
  }
  const nodes = library?.nodes ?? []
  const crumbs: PresetNode[] = []
  let current = nodes.find((node) => node.id === parent)
  while (current) {
    crumbs.unshift(current)
    current = nodes.find((node) => node.id === current!.parentId)
  }
  const presetCount = nodes.filter(
    (node) => node.kind === 'preset' && selection.has(node.id)
  ).length
  const folderCount = nodes.filter(
    (node) => node.kind === 'folder' && selection.has(node.id)
  ).length
  const location = (node: PresetNode): string => {
    const parts = [node.name]
    let parent = node.parentId
    while (parent) {
      const folder = targetLibrary?.nodes.find((item) => item.id === parent)
      if (!folder) break
      parts.unshift(folder.name)
      parent = folder.parentId
    }
    return parts.join(' / ')
  }
  const changeTarget = (): void => {
    setReview(null)
    setResult(null)
    setDuplicates({})
  }

  return (
    <section
      className="presets-view h-full overflow-y-auto px-4 pt-24 pb-8"
      aria-label={t('Presets')}
    >
      <div className="mx-auto flex max-w-4xl flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant={archive ? 'secondary' : 'primary'}
            isDisabled={busy}
            onPress={() => void load()}
          >
            {t('My presets')}
          </Button>
          <Button
            size="sm"
            variant={archive ? 'primary' : 'secondary'}
            isDisabled={busy}
            onPress={() => void openArchive()}
          >
            {t('Open package')}
          </Button>
          {!archive && (
            <Button
              size="sm"
              variant="secondary"
              isDisabled={busy}
              onPress={() => void chooseLibrary()}
            >
              {t('Choose library')}
            </Button>
          )}
          <Button
            isIconOnly
            size="sm"
            variant="ghost"
            aria-label={t('Refresh presets')}
            isDisabled={busy}
            onPress={() => void (archive ? openArchive(archive) : load(library?.root))}
          >
            <RefreshCw size={15} />
          </Button>
        </div>
        <div className="glass-subtle space-y-2 rounded-2xl px-4 py-3 text-xs leading-relaxed text-muted-foreground">
          <p>
            {t('Composition presets, including their media, available fonts and effect resources.')}
          </p>
          <p className="mt-1 break-all">
            {archive
              ? t('Package: {0}', [archive])
              : t('Library: {0}', [library?.root ?? t('Detecting...')])}
          </p>
          {archive && (
            <p className="mt-2 break-all">{t('Destination library: {0}', [destination])}</p>
          )}
        </div>
        {archive && (
          <div className="glass-subtle flex flex-col gap-3 rounded-2xl p-3 text-sm">
            <FormSelect
              label={t('Destination folder')}
              showLabel
              disabled={busy}
              value={targetFolder ? `folder:${targetFolder}` : 'root'}
              options={[
                { id: 'root', label: t('Library root') },
                ...(targetLibrary?.nodes ?? [])
                  .filter((node) => node.kind === 'folder')
                  .map((node) => ({ id: `folder:${node.id}`, label: location(node) }))
              ]}
              onChange={(value) => {
                setTargetFolder(value === 'root' ? '' : value.slice('folder:'.length))
                changeTarget()
              }}
            />
            <TextField
              fullWidth
              isDisabled={busy}
              value={newFolder}
              onChange={(value) => {
                setNewFolder(value)
                changeTarget()
              }}
            >
              <Label>{t('New subfolder (optional)')}</Label>
              <Input
                aria-label={t('New subfolder')}
                placeholder={t('For example: Foreign presets')}
                maxLength={120}
              />
            </TextField>
            <FormSelect
              label={t('Matching folders')}
              showLabel
              disabled={busy}
              value={folderMode}
              options={[
                { id: 'merge', label: t('Merge folders with the same name at this destination') },
                { id: 'copies', label: t('Create separate folder copies') }
              ]}
              onChange={(value) => {
                setFolderMode(value as 'merge' | 'copies')
                changeTarget()
              }}
            />
            <p
              role="status"
              className={
                capcutRunning === false ? 'text-xs text-muted-foreground' : 'text-xs text-warning'
              }
            >
              {capcutRunning === null
                ? t('Checking whether CapCut is closed. Import is blocked until this is known.')
                : capcutRunning
                  ? t('CapCut is running. Close it before importing presets.')
                  : t(
                      'CapCut is closed. It will be checked again before import and before saving.'
                    )}
            </p>
          </div>
        )}
        {library?.warnings.map((warning) => (
          <p key={warning} className="rounded-xl bg-warning/10 p-3 text-xs">
            {t(warning)}
          </p>
        ))}
        <div className="glass-subtle overflow-hidden rounded-2xl">
          <nav
            aria-label={t('Preset folders')}
            className="flex min-h-14 flex-wrap items-center gap-1 border-b border-foreground/10 px-4 py-2 text-sm"
          >
            {parent === null ? (
              <span aria-current="page" className="px-2 py-2 font-semibold">
                {t('All presets')}
              </span>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                isDisabled={busy}
                onPress={() => setParent(null)}
                className="max-w-full rounded-lg px-2 font-semibold"
              >
                {t('All presets')}
              </Button>
            )}
            {crumbs.map((node, index) => (
              <span className="flex items-center gap-1" key={node.id}>
                <ChevronRight size={13} />
                {index === crumbs.length - 1 ? (
                  <span aria-current="page" className="max-w-full truncate px-2 py-2 font-semibold">
                    {node.name}
                  </span>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    isDisabled={busy}
                    onPress={() => setParent(node.id)}
                    className="max-w-full rounded-lg px-2"
                  >
                    {node.name}
                  </Button>
                )}
              </span>
            ))}
          </nav>
          <div className="flex flex-wrap items-center gap-2 px-4 py-3 text-xs">
            <Button
              size="sm"
              variant="ghost"
              isDisabled={busy || !nodes.length || nodes.every((node) => selection.has(node.id))}
              className="preset-selection-action rounded-lg"
              onPress={() => {
                setSelection(new Set(nodes.map((node) => node.id)))
                setReview(null)
                setResult(null)
              }}
            >
              {t('Select all')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              isDisabled={busy || selection.size === 0}
              className="preset-selection-action rounded-lg"
              onPress={() => {
                setSelection(new Set())
                setReview(null)
                setResult(null)
              }}
            >
              {t('Clear')}
            </Button>
            <span className="ml-auto px-2 tabular-nums text-muted-foreground">
              {t('{0} presets selected', [presetCount])}
            </span>
          </div>
          <ul className="divide-y divide-foreground/5 px-4 pb-3">
            {nodes
              .filter((node) => node.parentId === parent)
              .map((node) => {
                const terminals = branch(nodes, node.id).filter(
                  (id) => !nodes.some((child) => child.parentId === id)
                )
                const count = terminals.filter((id) => selection.has(id)).length
                return (
                  <li
                    key={node.id}
                    className="preset-row flex min-h-12 items-center gap-2 rounded-xl px-2 py-1.5"
                  >
                    <Checkbox
                      className="shrink-0 p-2"
                      aria-label={t(`Select ${node.name}`)}
                      isDisabled={busy}
                      isSelected={count === terminals.length}
                      isIndeterminate={count > 0 && count < terminals.length}
                      onChange={() => toggle(node.id)}
                    >
                      <Checkbox.Control>
                        <Checkbox.Indicator />
                      </Checkbox.Control>
                    </Checkbox>
                    {node.kind === 'folder' ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        isDisabled={busy}
                        onPress={() => setParent(node.id)}
                        className="preset-folder-link h-10 min-w-0 flex-1 justify-start gap-2.5 rounded-lg px-2 text-left text-sm"
                      >
                        <Folder size={18} />
                        <span className="truncate">{node.name}</span>
                        <ChevronRight size={15} className="ml-auto" />
                      </Button>
                    ) : (
                      <span
                        className="flex min-w-0 flex-1 items-center gap-2.5 px-2 text-sm"
                        title={node.name}
                      >
                        <Package size={18} className="shrink-0 text-muted-foreground" />
                        <span className="truncate">{node.name}</span>
                      </span>
                    )}
                  </li>
                )
              })}
          </ul>
          {!nodes.some((node) => node.parentId === parent) && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {busy ? t('Loading...') : t('No composition presets in this folder.')}
            </p>
          )}
        </div>
        {missing.length > 0 && (
          <div className="rounded-xl bg-warning/10 p-3 text-xs">
            <p className="mb-2 font-semibold">
              {t(
                'Some sources are already missing. Locate them, or deselect the affected presets.'
              )}
            </p>
            <p className="mb-2">
              {t(
                'For a missing effect folder, open the preset in CapCut and download that effect again.'
              )}
            </p>
            {missing.map((path) => (
              <div key={path} className="mb-3 flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 break-all">
                  {path}
                  {missingOwners[path]?.length > 0 && (
                    <span className="mt-1 block text-muted-foreground">
                      {t('Presets: {0}', [missingOwners[path].join(', ')])}
                    </span>
                  )}
                  {overrides[path] && (
                    <span className="block text-success">
                      {t('Replacement: {0}', [overrides[path]])}
                    </span>
                  )}
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  isDisabled={busy}
                  onPress={() => void locate(path)}
                >
                  {t('Locate file')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  isDisabled={busy}
                  onPress={() => void locate(path, true)}
                >
                  {t('Locate folder')}
                </Button>
              </div>
            ))}
          </div>
        )}
        {error && (
          <p role="alert" className="rounded-xl bg-danger/10 p-3 text-sm">
            {t(error)}
          </p>
        )}
        {archive && review && (
          <div className="glass-subtle flex flex-col gap-3 rounded-2xl p-3 text-sm">
            <p className="font-semibold">{t('Import review')}</p>
            <p className="text-xs">
              {t(
                '{0} presets; {1} folders will merge, {2} new folders before duplicate decisions.',
                [
                  review.presets.length,
                  review.folders.filter((folder) => folder.action === 'merge').length,
                  review.folders.filter((folder) => folder.action === 'create').length
                ]
              )}
            </p>
            <p className="text-xs text-muted-foreground">
              {t(
                'Full matches compare preset contents and resources, allowing for relocated paths and generated IDs. Replacement keeps the existing name and location and saves a full backup.'
              )}
            </p>
            {review.warnings.map((warning) => (
              <p key={warning} className="text-xs text-warning">
                {t(warning)}
              </p>
            ))}
            {review.presets.filter((item) => item.matches.length).length > 0 ? (
              <>
                <div className="flex gap-3 text-xs">
                  <Button
                    size="sm"
                    variant="ghost"
                    isDisabled={busy}
                    className="text-primary rounded-full"
                    onPress={() =>
                      setDuplicates(
                        Object.fromEntries(
                          review.presets
                            .filter((item) => item.matches.length)
                            .map((item) => [item.sourceId, { action: 'skip' }])
                        )
                      )
                    }
                  >
                    {t('Skip all duplicates')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    isDisabled={busy}
                    className="text-primary rounded-full"
                    onPress={() =>
                      setDuplicates(
                        Object.fromEntries(
                          review.presets
                            .filter((item) => item.matches.length)
                            .map((item) => [item.sourceId, { action: 'copy' }])
                        )
                      )
                    }
                  >
                    {t('Copy all duplicates')}
                  </Button>
                </div>
                {review.presets
                  .filter((item) => item.matches.length)
                  .map((item) => (
                    <div key={item.sourceId} className="rounded-xl bg-foreground/5 p-3">
                      <p className="mb-1 font-medium">{item.name}</p>
                      <p className="mb-2 text-xs text-muted-foreground">
                        {t('Full matches: {0}', [
                          item.matches.map((match) => match.location).join('; ')
                        ])}
                      </p>
                      <FormSelect
                        label={t(`Duplicate action for ${item.name}`)}
                        disabled={busy}
                        value={duplicates[item.sourceId]?.action ?? 'skip'}
                        options={[
                          { id: 'skip', label: t('Do not import this duplicate') },
                          { id: 'copy', label: t('Add a separate copy') },
                          { id: 'replace', label: t('Replace an existing preset') }
                        ]}
                        onChange={(value) => {
                          const action = value as 'copy' | 'skip' | 'replace'
                          setDuplicates((current) => ({
                            ...current,
                            [item.sourceId]: {
                              action,
                              targetId: action === 'replace' ? item.matches[0].id : undefined
                            }
                          }))
                        }}
                      />
                      {duplicates[item.sourceId]?.action === 'replace' && (
                        <div className="mt-2">
                          <FormSelect
                            label={t(`Replacement target for ${item.name}`)}
                            disabled={busy}
                            value={duplicates[item.sourceId].targetId ?? item.matches[0].id}
                            options={item.matches.map((match) => ({
                              id: match.id,
                              label: match.location
                            }))}
                            onChange={(value) =>
                              setDuplicates((current) => ({
                                ...current,
                                [item.sourceId]: { action: 'replace', targetId: value }
                              }))
                            }
                          />
                        </div>
                      )}
                    </div>
                  ))}
              </>
            ) : (
              <p className="text-xs">{t('No confirmed full duplicates found.')}</p>
            )}
            <p className="text-xs font-medium">
              {t('Will add {0}, replace {1}, skip {2} presets.', [
                review.presets.filter(
                  (item) => !item.matches.length || duplicates[item.sourceId]?.action === 'copy'
                ).length,
                Object.values(duplicates).filter((item) => item.action === 'replace').length,
                Object.values(duplicates).filter((item) => item.action === 'skip').length
              ])}
            </p>
          </div>
        )}
        {task && (
          <div role="status" className="text-xs">
            <p className="mb-2">
              {t(task.phase)}: {Math.round(task.ratio * 100)}%
            </p>
            <progress className="h-2 w-full" max={1} value={task.ratio} />
          </div>
        )}
        {archive && !review && !result && (
          <p className="text-xs text-muted-foreground">
            {t('First review the import to choose duplicate actions and enable importing.')}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {archive && (
            <Button
              variant="secondary"
              isDisabled={busy || !selection.size}
              onPress={() => void checkImport()}
            >
              {t('Review import')}
            </Button>
          )}
          <Button
            variant="primary"
            isDisabled={
              busy ||
              !selection.size ||
              !library ||
              (presetCount === 0 && folderCount === 0) ||
              (!!archive && (!review || capcutRunning !== false))
            }
            onPress={() => void run()}
          >
            {archive ? t('Import reviewed selection') : t('Export selected')}
          </Button>
          {task && (
            <Button variant="secondary" onPress={() => void window.capshare.cancelTask(task.id)}>
              {t('Cancel')}
            </Button>
          )}
        </div>
        {result && (
          <div role="status" className="flex flex-col gap-3 rounded-xl bg-success/10 p-4 text-sm">
            <p className="font-medium">
              {archive && result.presets === 0 && !result.replaced && result.folders === 0
                ? t('No presets were added')
                : t(
                    archive
                      ? 'Imported: {0} presets, {1} folders.'
                      : 'Exported: {0} presets, {1} folders.',
                    [result.presets, result.folders]
                  )}
            </p>
            {archive && (
              <p className="mt-1 text-xs">
                {t('Replaced: {0}; skipped: {1}; merged folders: {2}.', [
                  result.replaced ?? 0,
                  result.skipped ?? 0,
                  result.mergedFolders ?? 0
                ])}
              </p>
            )}
            {result.warnings.map((warning) => (
              <p key={warning} className="mt-2 text-xs">
                {t(warning)}
              </p>
            ))}
            {result.backupPath && (
              <p className="mt-2 break-all text-xs">
                {t('Original catalog backup: {0}', [result.backupPath])}
              </p>
            )}
            <div
              className="flex flex-wrap items-center gap-2 pt-1"
              data-testid="preset-result-actions"
            >
              <Button
                size="sm"
                variant="ghost"
                onPress={() => void window.capshare.revealPath(result.path)}
              >
                {t('Show in folder')}
              </Button>
              {result.sourcesPath && (
                <Button
                  size="sm"
                  variant="ghost"
                  onPress={() => void window.capshare.revealPath(result.sourcesPath!)}
                >
                  {t('Show source files')}
                </Button>
              )}
              {archive && (
                <Button size="sm" variant="primary" isDisabled={busy} onPress={() => void launch()}>
                  {t('Launch CapCut')}
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
