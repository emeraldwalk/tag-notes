import NoteForm from '../components/NoteForm';
import { noteStore } from '../lib/notes/store-instance';

/** New note, pushed from the Notes list's compose button. */
function NoteCreate() {
  return (
    <NoteForm
      title="New Note"
      initialText=""
      doneHref="/notes"
      onSave={async (rawText) => {
        await noteStore.create(rawText);
      }}
    />
  );
}

export default NoteCreate;
