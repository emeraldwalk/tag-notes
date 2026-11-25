import { A } from '@solidjs/router';
import { type JSX, Show } from 'solid-js';
import styles from './NavButton.module.css';

export interface NavButtonProps {
  /** A link to another screen; otherwise a button that calls `onClick`. */
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  /** The screen's main action (Save, Done): bold. */
  primary?: boolean;
  /** Needed when the content is an icon. */
  label?: string;
  children: JSX.Element;
}

/** A text or icon button for the nav bar, with a full-size tap target. */
function NavButton(props: NavButtonProps) {
  const classes = () => ({ [styles.button]: true, [styles.primary]: Boolean(props.primary) });
  return (
    <Show
      when={props.href}
      fallback={
        <button type="button" classList={classes()} disabled={props.disabled} aria-label={props.label} onClick={() => props.onClick?.()}>
          {props.children}
        </button>
      }
    >
      {(href) => (
        <A href={href()} classList={classes()} aria-label={props.label}>
          {props.children}
        </A>
      )}
    </Show>
  );
}

export default NavButton;
