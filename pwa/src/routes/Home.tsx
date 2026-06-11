import NoteTextEditor from '../components/NoteTextEditor';
import { noteStore } from '../lib/notes/store-instance';

function Home() {
  const handleSave = async (rawText: string) => {
    await noteStore.create(rawText);
  };

  return <NoteTextEditor initialText="" onSave={handleSave} />;
}

export default Home;
