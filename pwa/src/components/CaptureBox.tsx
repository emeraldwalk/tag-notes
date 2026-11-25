import { createSignal } from 'solid-js';
import { errorMessage } from '../lib/api';
import Button from './Button';
import Message from './Message';
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
        aria-label="New inbox entry"
        rows={2}
        value={text()}
        onInput={(event) => setText(event.currentTarget.value)}
      />
      <Button type="submit" disabled={saving() || text().trim() === ''}>
        {saving() ? 'Saving…' : 'Save'}
      </Button>
      <div class={styles.message}>
        <Message kind="error" text={error()} />
      </div>
    </form>
  );
}

export default CaptureBox;
