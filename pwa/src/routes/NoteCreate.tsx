import NavBar from '../components/NavBar';
import NoteTextEditor from '../components/NoteTextEditor';
import { noteStore } from '../lib/notes/store-instance';
import styles from './NoteCreate.module.css';

function NoteCreate() {
  const handleSave = async (rawText: string) => {
    await noteStore.create(rawText);
  };

  return (
    <div class={styles.page}>
      <NavBar title="New Note" action={{ label: 'History', href: '/notes/history' }} />
      <NoteTextEditor initialText="" onSave={handleSave} />
    </div>
  );
}

export default NoteCreate;
