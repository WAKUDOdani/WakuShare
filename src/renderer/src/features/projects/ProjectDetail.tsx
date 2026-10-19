import { toast } from '@/lib/notifications'
import { t, useLanguage } from '@/lib/i18n'
import { useState, type JSX } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { CheckCircle2, Clapperboard, FileDown, FolderOpen, TriangleAlert, X } from 'lucide-react'
import { Button, Label, Modal, ProgressBar, Switch } from '@heroui/react'
import type { DraftSummary, ExportResult } from '@shared/types'
import { MiniTimeline } from '@/components/MiniTimeline'
import { StatChip } from '@/components/StatChip'
import { useTaskProgress } from '@/hooks/use-task-progress'
import { kinematicScale } from '@/lib/dialog-anim'
import { formatBytes, formatDuration, newTaskId } from '@/lib/format'
import { errorMessage, unwrap } from '@/lib/ipc'
import { spring } from '@/lib/motion'
import { closeButtonClass, cn } from '@/lib/utils'

type ExportPhase =
  | { state: 'idle' }
  | { state: 'running'; taskId: string; ratio: number }
  | { state: 'done'; result: ExportResult }

interface ProjectDetailProps {
  project: DraftSummary | null
  /** Visibility is controlled separately from `project` so the project stays
      mounted while the dialog plays its close animation. */
  open: boolean
  onClose: () => void
}

export function ProjectDetail({ project, open, onClose }: ProjectDetailProps): JSX.Element {
  useLanguage()

  return (
    // Keying by project resets all export state when another project opens.
    <DetailDialog
      key={project?.folderPath ?? 'none'}
      project={project}
      open={open}
      onClose={onClose}
    />
  )
}

