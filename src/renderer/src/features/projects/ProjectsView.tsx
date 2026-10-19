import { toast } from '@/lib/notifications'
import { t, useLanguage } from '@/lib/i18n'
import { useRef, useState, type JSX, type Key } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence } from 'motion/react'
import { AlertTriangle, FileDown, FolderSearch, Pencil, Trash2 } from 'lucide-react'
import { AlertDialog, Button, Dropdown, Label, Skeleton } from '@heroui/react'
import type { DraftSummary, ProjectsResponse } from '@shared/types'
import { closeButtonClass, cn } from '@/lib/utils'
import { kinematicScale } from '@/lib/dialog-anim'
import { errorMessage, unwrap } from '@/lib/ipc'
import { EditProjectDialog, type EditProjectSaved } from './EditProjectDialog'
import { ProjectCard } from './ProjectCard'
import { ProjectDetail } from './ProjectDetail'

interface ProjectsViewProps {
  projects: ProjectsResponse | null
  loading: boolean
  onRefresh: () => void
  onPickDraftRoot: () => void
}

export function ProjectsView({
  projects,
  loading,
  onRefresh,
  onPickDraftRoot
}: ProjectsViewProps): JSX.Element {
  useLanguage()

  const [selected, setSelected] = useState<DraftSummary | null>(null)
  // `selected` survives close so the dialog can animate out with its content.
  const [detailOpen, setDetailOpen] = useState(false)

  const [menuOpen, setMenuOpen] = useState(false)
  const [menuTarget, setMenuTarget] = useState<DraftSummary | null>(null)
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 })
  const anchorRef = useRef<HTMLSpanElement>(null)

  const [deleteTarget, setDeleteTarget] = useState<DraftSummary | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const [editTarget, setEditTarget] = useState<DraftSummary | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const trashName = t(window.capshare.env.platform === 'win32' ? 'Recycle Bin' : 'Trash')

  const openDetail = (project: DraftSummary): void => {
    setSelected(project)
    setDetailOpen(true)
  }

  const openContextMenu = (project: DraftSummary, x: number, y: number): void => {
    setMenuTarget(project)
    setMenuPos({ x, y })
    setMenuOpen(true)
  }

  const onMenuAction = (key: Key): void => {
    const target = menuTarget
    setMenuOpen(false)
    if (!target) return
    if (key === 'export') {
      openDetail(target)
    } else if (key === 'edit') {
      setEditTarget(target)
      setEditOpen(true)
    } else if (key === 'delete') {
      setDeleteTarget(target)
      setDeleteOpen(true)
    }
  }

  const onEditSaved = (updated: EditProjectSaved): void => {
    setEditOpen(false)
    toast.success(t(`Updated “${updated.name}”`))
    if (editTarget && selected?.folderPath === editTarget.folderPath) {
      // The detail dialog renders the `selected` snapshot, which onRefresh
      // does not touch — patch it so an open/animating detail stays fresh.
      setSelected({
        ...selected,
        name: updated.name,
        folderPath: updated.folderPath,
        coverDataUrl: updated.coverDataUrl ?? selected.coverDataUrl
      })
    }
    onRefresh()
  }

  const confirmDelete = async (): Promise<void> => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      unwrap(
        await window.capshare.deleteProject({
          folderPath: deleteTarget.folderPath,
          draftId: deleteTarget.draftId
        })
      )
      toast.success(t(`Moved “${deleteTarget.name}” to ${trashName}`))
      if (selected?.folderPath === deleteTarget.folderPath) setDetailOpen(false)
      setDeleteOpen(false)
      onRefresh()
    } catch (error) {
      toast.danger(t(errorMessage(error)))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="relative h-full">
      <div className="h-full overflow-y-auto px-4 pt-21 pb-6">
        {loading && !projects ? (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="overflow-hidden rounded-2xl">
                <Skeleton className="aspect-video w-full" />
                <div className="space-y-2 p-3.5">
                  <Skeleton className="h-3.5 w-2/3" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : !projects?.found ? (
          <EmptyState
            title={t('CapCut not found')}
            body={t(
              "WakuShare couldn't locate a CapCut project folder on this machine. If CapCut is installed with a custom project location, point WakuShare at it."
            )}
            action={
              <Button onPress={onPickDraftRoot} className="rounded-full">
                <FolderSearch className="size-4" /> {t('Choose project folder…')}{' '}
              </Button>
            }
          />
        ) : projects.drafts.length === 0 ? (
          <EmptyState
            title={t('No projects yet')}
            body={t(
              'Projects you create in CapCut will appear here, ready to export as .capshare files.'
            )}
          />
        ) : (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-4">
            <AnimatePresence mode="popLayout">
              {projects.drafts.map((project, index) => (
                <ProjectCard
                  key={project.draftId + project.folderPath}
                  project={project}
                  index={index}
                  onOpen={openDetail}
                  onContextMenu={openContextMenu}
                />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      <ProjectDetail project={selected} open={detailOpen} onClose={() => setDetailOpen(false)} />

      {/* Cursor anchor for the shared right-click menu. Portaled to <body> so its
          `fixed` position is relative to the viewport — ancestors here (motion's
          filter, the glass backdrop-filter) create a containing block that would
          otherwise offset it from the actual cursor. */}
      {createPortal(
        <span
          ref={anchorRef}
          aria-hidden
          style={{
            position: 'fixed',
            left: menuPos.x,
            top: menuPos.y,
            width: 0,
            height: 0,
            pointerEvents: 'none'
          }}
        />,
        document.body
      )}
      <Dropdown
        isOpen={menuOpen}
        onOpenChange={(open) => {
          setMenuOpen(open)
          if (!open) setMenuTarget(null)
        }}
      >
        {/* Hidden trigger: MenuTrigger needs one; its position is overridden by triggerRef. */}
        <Button aria-label={t('Project actions')} excludeFromTabOrder className="sr-only" />
        <Dropdown.Popover
          triggerRef={anchorRef}
          placement="bottom start"
          offset={4}
          className="min-w-44"
        >
          <Dropdown.Menu aria-label={t('Project actions')} onAction={onMenuAction}>
            <Dropdown.Item id="edit" textValue={t('Edit project')}>
              <Pencil className="size-4 shrink-0 text-muted-foreground" />
              <Label>{t('Edit project…')}</Label>
            </Dropdown.Item>
            <Dropdown.Item id="export" textValue={t('Export')}>
              <FileDown className="size-4 shrink-0 text-muted-foreground" />
              <Label>{t('Export…')}</Label>
            </Dropdown.Item>
            <Dropdown.Item id="delete" textValue={t('Delete')} variant="danger">
              <Trash2 className="size-4 shrink-0 text-[color:var(--danger)]" />
              <Label>{t('Delete')}</Label>
            </Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>

      <EditProjectDialog
        project={editTarget}
        open={editOpen}
        onOpenChange={setEditOpen}
        onSaved={onEditSaved}
      />

      <AlertDialog.Backdrop
        isOpen={deleteOpen}
        onOpenChange={(open) => {
          if (deleting) return // block dismissal while a delete is in flight
          setDeleteOpen(open)
          // Keep `deleteTarget` set so its name stays visible through the close
          // animation (it's overwritten next open) — mirrors how `selected` works.
        }}
        variant="blur"
        isDismissable={!deleting}
        isKeyboardDismissDisabled={deleting}
        className={cn(
          kinematicScale.backdrop,
          'bg-linear-to-t from-red-950/90 via-red-950/50 to-transparent dark:from-red-950/95 dark:via-red-950/60'
        )}
      >
        <AlertDialog.Container placement="center" size="sm" className={kinematicScale.container}>
          <AlertDialog.Dialog className="app-no-drag glass-strong rounded-3xl border-none">
            <AlertDialog.CloseTrigger
              aria-label={t('Close')}
              isDisabled={deleting}
              className={cn('top-3 right-3', closeButtonClass)}
            />
            <AlertDialog.Header className="items-center text-center">
              <AlertDialog.Icon status="danger">
                <AlertTriangle className="size-5" />
              </AlertDialog.Icon>
              <AlertDialog.Heading>
                {t('Move “{0}” to {1}?', [deleteTarget?.name, trashName])}
              </AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              {t(
                'This removes the project from your CapCut library and moves its folder to the {0}, where you can still restore it.',
                [trashName]
              )}
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button
                variant="danger"
                className="w-full rounded-full"
                isPending={deleting}
                onPress={() => void confirmDelete()}
              >
                {t('Move to {0}', [trashName])}
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </div>
  )
}

function EmptyState({
  title,
  body,
  action
}: {
  title: string
  body: string
  action?: JSX.Element
}): JSX.Element {
  useLanguage()

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <div className="glass-subtle flex size-16 items-center justify-center rounded-3xl">
        <FolderSearch className="size-7 text-muted-foreground" strokeWidth={1.6} />
      </div>
      <div className="text-[15px] font-semibold">{title}</div>
      <p className="max-w-sm text-[12.5px] leading-relaxed text-muted-foreground">{body}</p>
      {action}
    </div>
  )
}
