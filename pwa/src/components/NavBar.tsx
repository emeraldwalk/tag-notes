import { A } from '@solidjs/router';
import { Show } from 'solid-js';
import styles from './NavBar.module.css';

export interface NavBarAction {
  label: string;
  href: string;
}

export interface NavBarProps {
  title: string;
  /** Shows a "‹ {backLabel}" link on the left, navigating to this href. */
  backHref?: string;
  backLabel?: string;
  /** Shows a link on the right, e.g. to push into a section's secondary screen. */
  action?: NavBarAction;
}

/** iOS-style nav bar: back button on the left, title centered, action on the right. */
function NavBar(props: NavBarProps) {
  return (
    <div class={styles.navBar}>
      <div class={styles.side}>
        <Show when={props.backHref}>
          <A href={props.backHref!} class={styles.backButton}>
            ‹ {props.backLabel ?? 'Back'}
          </A>
        </Show>
      </div>
      <div class={styles.title}>{props.title}</div>
      <div class={`${styles.side} ${styles.sideRight}`}>
        <Show when={props.action}>
          <A href={props.action!.href} class={styles.actionButton}>
            {props.action!.label}
          </A>
        </Show>
      </div>
    </div>
  );
}

export default NavBar;
