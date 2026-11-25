import { useParams, useSearchParams } from '@solidjs/router';
import { createResource, Show } from 'solid-js';
import EmptyState from '../components/EmptyState';
import NavBar from '../components/NavBar';
import NoteForm from '../components/NoteForm';
import Page from '../components/Page';
import { errorMessage } from '../lib/api';
import { noteStore } from '../lib/notes/store-instance';

/** One note. Opened from the Notes list, or from the Inbox (`?from=inbox`), which back then returns to. */
function NoteEditor() {
  const params = useParams();
  const [search] = useSearchParams();
  const id = () => params.id ?? '';
  const back = () => (search.from === 'inbox' ? { href: '/inbox', label: 'Inbox' } : { href: '/notes', label: 'Notes' });

  const [note] = createResource(id, (noteId) => noteStore.get(noteId));

  return (
    <Show
      when={note.state === 'ready' && note()}
      fallback={
        <Page nav={<NavBar title="Note" back={back()} />}>
          <Show when={!note.loading}>
            <EmptyState>{note.error ? errorMessage(note.error) : 'This note no longer exists.'}</EmptyState>
          </Show>
        </Page>
      }
    >
      {(current) => (
        <NoteForm
          title="Note"
          initialText={current().rawText}
          back={back()}
          doneHref={back().href}
          onSave={async (rawText) => {
            await noteStore.update(id(), rawText);
          }}
          onDelete={() => noteStore.remove(id())}
        />
      )}
    </Show>
  );
}

export default NoteEditor;
