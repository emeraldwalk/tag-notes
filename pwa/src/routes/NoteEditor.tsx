import { A, useNavigate, useParams } from '@solidjs/router';
import { createSignal, onMount, Show } from 'solid-js';
import NavBar from '../components/NavBar';
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
    navigate('/notes/history');
  };

  const handleDelete = async () => {
    if (!window.confirm('Delete this note?')) return;
    await noteStore.remove(id());
    navigate('/notes/history');
  };

  return (
    <div class={styles.page}>
      <NavBar title="Edit Note" backHref="/notes/history" backLabel="All Notes" />
      <Show when={!loading()} fallback={<div />}>
        <Show
          when={note()}
          fallback={
            <div class={styles.notFound}>
              <p>Note not found</p>
              <A href="/notes/history" class={styles.backLink}>
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
    </div>
  );
}

export default NoteEditor;
