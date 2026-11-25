import { A } from '@solidjs/router';
import { type JSX, Show } from 'solid-js';
import styles from './NavBar.module.css';

export interface NavBarBack {
  href: string;
  /** The previous screen's title. */
  label: string;
}

export interface NavBarProps {
  title: string;
  /** A "‹ Label" back button on the left. */
  back?: NavBarBack;
  /** Anything else on the left (e.g. Cancel on a compose screen); used when there's no `back`. */
  leading?: JSX.Element;
  /** Buttons on the right: NavButton. */
  trailing?: JSX.Element;
}

/** iOS-style nav bar: back (or leading) on the left, title centered, actions on the right. */
function NavBar(props: NavBarProps) {
  return (
    <header class={styles.navBar}>
      <div class={styles.side}>
        <Show when={props.back} fallback={props.leading}>
          {(back) => (
            <A href={back().href} class={styles.back}>
              <svg class={styles.chevron} viewBox="0 0 12 21" aria-hidden="true">
                <path d="M10.5 1.5 1.5 10.5l9 9" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
              <span class={styles.backLabel}>{back().label}</span>
            </A>
          )}
        </Show>
      </div>
      <h1 class={styles.title}>{props.title}</h1>
      <div class={`${styles.side} ${styles.sideRight}`}>{props.trailing}</div>
    </header>
  );
}

export default NavBar;
