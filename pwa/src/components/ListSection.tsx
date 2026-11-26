import { type JSX, Show } from 'solid-js';
import styles from './ListSection.module.css';

export interface ListSectionProps {
  /** Header above the card: small caps (settings), or bold with `prominent`. */
  title?: JSX.Element;
  /** A content list's date group (Today, Yesterday, …): a bold header, like Notes and Reminders. */
  prominent?: boolean;
  /** Gray explanatory text under the card. */
  footer?: JSX.Element;
  /** The card holds a form or text (padded) rather than rows (each row pads itself; hairlines between them). */
  padded?: boolean;
  children?: JSX.Element;
}

/** An iOS inset grouped section: header, a rounded card of rows, footer. */
function ListSection(props: ListSectionProps) {
  return (
    <section class={styles.section}>
      <Show when={props.title}>
        <h2 class={styles.header} classList={{ [styles.prominent]: props.prominent }}>
          {props.title}
        </h2>
      </Show>
      <div class={styles.card} classList={{ [styles.padded]: props.padded }}>
        {props.children}
      </div>
      <Show when={props.footer}>
        <div class={styles.footer}>{props.footer}</div>
      </Show>
    </section>
  );
}

export default ListSection;
