import { type JSX, splitProps } from 'solid-js';
import styles from './Button.module.css';

export type ButtonVariant = 'filled' | 'tinted' | 'gray' | 'destructive' | 'plain';

export interface ButtonProps extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
  /** filled: the main action; tinted/gray: secondary; destructive: delete; plain: text only. */
  variant?: ButtonVariant;
  /** Compact, for actions inside a row. */
  small?: boolean;
}

/** The app's buttons, in iOS's styles. */
function Button(props: ButtonProps) {
  const [local, rest] = splitProps(props, ['variant', 'small', 'class', 'type']);
  return (
    <button
      type={local.type ?? 'button'}
      {...rest}
      class={`${styles.button} ${styles[local.variant ?? 'filled']} ${local.small ? styles.small : ''} ${local.class ?? ''}`}
    />
  );
}

export default Button;
