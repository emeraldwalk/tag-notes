import { createSignal, onMount, Show } from 'solid-js';
import {
  buildExportFile,
  exportFileName,
  InvalidExportFileError,
  parseExportFile,
} from '../lib/notes/export';
import { noteStore } from '../lib/notes/store-instance';
import styles from './Settings.module.css';

interface Status {
  kind: 'success' | 'error';
  message: string;
}

function Settings() {
  const [noteCount, setNoteCount] = createSignal(0);
  const [status, setStatus] = createSignal<Status | undefined>();
  let fileInput: HTMLInputElement | undefined;

  const refreshCount = async () => {
    setNoteCount((await noteStore.list()).length);
  };

  onMount(() => {
    void refreshCount();
  });

  const handleExport = async () => {
    const notes = await noteStore.list();
    const file = buildExportFile(notes);
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = exportFileName();
    link.click();
    URL.revokeObjectURL(url);

    setStatus({ kind: 'success', message: `Exported ${notes.length} note(s).` });
  };

  const handleFileChange = async (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    try {
      const notes = parseExportFile(await file.text());
      await noteStore.importAll(notes);
      await refreshCount();
      setStatus({ kind: 'success', message: `Imported ${notes.length} note(s).` });
    } catch (err) {
      const message = err instanceof InvalidExportFileError ? err.message : 'Import failed.';
      setStatus({ kind: 'error', message });
    } finally {
      input.value = '';
    }
  };

  return (
    <div class={styles.container}>
      <h1 class={styles.heading}>Settings</h1>

      <section class={styles.section}>
        <h2 class={styles.sectionTitle}>Data</h2>
        <p class={styles.noteCount}>
          {noteCount()} note{noteCount() === 1 ? '' : 's'} stored
        </p>

        <div class={styles.actions}>
          <button type="button" class={styles.actionButton} onClick={() => void handleExport()}>
            Export Notes
          </button>
          <button type="button" class={styles.actionButton} onClick={() => fileInput?.click()}>
            Import Notes
          </button>
        </div>

        <input
          ref={fileInput}
          type="file"
          accept="application/json"
          class={styles.hiddenInput}
          onChange={(event) => void handleFileChange(event)}
        />

        <Show when={status()}>
          {(currentStatus) => (
            <p
              classList={{
                [styles.success]: currentStatus().kind === 'success',
                [styles.error]: currentStatus().kind === 'error',
              }}
            >
              {currentStatus().message}
            </p>
          )}
        </Show>

        <p class={styles.hint}>
          Importing merges with existing notes: notes whose id matches an
          existing note replace it, others are added.
        </p>
      </section>
    </div>
  );
}

export default Settings;
