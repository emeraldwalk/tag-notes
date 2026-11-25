import { Show } from 'solid-js';
import styles from './Message.module.css';

export interface MessageProps {
  kind: 'error' | 'success';
  /** Nothing is shown while empty. */
  text?: string;
}

/** A one-line status under a form or at the top of a screen: red for errors (announced), green for success. */
function Message(props: MessageProps) {
  return (
    <Show when={props.text}>
      <p class={styles.message} classList={{ [styles.error]: props.kind === 'error' }} role={props.kind === 'error' ? 'alert' : 'status'}>
        {props.text}
      </p>
    </Show>
  );
}

export default Message;
