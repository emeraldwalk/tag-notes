import { A } from '@solidjs/router';
import { type JSX, Show } from 'solid-js';
import styles from './ListRow.module.css';

export interface ListRowProps {
  title: JSX.Element;
  /** Gray line(s) under the title. */
  subtitle?: JSX.Element;
  /** Gray text at the top right: a time or date, like Mail and Notes. */
  detail?: JSX.Element;
  /** Pushes a screen. */
  href?: string;
  /** Opens a sheet (or anything else that isn't a screen). */
  onClick?: () => void;
}

/** A row of a content list (notes, doses, food): title, subtitle, and a time at the top right. Tappable. */
function ListRow(props: ListRowProps) {
  const content = () => (
    <>
      <span class={styles.title}>{props.title}</span>
      <Show when={props.detail}>
        <span class={styles.detail}>{props.detail}</span>
      </Show>
      <Show when={props.subtitle}>
        <span class={styles.subtitle}>{props.subtitle}</span>
      </Show>
    </>
  );
  return (
    <Show
      when={props.href}
      fallback={
        <button type="button" class={styles.row} onClick={() => props.onClick?.()}>
          {content()}
        </button>
      }
    >
      {(href) => (
        <A href={href()} class={styles.row}>
          {content()}
        </A>
      )}
    </Show>
  );
}

export default ListRow;
