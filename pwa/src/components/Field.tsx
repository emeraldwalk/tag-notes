import type { JSX } from 'solid-js';
import styles from './Field.module.css';

export interface FieldProps {
  label: string;
  /** The input, select or textarea. */
  children: JSX.Element;
}

/** A form control with its label always visible above it (not just a placeholder that disappears once typed in). */
function Field(props: FieldProps) {
  return (
    <label class={styles.field}>
      <span class={styles.label}>{props.label}</span>
      {props.children}
    </label>
  );
}

export default Field;
