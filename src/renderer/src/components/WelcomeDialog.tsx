import { useRef, useState, type JSX } from 'react'
import { ArrowUpRight, Send } from 'lucide-react'
import { Button, Checkbox, Modal } from '@heroui/react'
import type { AppSettings } from '@shared/types'
import { BRAND } from '@shared/branding'
import logo from '@/assets/logo.png'
import { t, useLanguage } from '@/lib/i18n'
import { kinematicScale } from '@/lib/dialog-anim'
import { errorMessage, unwrap } from '@/lib/ipc'
import { toast } from '@/lib/notifications'
import { closeButtonClass, cn } from '@/lib/utils'
import { BrandWordmark } from './BrandWordmark'

interface WelcomeDialogProps {
  settings: AppSettings | null
  version: string
  onSaved: (settings: AppSettings) => void
}

/** The opt-out lives in the normal settings file, outside versioned app binaries. */
export function WelcomeDialog({ settings, version, onSaved }: WelcomeDialogProps): JSX.Element {
  useLanguage()
  const [neverShow, setNeverShow] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const open = Boolean(settings && version && !dismissed && !settings.welcomeHidden)

  const dismiss = async (): Promise<void> => {
    if (!open || savingRef.current) return
    savingRef.current = true
    setSaving(true)
    try {
      const next = unwrap(
        await window.capshare.setSettings({
          welcomeSeenVersion: version,
          ...(neverShow ? { welcomeHidden: true } : {})
        })
      )
      onSaved(next)
      setDismissed(true)
    } catch (error) {
      toast.danger(t('Could not save your choice'), { description: t(errorMessage(error)) })
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  return (
    <Modal.Backdrop
      isOpen={open}
      onOpenChange={(next) => !next && void dismiss()}
      variant="blur"
      className={kinematicScale.backdrop}
      isDismissable={!saving}
      isKeyboardDismissDisabled={saving}
    >
      <Modal.Container placement="center" size="lg" className={kinematicScale.container}>
        <Modal.Dialog
          aria-label={t('Welcome to WakuShare')}
          className="app-no-drag glass-strong welcome-dialog w-full max-w-[480px] rounded-3xl p-7"
        >
          <Modal.CloseTrigger
            aria-label={t('Close')}
            isDisabled={saving}
            className={cn('top-4 right-4', closeButtonClass)}
          />
          <Modal.Header className="gap-6">
            <div className="flex items-center gap-3 pr-8">
              <img src={logo} alt="" draggable={false} className="size-10 shrink-0" />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="text-[22px] leading-tight">
                  <BrandWordmark />
                </div>
                <p className="text-xs text-muted-foreground">
                  {t('Made for your CapCut workflow')}
                </p>
              </div>
              <span className="glass-subtle shrink-0 rounded-full px-2.5 py-1 text-xs text-muted-foreground">
                {`v${version}`}
              </span>
            </div>
          </Modal.Header>
          <Modal.Body>
            <div className="glass-subtle welcome-community rounded-2xl p-4">
              <Modal.Heading className="mb-2 flex items-center gap-2 text-[15px] font-semibold">
                <Send className="size-4 text-violet-600 dark:text-violet-300" strokeWidth={1.7} />
                <span>{t("Let's stay in touch")}</span>
              </Modal.Heading>
              <p className="text-sm leading-relaxed text-foreground/80">
                {t(
                  "I share WakuShare updates, presets and editing finds on Telegram. Come say hi, I'd love to see you there!"
                )}
              </p>
            </div>
          </Modal.Body>
          <Modal.Footer className="flex-col items-stretch gap-3">
            <Button
              className="welcome-telegram h-11 w-full rounded-2xl text-sm font-semibold text-white"
              isDisabled={saving}
              onPress={() => {
                if (savingRef.current) return
                window.open(BRAND.telegram, '_blank', 'noopener,noreferrer')
                void dismiss()
              }}
            >
              <span aria-hidden="true" className="welcome-telegram__shine" />
              <span className="welcome-telegram__label">
                <Send className="size-4" />
                {t('Visit my Telegram')}
                <ArrowUpRight className="size-4" />
              </span>
            </Button>
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <Button
                variant="ghost"
                className="h-8 rounded-full px-3 font-medium text-foreground/75"
                isPending={saving}
                onPress={() => void dismiss()}
              >
                {t('Continue')}
              </Button>
              <Checkbox
                className="gap-1.5"
                aria-label={t("Don't show again")}
                isSelected={neverShow}
                onChange={setNeverShow}
                isDisabled={saving}
              >
                <Checkbox.Control>
                  <Checkbox.Indicator />
                </Checkbox.Control>
                <span className="text-xs text-muted-foreground">{t("Don't show again")}</span>
              </Checkbox>
            </div>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}
