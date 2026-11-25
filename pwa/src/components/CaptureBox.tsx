import { createSignal, Show } from 'solid-js';
import { errorMessage } from '../lib/api';
import styles from './CaptureBox.module.css';

export interface CaptureBoxProps {
  /** Saves the text; throws to keep it in the box and show why. */
  onSave: (text: string) => Promise<void>;
}

/** The Inbox's "say or type anything" box: saves the text word for word as a raw entry. */
function CaptureBox(props: CaptureBoxProps) {
  const [text, setText] = createSignal('');
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string | undefined>();

  const handleSubmit = async (event: Event) => {
    event.preventDefault();
    const value = text().trim();
    if (!value || saving()) return;
    setSaving(true);
    setError(undefined);
    try {
      await props.onSave(value);
      setText('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form class={styles.form} onSubmit={(event) => void handleSubmit(event)}>
      <textarea
        class={styles.textarea}
        placeholder="Say or type anything"
        rows={2}
        value={text()}
        onInput={(event) => setText(event.currentTarget.value)}
      />
      <button type="submit" class={styles.save} disabled={saving() || text().trim() === ''}>
        {saving() ? 'Saving…' : 'Save'}
      </button>
      <Show when={error()}>
        {(message) => (
          <p class={styles.error} role="alert">
            {message()}
          </p>
        )}
      </Show>
    </form>
  );
}

export default CaptureBox;
