import styles from './SearchField.module.css';

export interface SearchFieldProps {
  value: string;
  onInput: (value: string) => void;
  placeholder?: string;
  label: string;
}

/** An iOS search bar: gray, rounded, with a magnifying glass. */
function SearchField(props: SearchFieldProps) {
  return (
    <label class={styles.field}>
      <svg class={styles.icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true">
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m20 20-4.8-4.8" />
      </svg>
      <input
        type="search"
        class={styles.input}
        placeholder={props.placeholder ?? 'Search'}
        aria-label={props.label}
        value={props.value}
        onInput={(event) => props.onInput(event.currentTarget.value)}
      />
    </label>
  );
}

export default SearchField;
