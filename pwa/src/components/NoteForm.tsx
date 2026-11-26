import { useBeforeLeave, useNavigate } from '@solidjs/router';
import { createMemo, createSignal, For, Show } from 'solid-js';
import { errorMessage } from '../lib/api';
import { parseNoteText, parseTags, serializeNote } from '../lib/notes/parse';
import Button from './Button';
import Field from './Field';
import Message from './Message';
import type { NavBarBack } from './NavBar';
import NavButton from './NavButton';
import Page from './Page';
import styles from './NoteForm.module.css';

export interface NoteFormProps {
  title: string;
  /** "" for a new note, note.rawText for editing. */
  initialText: string;
  /** Where Save, Cancel and Delete go afterwards. */
  doneHref: string;
  /** Editing: a back button. New: a Cancel button instead. */
  back?: NavBarBack;
  onSave: (rawText: string) => Promise<void>;
  /** Editing only: deletes the note (after the form has asked). */
  onDelete?: () => Promise<void>;
}

/**
 * A note's screen: title, body and tags, serialized to the single rawText note format. Save is in the nav bar;
 * leaving with unsaved changes (back, Cancel, another tab, swipe back) asks first.
 */
function NoteForm(props: NoteFormProps) {
  const navigate = useNavigate();
  const initial = parseNoteText(props.initialText);
  const initialSerialized = serializeNote(initial.title, initial.body, initial.tags);

  const [title, setTitle] = createSignal(initial.title);
  const [body, setBody] = createSignal(initial.body);
  const [tagsText, setTagsText] = createSignal(initial.tags.join(', '));
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | undefined>();
  let done = false;

  const tags = createMemo(() => parseTags(tagsText()));
  const dirty = createMemo(() => serializeNote(title(), body(), tags()) !== initialSerialized);
  const canSave = () => title().trim() !== '' && !busy();

  useBeforeLeave((event) => {
    if (done || !dirty()) return;
    if (!window.confirm('Discard your changes to this note?')) event.preventDefault();
  });

  /** Runs a save or delete; on success leaves for `doneHref`, on failure keeps everything for another try. */
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await action();
      done = true;
      navigate(props.doneHref);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const handleSave = () => {
    if (!canSave()) return;
    void run(() => props.onSave(serializeNote(title(), body(), tags())));
  };

  const handleDelete = () => {
    const remove = props.onDelete;
    if (!remove || !window.confirm('Delete this note?')) return;
    void run(remove);
  };

  return (
    <Page
      fill
      title={props.title}
      back={props.back}
      leading={<NavButton href={props.doneHref}>Cancel</NavButton>}
      trailing={
        <NavButton primary disabled={!canSave()} onClick={handleSave}>
          {busy() ? 'Saving…' : 'Save'}
        </NavButton>
      }
    >
      <input
        type="text"
        class={styles.title}
        value={title()}
        onInput={(event) => setTitle(event.currentTarget.value)}
        placeholder="Title"
        aria-label="Title"
        enterkeyhint="next"
      />

      <textarea
        class={styles.body}
        value={body()}
        onInput={(event) => setBody(event.currentTarget.value)}
        placeholder="Note"
        aria-label="Body"
      />

      <Field label="Tags, separated by commas">
        <input
          type="text"
          value={tagsText()}
          onInput={(event) => setTagsText(event.currentTarget.value)}
          placeholder="e.g. meds, sleep"
          autocapitalize="none"
          enterkeyhint="done"
        />
      </Field>

      <Show when={tags().length > 0}>
        <div class={styles.tags}>
          <For each={tags()}>{(tag) => <span class={styles.tag}>{tag}</span>}</For>
        </div>
      </Show>

      <Message kind="error" text={error()} />

      <Show when={props.onDelete}>
        <Button variant="destructive" disabled={busy()} onClick={handleDelete}>
          Delete Note
        </Button>
      </Show>
    </Page>
  );
}

export default NoteForm;