function DetailDialog({ project, open, onClose }: ProjectDetailProps): JSX.Element {
  useLanguage()

  const [includeCaches, setIncludeCaches] = useState(true)
  const [phase, setPhase] = useState<ExportPhase>({ state: 'idle' })

  useTaskProgress(setPhase)

  const startExport = async (): Promise<void> => {
    if (!project) return
    try {
      const destination = unwrap(await window.capshare.pickExportDestination(project.name))
      if (!destination) return
      const taskId = newTaskId()
      setPhase({ state: 'running', taskId, ratio: 0 })
      const result = unwrap(
        await window.capshare.runExport({
          taskId,
          folderPath: project.folderPath,
          destinationPath: destination,
          includeCaches
        })
      )
      setPhase({ state: 'done', result })
      for (const warning of result.warnings) toast.warning(t(warning))
      if (result.warnings.length === 0) toast.success(t(`Exported "${project.name}"`))
      else toast.warning(t(`Exported with warnings: "${project.name}"`), { timeout: 12000 })
    } catch (error) {
      setPhase({ state: 'idle' })
      toast.danger(t(errorMessage(error)))
    }
  }

  const cancelExport = (): void => {
    if (phase.state === 'running') {
      void window.capshare.cancelTask(phase.taskId)
      setPhase({ state: 'idle' })
    }
  }

  const reveal = (path: string): void => {
    void window.capshare.revealPath(path)
  }

  const exporting = phase.state === 'running'

  return (
    <Modal.Backdrop
      isOpen={open && project !== null}
      onOpenChange={(nextOpen) => !nextOpen && !exporting && onClose()}
      variant="blur"
      className={kinematicScale.backdrop}
      isDismissable={!exporting}
      isKeyboardDismissDisabled={exporting}
    >
      <Modal.Container placement="center" size="lg" className={kinematicScale.container}>
        <Modal.Dialog
          aria-label={project?.name ?? t('Project details')}
          className="app-no-drag w-full max-w-lg gap-0 overflow-hidden rounded-3xl border border-border bg-background p-0 shadow-2xl"
        >
          {project && (
            <>
              <div className="relative h-56 w-full overflow-hidden bg-foreground/4">
                {project.coverDataUrl ? (
                  <img src={project.coverDataUrl} alt="" className="size-full object-cover" />
                ) : (
                  <div className="flex size-full items-center justify-center text-muted-foreground/40">
                    <Clapperboard className="size-14" strokeWidth={1.2} />
                  </div>
                )}
                <div className="absolute inset-x-0 bottom-0 h-24 bg-linear-to-t from-black/60 to-transparent" />
                <h2 className="absolute bottom-3 left-5 text-xl font-bold text-white drop-shadow">
                  {project.name}
                </h2>
                <Button
                  variant="ghost"
                  isIconOnly
                  onPress={() => !exporting && onClose()}
                  aria-label={t('Close')}
                  className={cn('absolute top-3 right-3', closeButtonClass)}
                >
                  <X className="size-4" />
                </Button>
              </div>

              <div className="flex flex-col gap-5 p-5">
                <div className="flex flex-wrap gap-2">
                  <StatChip label={t('Duration')} value={formatDuration(project.durationUs)} />
                  {project.canvas && (
                    <StatChip
                      label={t('Canvas')}
                      value={`${project.canvas.width}×${project.canvas.height}`}
                    />
                  )}
                  {project.fps && (
                    <StatChip label={t('FPS')} value={String(Math.round(project.fps))} />
                  )}
                  <StatChip
                    label={t('Media')}
                    value={String(
                      project.mediaCounts.video +
                        project.mediaCounts.audio +
                        project.mediaCounts.image
                    )}
                  />
                  <StatChip label={t('Size')} value={formatBytes(project.sizeBytes)} />
                  {project.capcutVersion && (
                    <StatChip label="CapCut" value={project.capcutVersion} />
                  )}
                </div>

                <MiniTimeline tracks={project.tracks} durationUs={project.durationUs} />

                <AnimatePresence mode="wait" initial={false}>
                  {phase.state === 'done' ? (
                    <motion.div
                      key="done"
                      initial={{ opacity: 0, y: 10, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -6 }}
                      transition={spring}
                      className="glass-subtle flex flex-col gap-3 rounded-2xl p-4"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <motion.span
                            initial={{ scale: 0.4, rotate: -30 }}
                            animate={{ scale: 1, rotate: 0 }}
                            transition={{
                              type: 'spring',
                              stiffness: 380,
                              damping: 18,
                              delay: 0.08
                            }}
                          >
                            {phase.result.warnings.length > 0 ? (
                              <TriangleAlert className="size-5 text-amber-500" />
                            ) : (
                              <CheckCircle2 className="size-5 text-emerald-500" />
                            )}
                          </motion.span>
                          <div>
                            <div className="text-[13px] font-semibold">
                              {phase.result.warnings.length > 0
                                ? t('Exported with warnings')
                                : t('Export complete')}
                            </div>
                            <div className="text-[11.5px] text-muted-foreground">
                              {t('{0} · {1} files', [
                                formatBytes(phase.result.sizeBytes),
                                phase.result.fileCount
                              ])}
                            </div>
                          </div>
                        </div>
                        <Button
                          variant="secondary"
                          className="rounded-full"
                          onPress={() => reveal(phase.result.capsharePath)}
                        >
                          <FolderOpen className="size-4" /> {t('Reveal file')}{' '}
                        </Button>
                      </div>
                      {phase.result.warnings.length > 0 && (
                        <div
                          role="status"
                          className="text-[12px] text-amber-600 dark:text-amber-400"
                        >
                          <p>{t('Review these issues before relying on this backup:')}</p>
                          <ul className="mt-2 max-h-40 list-disc space-y-1 overflow-y-auto pl-4 break-words">
                            {phase.result.warnings.map((warning, index) => (
                              <li key={index}>{t(warning)}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </motion.div>
                  ) : exporting ? (
                    <motion.div
                      key="running"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      transition={spring}
                      className="glass-subtle flex flex-col gap-3 rounded-2xl p-4"
                    >
                      <div className="flex items-center justify-between text-[12.5px]">
                        <span className="font-medium">{t('Exporting…')}</span>
                        <span className="text-muted-foreground tabular-nums">
                          {Math.round(phase.ratio * 100)}%
                        </span>
                      </div>
                      <ProgressBar
                        value={phase.ratio * 100}
                        aria-label={t('Export progress')}
                        className="w-full"
                      >
                        <ProgressBar.Track className="h-1.5">
                          <ProgressBar.Fill />
                        </ProgressBar.Track>
                      </ProgressBar>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="self-end rounded-full text-muted-foreground"
                        onPress={cancelExport}
                      >
                        {t('Cancel')}
                      </Button>
                    </motion.div>
                  ) : (
                    <motion.div
                      key="idle"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      transition={spring}
                      className="flex flex-col gap-4"
                    >
                      <div className="glass-subtle rounded-2xl px-4">
                        <div className="flex items-center justify-between gap-6 py-3.5">
                          <div className="min-w-0">
                            <Label className="text-[13px] font-medium">
                              {t('Include AI caches')}
                            </Label>
                            <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                              {includeCaches
                                ? t('Includes saved AI analysis and project caches')
                                : t('Smaller archive; AI analysis may need to run again')}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center">
                            <Switch
                              aria-label={t('Include AI caches')}
                              isSelected={includeCaches}
                              onChange={setIncludeCaches}
                            >
                              <Switch.Control>
                                <Switch.Thumb />
                              </Switch.Control>
                            </Switch>
                          </div>
                        </div>
                      </div>
                      <Button onPress={() => void startExport()} className="mt-2 w-full rounded-xl">
                        <FileDown className="size-4" /> {t('Export .capshare')}{' '}
                      </Button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </>
          )}
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}
