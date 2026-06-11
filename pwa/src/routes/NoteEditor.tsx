import { A, useNavigate, useParams } from '@solidjs/router';
import { createSignal, onMount, Show } from 'solid-js';
import NoteTextEditor from '../components/NoteTextEditor';
import { noteStore } from '../lib/notes/store-instance';
import type { Note } from '../lib/notes/types';
import styles from './NoteEditor.module.css';

function NoteEditor() {
  const params = useParams();
  const navigate = useNavigate();
  const id = () => params.id ?? '';

  const [note, setNote] = createSignal<Note | undefined>();
  const [loading, setLoading] = createSignal(true);

  onMount(async () => {
    setNote(await noteStore.get(id()));
    setLoading(false);
  });

  const handleSave = async (rawText: string) => {
    await noteStore.update(id(), rawText);
    navigate('/notes');
  };

  const handleDelete = async () => {
    if (!window.confirm('Delete this note?')) return;
    await noteStore.remove(id());
    navigate('/notes');
  };

  return (
    <Show when={!loading()} fallback={<div />}>
      <Show
        when={note()}
        fallback={
          <div class={styles.notFound}>
            <p>Note not found</p>
            <A href="/notes" class={styles.backLink}>
              Back to list
            </A>
          </div>
        }
      >
        {(currentNote) => (
          <NoteTextEditor
            initialText={currentNote().rawText}
            onSave={handleSave}
            onDelete={handleDelete}
            saveLabel="Save Changes"
          />
        )}
      </Show>
    </Show>
  );
}

export default NoteEditor;
