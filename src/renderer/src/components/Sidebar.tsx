import { t, useLanguage } from '@/lib/i18n'
import type { JSX } from 'react'
import { useLayoutEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { cn } from '@/lib/utils'
import { isMacLike } from '@/lib/format'
import { ArrowUpRight, Clapperboard, CloudDownload, FolderOpen, Send, Settings } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import logo from '@/assets/logo.png'
import { isLocalPreview } from '@shared/build'
import { BRAND } from '@shared/branding'
import { BrandWordmark } from './BrandWordmark'

export type View = 'projects' | 'import' | 'presets' | 'explorer' | 'settings'

const NAV: { view: View; label: string; icon: LucideIcon }[] = [
  { view: 'projects', label: 'Projects', icon: Clapperboard },
  { view: 'import', label: 'Import', icon: CloudDownload },
  { view: 'presets', label: 'Presets', icon: Clapperboard },
  { view: 'explorer', label: 'Explorer', icon: FolderOpen },
  { view: 'settings', label: 'Settings', icon: Settings }
]

interface SidebarProps {
  view: View
  onNavigate: (view: View) => void
  disabled?: boolean
  version?: string
  portable?: boolean
}

interface NavItemProps {
  item: (typeof NAV)[number]
  active: boolean
  onSelect: () => void
  disabled?: boolean
}

/** Selection stays still; every fresh hover or keyboard focus animates the icon. */
function NavItem({
  item: { view: targetView, label, icon: Icon },
  active,
  onSelect,
  disabled
}: NavItemProps): JSX.Element {
  useLanguage()

  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const interacting = !disabled && (hovered || focused)

  return (
    <motion.button
      disabled={disabled}
      type="button"
      aria-current={active ? 'page' : undefined}
      data-view={targetView}
      data-hovered={interacting || undefined}
      data-focus-visible={focused || undefined}
      onClick={onSelect}
      onPointerEnter={(event) => {
        if (event.pointerType !== 'touch') setHovered(true)
      }}
      onPointerLeave={() => setHovered(false)}
      onFocus={(event) => setFocused(event.currentTarget.matches(':focus-visible'))}
      onBlur={() => setFocused(false)}
      className={cn(
        'sidebar-nav-item relative flex items-center gap-3 rounded-xl px-3 py-2 text-left text-[13px] font-medium',
        active ? 'text-foreground' : 'text-muted-foreground'
      )}
    >
      <Icon className="sidebar-nav-item__icon relative z-10" size={16} aria-hidden="true" />
      <span className="relative z-10">{t(label)}</span>
    </motion.button>
  )
}

/** Floating Tahoe-style glass sidebar (navigation layer). */
export function Sidebar({
  view,
  onNavigate,
  disabled,
  version,
  portable
}: SidebarProps): JSX.Element {
  useLanguage()
  const navRef = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    const nav = navRef.current
    const selected = nav?.querySelector<HTMLElement>(`[data-view="${view}"]`)
    if (!nav || !selected) return
    const position = (): void => {
      nav.style.setProperty('--nav-selection-y', `${selected.offsetTop}px`)
      nav.style.setProperty('--nav-selection-height', `${selected.offsetHeight}px`)
    }
    position()
    const observer = new ResizeObserver(position)
    observer.observe(nav)
    observer.observe(selected)
    return () => observer.disconnect()
  }, [view])

  return (
    <aside className="app-drag relative z-20 flex w-56 shrink-0 p-2">
      <div
        className={cn(
          'glass rounded-window-concentric flex w-full flex-col gap-1 overflow-hidden px-3 pb-4',
          // Leave room for traffic lights on mac; title strip handles windows.
          isMacLike ? 'pt-12' : 'pt-4'
        )}
      >
        <div className="mb-4 flex items-center gap-2.5 px-2 pb-1">
          <img src={logo} alt="" draggable={false} className="size-8 shrink-0" />
          <div className="min-w-0 text-left text-[21px] leading-tight font-semibold tracking-tight">
            <BrandWordmark />
            {version && (
              <span
                className="mt-1 block text-[11px] leading-4 font-medium tracking-wide text-muted-foreground"
                data-app-version
              >
                {`v${version}${portable ? ' · Portable' : ''}`}
              </span>
            )}
            {isLocalPreview() && (
              <span className="block text-[10px] text-muted-foreground">{t('Local preview')}</span>
            )}
          </div>
        </div>

        <nav ref={navRef} className="app-no-drag relative flex flex-col gap-1">
          <span className="sidebar-nav-item__selection" aria-hidden="true" />
          {NAV.map((item) => (
            <NavItem
              key={item.view}
              item={item}
              active={view === item.view}
              onSelect={() => onNavigate(item.view)}
              disabled={disabled}
            />
          ))}
        </nav>

        <div className="mt-auto pt-6">
          <a
            href={BRAND.telegram}
            target="_blank"
            rel="noopener noreferrer"
            draggable={false}
            className="app-no-drag sidebar-telegram"
            onPointerMove={(event) => {
              if (event.pointerType === 'touch') return
              const card = event.currentTarget
              const bounds = card.getBoundingClientRect()
              card.style.setProperty('--telegram-x', `${event.clientX - bounds.left}px`)
              card.style.setProperty('--telegram-y', `${event.clientY - bounds.top}px`)
            }}
            onPointerLeave={(event) => {
              event.currentTarget.style.removeProperty('--telegram-x')
              event.currentTarget.style.removeProperty('--telegram-y')
            }}
          >
            <span className="sidebar-telegram__reflection" aria-hidden="true" />
            <span className="sidebar-telegram__icon" aria-hidden="true">
              <Send size={17} strokeWidth={1.6} />
            </span>
            <span className="sidebar-telegram__copy">
              <span className="sidebar-telegram__title">
                Telegram
                <ArrowUpRight size={12} aria-hidden="true" />
              </span>
              <span className="sidebar-telegram__description">
                {t('Presets and editing finds')}
              </span>
            </span>
          </a>
        </div>
      </div>
    </aside>
  )
}
