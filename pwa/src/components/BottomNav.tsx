import { A, useLocation } from '@solidjs/router'
import styles from './BottomNav.module.css'

function BottomNav() {
  const location = useLocation()

  const isListActive = () => location.pathname.startsWith('/notes')

  return (
    <nav class={styles.nav}>
      <A
        href="/"
        class={styles.link}
        classList={{ [styles.active]: location.pathname === '/' }}
        end
      >
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
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        <span>New</span>
      </A>
      <A
        href="/notes"
        class={styles.link}
        classList={{ [styles.active]: isListActive() }}
      >
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
          <line x1="8" y1="6" x2="20" y2="6" />
          <line x1="8" y1="12" x2="20" y2="12" />
          <line x1="8" y1="18" x2="20" y2="18" />
          <line x1="3" y1="6" x2="3.01" y2="6" />
          <line x1="3" y1="12" x2="3.01" y2="12" />
          <line x1="3" y1="18" x2="3.01" y2="18" />
        </svg>
        <span>Notes</span>
      </A>
    </nav>
  )
}

export default BottomNav
