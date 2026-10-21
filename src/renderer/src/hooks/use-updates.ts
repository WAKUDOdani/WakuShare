import { toast } from '@/lib/notifications'
import { t, useLanguage } from '@/lib/i18n'
import { useEffect, useRef, useState } from 'react'
import type { UpdateStatus } from '@shared/types'

export interface UpdatesController {
  /** Live update lifecycle, streamed from the main process. */
  status: UpdateStatus
  /** The running app version, e.g. "1.0.0" (empty until loaded). */
  version: string
  /** True only when started by the Windows portable launcher. */
  portable: boolean
  /** Whether a check/download is in flight (used to disable the button). */
  busy: boolean
  /** Trigger a manual update check. */
  check: () => void
  /** Quit and install a downloaded update. */
  install: () => void
}

/**
 * Subscribes to the main-process auto-updater and surfaces a one-time toast
 * (with a Restart action) once a build is downloaded — so the prompt appears
 * regardless of which view the user is on. The Settings → About row renders the
 * full status from the same controller.
 */
export function useUpdates(): UpdatesController {
  useLanguage()
  const [status, setStatus] = useState<UpdateStatus>({ state: 'idle' })
  const [version, setVersion] = useState('')
  const [portable, setPortable] = useState(false)
  const notifiedFor = useRef<string | null>(null)

  useEffect(() => {
    void window.capshare.getAppVersion().then(setVersion)
    void window.capshare.isPortable().then(setPortable)
    void window.capshare.getUpdateStatus().then(setStatus)
    return window.capshare.onUpdateStatus(setStatus)
  }, [])

  useEffect(() => {
    if (status.state !== 'downloaded' || notifiedFor.current === status.version) return
    notifiedFor.current = status.version
    toast.success(t(`Update ${status.version} ready`), {
      description: t('Restart WakuShare to install it.'),
      timeout: 0,
      actionProps: { children: t('Restart'), onPress: () => void window.capshare.installUpdate() }
    })
  }, [status])

  return {
    status,
    version,
    portable,
    busy: status.state === 'checking' || status.state === 'downloading',
    check: () => void window.capshare.checkForUpdates(),
    install: () => void window.capshare.installUpdate()
  }
}
