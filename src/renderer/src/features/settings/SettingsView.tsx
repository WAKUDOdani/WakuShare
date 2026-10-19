import { toast } from '@/lib/notifications'
import { t, useLanguage } from '@/lib/i18n'
import type { JSX, ReactNode } from 'react'
import { FolderOpen, RefreshCw, RotateCcw } from 'lucide-react'
import { Button, Label, ListBox, Select, Switch } from '@heroui/react'
import type { AppSettings, UpdateStatus } from '@shared/types'
import { BRAND } from '@shared/branding'
import type { UpdatesController } from '@/hooks/use-updates'
import { errorMessage, unwrap } from '@/lib/ipc'

const THEME_OPTIONS: { value: AppSettings['theme']; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' }
]

interface SettingsViewProps {
  settings: AppSettings | null
  onChange: (update: Partial<AppSettings>) => void
  updates: UpdatesController
}

/** Status line shown under the version row. */
function updateHelp(status: UpdateStatus, version: string): string {
  switch (status.state) {
    case 'checking':
      return 'Checking for updates…'
    case 'available':
      return `Downloading update ${status.version}…`
    case 'downloading':
      return `Downloading update… ${status.percent}%`
    case 'downloaded':
      return `Update ${status.version} ready — restart to install`
    case 'not-available':
      return `WakuShare ${version} · up to date`
    case 'error':
    case 'manual':
      return status.message
    default:
      return version ? `WakuShare ${version}` : 'WakuShare'
  }
}

