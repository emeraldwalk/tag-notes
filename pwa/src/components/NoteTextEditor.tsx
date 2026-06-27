import { createMemo, createSignal, For, Show } from 'solid-js';
import { parseNoteText, parseTags, serializeNote } from '../lib/notes/parse';
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
 * Dedicated title/body/tags inputs that serialize to the same single
 * rawText note format under the hood, used by both the Home route (create
 * mode) and NoteEditor route (edit mode).
 */
function NoteTextEditor(props: NoteTextEditorProps) {
  const initial = parseNoteText(props.initialText);

  const [title, setTitle] = createSignal(initial.title);
  const [body, setBody] = createSignal(initial.body);
  const [tagsText, setTagsText] = createSignal(initial.tags.join(', '));
  const [saving, setSaving] = createSignal(false);
  const [justSaved, setJustSaved] = createSignal(false);

  const tags = createMemo(() => parseTags(tagsText()));

  const canSave = createMemo(() => title().trim() !== '' && !saving());

  const handleSave = async () => {
    if (!canSave()) return;

    setSaving(true);
    setJustSaved(false);
    try {
      await props.onSave(serializeNote(title(), body(), tags()));
      setTitle('');
      setBody('');
      setTagsText('');
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
      <input
        type="text"
        class={styles.titleInput}
        value={title()}
        onInput={(event) => {
          setTitle(event.currentTarget.value);
          setJustSaved(false);
        }}
        placeholder="Title"
        aria-label="Note title"
      />

      <textarea
        class={styles.bodyTextarea}
        value={body()}
        onInput={(event) => {
          setBody(event.currentTarget.value);
          setJustSaved(false);
        }}
        placeholder="Body text..."
        aria-label="Note body"
      />

      <input
        type="text"
        class={styles.tagsInput}
        value={tagsText()}
        onInput={(event) => {
          setTagsText(event.currentTarget.value);
          setJustSaved(false);
        }}
        placeholder="tag1, tag2"
        aria-label="Note tags"
      />

      <Show when={tags().length > 0}>
        <div class={styles.tags}>
          <For each={tags()}>{(tag) => <span class={styles.tag}>{tag}</span>}</For>
        </div>
      </Show>

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
