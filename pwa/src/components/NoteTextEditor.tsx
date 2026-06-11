import { createMemo, createSignal, Show } from 'solid-js';
import { parseNoteText } from '../lib/notes/parse';
import styles from './NoteTextEditor.module.css';

export interface NoteTextEditorProps {
  /** "" for new notes, note.rawText for editing. */
  initialText: string;
  onSave: (rawText: string) => Promise<void>;
  /** Present only in edit mode (plan 5). */
  onDelete?: () => Promise<void>;
  /** e.g. "Save" vs "Save Changes" — optional. */
  saveLabel?: string;
}

/**
 * Shared textarea + parsed title/tag preview + save action, used by both the
 * Home route (create mode) and NoteEditor route (edit mode).
 */
function NoteTextEditor(props: NoteTextEditorProps) {
  const [text, setText] = createSignal(props.initialText);
  const [saving, setSaving] = createSignal(false);
  const [justSaved, setJustSaved] = createSignal(false);

  const parsed = createMemo(() => parseNoteText(text()));

  const canSave = createMemo(() => parsed().title.trim() !== '' && !saving());

  const handleSave = async () => {
    if (!canSave()) return;

    setSaving(true);
    setJustSaved(false);
    try {
      await props.onSave(text());
      setText('');
      setJustSaved(true);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!props.onDelete) return;
    await props.onDelete();
  };

  return (
    <div class={styles.editor}>
      <textarea
        class={styles.textarea}
        value={text()}
        onInput={(event) => {
          setText(event.currentTarget.value);
          setJustSaved(false);
        }}
        placeholder="Title&#10;&#10;Body text...&#10;&#10;:tag1, tag2"
        aria-label="Note text"
      />

      <div class={styles.preview}>
        <Show
          when={parsed().title.trim() !== ''}
          fallback={<div class={`${styles.title} ${styles.titlePlaceholder}`}>Untitled</div>}
        >
          <div class={styles.title}>{parsed().title}</div>
        </Show>

        <Show
          when={parsed().tags.length > 0}
          fallback={<div class={styles.noTags}>no tags</div>}
        >
          <div class={styles.tags}>
            {parsed().tags.map((tag) => (
              <span class={styles.tag}>{tag}</span>
            ))}
          </div>
        </Show>
      </div>

      <Show when={justSaved()}>
        <div class={styles.savedMessage}>Saved</div>
      </Show>

      <div class={styles.actions}>
        <button
          type="button"
          class={styles.saveButton}
          disabled={!canSave()}
          onClick={() => void handleSave()}
        >
          {props.saveLabel ?? 'Save'}
        </button>

        <Show when={props.onDelete}>
          <button type="button" class={styles.deleteButton} onClick={() => void handleDelete()}>
            Delete
          </button>
        </Show>
      </div>
    </div>
  );
}

export default NoteTextEditor;