export function SettingsView({ settings, onChange, updates }: SettingsViewProps): JSX.Element {
  useLanguage()

  if (!settings) return <div />

  const pickFolder = async (
    title: string,
    key: 'draftRootOverride' | 'defaultExportDir'
  ): Promise<void> => {
    try {
      const folder = unwrap(await window.capshare.pickFolder(title))
      if (folder) onChange({ [key]: folder })
    } catch (error) {
      toast.danger(t(errorMessage(error)))
    }
  }

  return (
    <div className="relative h-full">
      <div className="flex h-full flex-col gap-7 overflow-y-auto px-4 pt-2 pb-8">
        <SettingsGroup title={t('Locations')}>
          <SettingRow
            label={t('CapCut project folder')}
            help={settings.draftRootOverride ?? t('Detected automatically')}
          >
            <div className="flex gap-1.5">
              {settings.draftRootOverride && (
                <Button
                  variant="ghost"
                  isIconOnly
                  className="rounded-full"
                  aria-label={t('Reset to automatic detection')}
                  onPress={() => onChange({ draftRootOverride: null })}
                >
                  <RotateCcw className="size-4" />
                </Button>
              )}
              <Button
                variant="secondary"
                className="rounded-full border border-input"
                onPress={() =>
                  void pickFolder(t('Choose the com.lveditor.draft folder'), 'draftRootOverride')
                }
              >
                <FolderOpen className="size-4" /> {t('Choose…')}{' '}
              </Button>
            </div>
          </SettingRow>

          <SettingRow
            label={t('Default export location')}
            help={settings.defaultExportDir ?? t('Downloads')}
          >
            <div className="flex gap-1.5">
              {settings.defaultExportDir && (
                <Button
                  variant="ghost"
                  isIconOnly
                  className="rounded-full"
                  aria-label={t('Reset export location')}
                  onPress={() => onChange({ defaultExportDir: null })}
                >
                  <RotateCcw className="size-4" />
                </Button>
              )}
              <Button
                variant="secondary"
                className="rounded-full border border-input"
                onPress={() => void pickFolder(t('Choose export folder'), 'defaultExportDir')}
              >
                <FolderOpen className="size-4" /> {t('Choose…')}{' '}
              </Button>
            </div>
          </SettingRow>
        </SettingsGroup>

        <SettingsGroup title={t('Sharing')}>
          <SettingRow
            label={t('Include AI caches by default')}
            help={t('Larger .capshare files; skips re-analysis after import')}
          >
            <Switch
              aria-label={t('Include AI caches by default')}
              isSelected={settings.includeCachesByDefault}
              onChange={(checked) => onChange({ includeCachesByDefault: checked })}
            >
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
            </Switch>
          </SettingRow>
        </SettingsGroup>

        <SettingsGroup title={t('Appearance')}>
          <SettingRow
            label={t('Interface language')}
            help={t('Changes apply immediately and are saved for next time.')}
          >
            <Select
              aria-label={t('Interface language')}
              className="w-36"
              value={settings.language}
              onChange={(language) => onChange({ language: language as AppSettings['language'] })}
            >
              <Select.Trigger className="rounded-full">
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  <ListBox.Item id="en" textValue="EN · English">
                    EN · English
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                  <ListBox.Item id="ru" textValue="RU · Русский">
                    RU · Русский
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                </ListBox>
              </Select.Popover>
            </Select>
          </SettingRow>
          <SettingRow label={t('Theme')} help={t('Liquid glass follows your system by default')}>
            <Select
              aria-label={t('Theme')}
              className="w-32"
              value={settings.theme}
              onChange={(theme) => onChange({ theme: theme as AppSettings['theme'] })}
            >
              <Select.Trigger className="rounded-full">
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  {THEME_OPTIONS.map(({ value, label }) => (
                    <ListBox.Item key={value} id={value} textValue={t(label)}>
                      {t(label)}
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>
          </SettingRow>
        </SettingsGroup>

        <SettingsGroup title={t('About')}>
          <SettingRow
            label="WakuShare by WAKUDO Dani"
            help={t('Free tool. Updates and feedback in Telegram.')}
          >
            <a
              href={BRAND.telegram}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-sky-500 hover:underline"
            >
              Telegram ↗
            </a>
          </SettingRow>
          <SettingRow
            label={t('Based on CapShare')}
            help={t('Original development: Ilyasse Salama · MIT license')}
          >
            <a
              href={BRAND.upstream}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-sky-500 hover:underline"
            >
              {t('Original project ↗')}
            </a>
          </SettingRow>
          <SettingRow label={t('Source code and releases')} help="WAKUDOdani/WakuShare · GitHub">
            <a
              href={BRAND.repository}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-sky-500 hover:underline"
            >
              GitHub ↗
            </a>
          </SettingRow>
          <SettingRow
            label={t(`Version ${updates.version || '…'}`)}
            help={t(updateHelp(updates.status, updates.version))}
          >
            {updates.status.state === 'downloaded' ? (
              <Button className="rounded-full" onPress={updates.install}>
                <RotateCcw className="size-4" /> {t('Restart to update')}{' '}
              </Button>
            ) : (
              <Button
                variant="secondary"
                className="rounded-full border border-input"
                isDisabled={updates.busy}
                onPress={updates.check}
              >
                <RefreshCw className={`size-4 ${updates.busy ? 'animate-spin' : ''}`} />
                {t('Check for updates')}{' '}
              </Button>
            )}
          </SettingRow>
        </SettingsGroup>
      </div>
    </div>
  )
}

function SettingsGroup({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  useLanguage()

  return (
    <section className="flex flex-col gap-2">
      <h2 className="px-1 text-[15px] font-semibold tracking-tight">{title}</h2>
      <div className="glass-subtle divide-y divide-border/50 rounded-2xl px-4">{children}</div>
    </section>
  )
}

function SettingRow({
  label,
  help,
  children
}: {
  label: string
  help: string
  children: JSX.Element
}): JSX.Element {
  useLanguage()

  return (
    <div className="flex items-center justify-between gap-6 py-3.5">
      <div className="min-w-0">
        <Label className="text-[13px] font-medium">{label}</Label>
        <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground" title={help}>
          {help}
        </p>
      </div>
      <div className="flex shrink-0 items-center">{children}</div>
    </div>
  )
}
