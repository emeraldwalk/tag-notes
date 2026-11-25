import { A, useLocation } from '@solidjs/router'
import { For, type JSX, onCleanup, onMount, Show } from 'solid-js'
import { inboxCount, refreshInboxCount } from '../lib/inbox/count'
import styles from './BottomNav.module.css'

interface Tab {
  href: string
  label: string
  icon: () => JSX.Element
  badge?: () => number
}

const TABS: Tab[] = [
  {
    href: '/inbox',
    label: 'Inbox',
    badge: inboxCount,
    icon: () => (
      <>
        <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
        <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
      </>
    ),
  },
  {
    href: '/notes',
    label: 'Notes',
    icon: () => (
      <>
        <line x1="8" y1="6" x2="20" y2="6" />
        <line x1="8" y1="12" x2="20" y2="12" />
        <line x1="8" y1="18" x2="20" y2="18" />
        <line x1="3" y1="6" x2="3.01" y2="6" />
        <line x1="3" y1="12" x2="3.01" y2="12" />
        <line x1="3" y1="18" x2="3.01" y2="18" />
      </>
    ),
  },
  {
    href: '/food',
    label: 'Food',
    icon: () => (
      <>
        <path d="M18 8c0 4.4-2.7 8-6 8s-6-3.6-6-8a6 6 0 1 1 12 0Z" />
        <path d="M12 2v4" />
      </>
    ),
  },
  {
    href: '/meds',
    label: 'Meds',
    icon: () => (
      <>
        <path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z" />
        <path d="m8.5 8.5 7 7" />
      </>
    ),
  },
  {
    href: '/settings',
    label: 'Settings',
    icon: () => (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </>
    ),
  },
]

/** The tab bar. A tab is active on its root and every screen pushed under it; tapping it goes back to its root. */
function BottomNav() {
  const location = useLocation()

  const isActive = (href: string) => location.pathname === href || location.pathname.startsWith(`${href}/`)

  // The Inbox count: on start, and whenever the app comes back to the foreground (Siri may have added entries).
  const onVisible = () => {
    if (document.visibilityState === 'visible') void refreshInboxCount()
  }
  onMount(() => {
    void refreshInboxCount()
    document.addEventListener('visibilitychange', onVisible)
  })
  onCleanup(() => document.removeEventListener('visibilitychange', onVisible))

  return (
    <nav class={styles.nav}>
      <For each={TABS}>
        {(tab) => (
          <A
            href={tab.href}
            class={styles.link}
            classList={{ [styles.active]: isActive(tab.href) }}
            aria-current={isActive(tab.href) ? 'page' : undefined}
          >
            <span class={styles.iconWrap}>
              <svg
                class={styles.icon}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                {tab.icon()}
              </svg>
              <Show when={(tab.badge?.() ?? 0) > 0}>
                <span class={styles.badge} aria-label={`${tab.badge!()} new`}>
                  {tab.badge!() > 99 ? '99+' : tab.badge!()}
                </span>
              </Show>
            </span>
            <span class={styles.label}>{tab.label}</span>
          </A>
        )}
      </For>
    </nav>
  )
}

export default BottomNav
