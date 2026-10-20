import { toast } from '@/lib/notifications'
import { Notifications } from '@/components/Notifications'
import { WelcomeDialog } from '@/components/WelcomeDialog'
import { t, useLanguage, setLanguage } from '@/lib/i18n'
import { useCallback, useEffect, useState, type JSX } from 'react'
import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import { I18nProvider } from 'react-aria-components'
import type { AppSettings, ProjectsResponse } from '@shared/types'
import { Sidebar, type View } from '@/components/Sidebar'
import { Wallpaper } from '@/components/glass/Wallpaper'
import { ProgressiveBlur } from '@/components/glass/ProgressiveBlur'
import { ImportView } from '@/features/import/ImportView'
import { ProjectsView } from '@/features/projects/ProjectsView'
import { SettingsView } from '@/features/settings/SettingsView'
import { PresetsView } from '@/features/presets/PresetsView'
import { ExplorerView } from '@/features/explorer/ExplorerView'
import { useUpdates } from '@/hooks/use-updates'
import { errorMessage, unwrap } from '@/lib/ipc'
import { isExplorerPreview } from '@shared/build'

const HEADERS: Record<View, { title: string; subtitle: string }> = {
  projects: { title: 'Projects', subtitle: 'CapCut library' },
  import: { title: 'Import', subtitle: "Bring a .wakushare project into this machine's CapCut" },
  presets: { title: 'Presets', subtitle: 'Back up and transfer your composition presets' },
  explorer: { title: 'Explorer', subtitle: 'Windows folders in your CapCut media library' },
  settings: { title: 'Settings', subtitle: '' }
}
function useTheme(theme: AppSettings['theme'] | undefined): void {
  useEffect(() => {
    const root = document.documentElement
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = (): void => {
      const dark = theme === 'dark' || ((theme ?? 'system') === 'system' && media.matches)
      root.classList.toggle('dark', dark)
    }
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [theme])
}

function App(): JSX.Element {
  const language = useLanguage()

  const [view, setView] = useState<View>(isExplorerPreview() ? 'explorer' : 'projects')
  const [presetsBusy, setPresetsBusy] = useState(false)
  const [projects, setProjects] = useState<ProjectsResponse | null>(null)
  const [loadingProjects, setLoadingProjects] = useState(true)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [externalFile, setExternalFile] = useState<string | null>(null)
  const updates = useUpdates()

  useTheme(settings?.theme)
  useEffect(() => {
    if (settings) setLanguage(settings.language)
  }, [settings])

  // Silent refreshes (window focus) swap data in place: no spinner, no toasts —
  // otherwise every alt-tab back would flash the loading state and re-toast warnings.
  const refreshProjects = useCallback(async (options?: { silent?: boolean }): Promise<void> => {
    if (!options?.silent) setLoadingProjects(true)
    try {
      const response = unwrap(await window.capshare.listProjects())
      setProjects(response)
      if (!options?.silent) for (const warning of response.warnings) toast.warning(t(warning))
    } catch (error) {
      if (!options?.silent) toast.danger(t(errorMessage(error)))
    } finally {
      if (!options?.silent) setLoadingProjects(false)
    }
  }, [])

  const updateSettings = useCallback(
    async (update: Partial<AppSettings>): Promise<void> => {
      try {
        const next = unwrap(await window.capshare.setSettings(update))
        setSettings(next)
        if ('draftRootOverride' in update) void refreshProjects()
      } catch (error) {
        toast.danger(t(errorMessage(error)))
      }
    },
    [refreshProjects]
  )

  useEffect(() => {
    let disposed = false
    const boot = async (): Promise<void> => {
      try {
        const loaded = unwrap(await window.capshare.getSettings())
        if (!disposed) setSettings(loaded)
      } catch {}
      await refreshProjects()
      const pending = await window.capshare.rendererReady()
      if (pending && !disposed) {
        setView('import')
        setExternalFile(pending)
      }
    }
    void boot()

    const unsubscribe = window.capshare.onOpenFile((filePath) => {
      setView('import')
      setExternalFile(filePath)
    })
    return () => {
      disposed = true
      unsubscribe()
    }
  }, [refreshProjects])

  useEffect(() => {
    const onFocus = (): void => void refreshProjects({ silent: true })
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refreshProjects])

  const pickDraftRoot = useCallback(async (): Promise<void> => {
    try {
      const folder = unwrap(
        await window.capshare.pickFolder('Choose the com.lveditor.draft folder')
      )
      if (folder) await updateSettings({ draftRootOverride: folder })
    } catch (error) {
      toast.danger(t(errorMessage(error)))
    }
  }, [updateSettings])

  return (
    <I18nProvider locale={language === 'ru' ? 'ru-RU' : 'en-US'}>
      <MotionConfig reducedMotion="user">
        <Wallpaper />
        <div className="flex h-full">
          <Sidebar
            view={view}
            onNavigate={setView}
            disabled={presetsBusy}
            version={updates.version}
          />
          {/* No overflow clip: the ProgressiveBlur reaches left under the sidebar
            (-left-56) so the band has no seam at the main edge. The blur and
            header are persistent chrome — kept outside AnimatePresence so they
            don't fade on view switch; only the scrollable body animates. */}
          <main className="relative min-w-0 flex-1">
            <ProgressiveBlur
              position="top"
              className={`-left-56 right-0 z-10 ${view === 'settings' ? 'h-16' : 'h-24'}`}
            />
            <header className="app-drag absolute inset-x-0 top-0 z-20 px-4 pt-5 pb-3">
              <h1 className="text-xl font-bold tracking-tight">{t(HEADERS[view].title)}</h1>
              {view !== 'settings' && (
                <p className="text-[12px] font-medium text-foreground/75">
                  {view === 'projects' && projects?.found
                    ? t('CapCut projects: {0}', [projects.drafts.length])
                    : t(HEADERS[view].subtitle)}
                </p>
              )}
            </header>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={view}
                className={view === 'settings' ? 'h-full pt-16' : 'h-full'}
                initial={{ opacity: 0, y: 8, scale: 0.995, filter: 'blur(10px)' }}
                animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
                exit={{ opacity: 0, y: -6, scale: 0.995, filter: 'blur(8px)' }}
                transition={{ type: 'spring', stiffness: 650, damping: 42, mass: 0.8 }}
              >
                {view === 'projects' && (
                  <ProjectsView
                    projects={projects}
                    loading={loadingProjects}
                    onRefresh={() => void refreshProjects()}
                    onPickDraftRoot={() => void pickDraftRoot()}
                  />
                )}
                {view === 'import' && (
                  <ImportView
                    externalFile={externalFile}
                    onExternalFileConsumed={() => setExternalFile(null)}
                    onImported={() => void refreshProjects()}
                  />
                )}
                {view === 'settings' && (
                  <SettingsView
                    settings={settings}
                    onChange={(u) => void updateSettings(u)}
                    updates={updates}
                  />
                )}
                {view === 'presets' && <PresetsView onBusyChange={setPresetsBusy} />}
                {view === 'explorer' && <ExplorerView />}
              </motion.div>
            </AnimatePresence>
          </main>
        </div>
        <WelcomeDialog settings={settings} version={updates.version} onSaved={setSettings} />
        <Notifications />
      </MotionConfig>
    </I18nProvider>
  )
}

export default App
