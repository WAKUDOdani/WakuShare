import { useState, type JSX } from 'react'
import { Input, Label, TextField } from '@heroui/react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Check, FolderOpen, Pencil, Trash2, X } from 'lucide-react'
import type { ExplorerEdit, ExplorerSource } from '@shared/explorer'
import { t } from '@/lib/i18n'
import { unwrap, errorMessage } from '@/lib/ipc'
import { ExplorerButton as Button } from './ExplorerButton'

export function ConnectionActions({
  source,
  busy,
  edit
}: {
  source: ExplorerSource
  busy: boolean
  edit: (change: ExplorerEdit) => Promise<boolean>
}): JSX.Element {
  const reduced = useReducedMotion()
  const [panel, setPanel] = useState<'edit' | 'delete' | null>(null)
  const [name, setName] = useState(source.label)
  const [path, setPath] = useState(source.rootPath)
  const [picking, setPicking] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [mode, setMode] = useState<'replaceConnection' | 'relocateConnection'>('replaceConnection')
  const scope = source.projectKey ? { projectKey: source.projectKey } : {}
  const disabled = busy || picking
  return (
    <div className="contents">
      <Button
        isIconOnly
        isDisabled={disabled}
        aria-label={t('Edit folder connection')}
        onPress={() => {
          setName(source.label)
          setPath(source.rootPath)
          setMode('replaceConnection')
          setFailure(null)
          setPanel(panel === 'edit' ? null : 'edit')
        }}
      >
        <Pencil />
      </Button>
      <Button
        isIconOnly
        isDisabled={disabled}
        aria-label={t('Delete folder connection')}
        onPress={() => {
          setFailure(null)
          setPanel(panel === 'delete' ? null : 'delete')
        }}
      >
        <Trash2 />
      </Button>
      <AnimatePresence initial={false}>
        {panel && (
          <motion.div
            key={panel}
            className="order-1 w-full min-w-0 basis-full overflow-hidden"
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0, pointerEvents: 'none' }}
            transition={{ duration: reduced ? 0 : 0.2 }}
          >
            {panel === 'edit' ? (
              <form
                className="mt-3 flex min-w-0 flex-col gap-3 rounded-xl bg-foreground/5 p-3"
                onSubmit={(event) => {
                  event.preventDefault()
                  void edit({
                    type: mode,
                    sourceId: source.id,
                    rootPath: path,
                    label: name,
                    ...scope
                  }).then((ok) => {
                    if (ok) setPanel(null)
                  })
                }}
              >
                <TextField value={name} onChange={setName} isDisabled={disabled}>
                  <Label>{t('Connection name')}</Label>
                  <Input maxLength={80} />
                </TextField>
                <div className="flex min-w-0 items-end gap-2">
                  <TextField
                    className="min-w-0 flex-1"
                    value={path}
                    onChange={setPath}
                    isDisabled={disabled}
                  >
                    <Label>{t('Folder path')}</Label>
                    <Input maxLength={8192} />
                  </TextField>
                  <Button
                    isIconOnly
                    isDisabled={disabled}
                    aria-label={t('Choose a source folder')}
                    onPress={() => {
                      setPicking(true)
                      setFailure(null)
                      void window.capshare
                        .pickFolder(t('Choose a source folder'))
                        .then((result) => {
                          const chosen = unwrap(result)
                          if (chosen) setPath(chosen)
                        })
                        .catch((error) => setFailure(errorMessage(error)))
                        .finally(() => setPicking(false))
                    }}
                  >
                    <FolderOpen />
                  </Button>
                </div>
                {path.replace(/[\\/]+$/, '').toLowerCase() !==
                  source.rootPath.replace(/[\\/]+$/, '').toLowerCase() && (
                  <fieldset className="flex flex-col gap-2">
                    <legend className="mb-2 text-xs text-muted-foreground">
                      {t('How should this path change be applied?')}
                    </legend>
                    {(['replaceConnection', 'relocateConnection'] as const).map((value) => (
                      <label
                        key={value}
                        className="flex cursor-pointer items-start gap-2 rounded-lg bg-foreground/5 p-3 text-sm"
                      >
                        <input
                          type="radio"
                          name={`folder-mode-${source.id}`}
                          checked={mode === value}
                          disabled={disabled}
                          onChange={() => setMode(value)}
                          className="mt-1 accent-current"
                        />
                        <span className="flex flex-col gap-1">
                          <span className="font-medium">
                            {t(
                              value === 'replaceConnection'
                                ? 'Connect a different folder'
                                : 'The same folder has moved'
                            )}
                          </span>
                          <span className="text-xs leading-relaxed text-muted-foreground">
                            {t(
                              value === 'replaceConnection'
                                ? 'New media is connected independently. Existing clips keep their original sources.'
                                : 'Restore existing source paths in all connected projects. Closed projects are repaired when opened. File contents must match.'
                            )}
                          </span>
                        </span>
                      </label>
                    ))}
                  </fieldset>
                )}
                {failure && (
                  <p role="alert" className="break-words text-xs text-warning">
                    {t(failure)}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" isDisabled={disabled || !path.trim() || !name.trim()}>
                    <Check />
                    {t('Save')}
                  </Button>
                  <Button isDisabled={disabled} onPress={() => setPanel(null)}>
                    <X />
                    {t('Cancel')}
                  </Button>
                </div>
              </form>
            ) : (
              <div className="mt-3 rounded-xl bg-foreground/5 p-3">
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {t(
                    'Delete this connection? Source files, CapCut media folders and timeline clips will be kept.'
                  )}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    isDisabled={disabled}
                    onPress={() =>
                      void edit({ type: 'deleteConnection', sourceId: source.id, ...scope }).then(
                        (ok) => {
                          if (ok) setPanel(null)
                        }
                      )
                    }
                  >
                    <Trash2 />
                    {t('Delete connection')}
                  </Button>
                  <Button isDisabled={disabled} onPress={() => setPanel(null)}>
                    {t('Cancel')}
                  </Button>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
