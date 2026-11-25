import type { JSX } from 'solid-js';
import styles from './EmptyState.module.css';

/** Centered gray text for a list with nothing in it. */
function EmptyState(props: { children: JSX.Element }) {
  return <p class={styles.empty}>{props.children}</p>;
}

export default EmptyState;
