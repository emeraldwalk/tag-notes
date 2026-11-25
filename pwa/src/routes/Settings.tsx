import { createSignal, onMount, Show } from 'solid-js';
import {
  buildExportFile,
  exportFileName,
  InvalidExportFileError,
  parseExportFile,
} from '../lib/export';
import { foodStore } from '../lib/foods/store-instance';
import { getFoodTargets, setFoodTargets } from '../lib/foods/targets';
import { noteStore } from '../lib/notes/store-instance';
import { refreshAppCache } from '../lib/refreshAppCache';
import styles from './Settings.module.css';

interface Status {
  kind: 'success' | 'error';
  message: string;
}

function Settings() {
  const [noteCount, setNoteCount] = createSignal(0);
  const [foodCount, setFoodCount] = createSignal(0);
  const [status, setStatus] = createSignal<Status | undefined>();
  const [refreshing, setRefreshing] = createSignal(false);
  const initialTargets = getFoodTargets();
  const [proteinTarget, setProteinTarget] = createSignal(String(initialTargets.protein));
  const [calorieTarget, setCalorieTarget] = createSignal(String(initialTargets.calories));
  let fileInput: HTMLInputElement | undefined;

  const refreshCount = async () => {
    const [notes, foods] = await Promise.all([noteStore.list(), foodStore.list()]);
    setNoteCount(notes.length);
    setFoodCount(foods.length);
  };

  const noteCountText = (count: number) => `${count} note${count === 1 ? '' : 's'}`;
  const foodCountText = (count: number) => `${count} food ${count === 1 ? 'entry' : 'entries'}`;

  onMount(() => {
    void refreshCount();
  });

  const handleSaveTargets = (event: Event) => {
    event.preventDefault();
    setFoodTargets({
      protein: Number(proteinTarget()) || 0,
      calories: Number(calorieTarget()) || 0,
    });
    setStatus({ kind: 'success', message: 'Food targets saved.' });
  };

  const handleExport = async () => {
    const [notes, foods] = await Promise.all([noteStore.list(), foodStore.list()]);
    const file = buildExportFile({ notes, foods, foodTargets: getFoodTargets() });
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = exportFileName();
    link.click();
    URL.revokeObjectURL(url);

    setStatus({
      kind: 'success',
      message: `Exported ${noteCountText(notes.length)}, ${foodCountText(foods.length)} and food targets.`,
    });
  };

  const handleRefreshAppCache = async () => {
    setRefreshing(true);
    await refreshAppCache();
  };

  const handleFileChange = async (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    try {
      const bundle = parseExportFile(await file.text());
      await noteStore.importAll(bundle.notes);
      await foodStore.importAll(bundle.foods);
      if (bundle.foodTargets) {
        setFoodTargets(bundle.foodTargets);
        setProteinTarget(String(bundle.foodTargets.protein));
        setCalorieTarget(String(bundle.foodTargets.calories));
      }
      await refreshCount();
      const counts = `${noteCountText(bundle.notes.length)}, ${foodCountText(bundle.foods.length)}`;
      setStatus({
        kind: 'success',
        message: bundle.foodTargets
          ? `Imported ${counts} and food targets.`
          : `Imported ${counts}.`,
      });
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
        <h2 class={styles.sectionTitle}>Food Targets</h2>
        <form class={styles.targetForm} onSubmit={handleSaveTargets}>
          <label class={styles.targetField}>
            <span>Daily protein target (g)</span>
            <input
              type="number"
              inputmode="decimal"
              class={styles.targetInput}
              value={proteinTarget()}
              onInput={(event) => setProteinTarget(event.currentTarget.value)}
            />
          </label>
          <label class={styles.targetField}>
            <span>Daily calorie target (cal)</span>
            <input
              type="number"
              inputmode="decimal"
              class={styles.targetInput}
              value={calorieTarget()}
              onInput={(event) => setCalorieTarget(event.currentTarget.value)}
            />
          </label>
          <button type="submit" class={styles.actionButton}>
            Save Targets
          </button>
        </form>
      </section>

      <section class={styles.section}>
        <h2 class={styles.sectionTitle}>Data</h2>
        <p class={styles.noteCount}>
          {noteCountText(noteCount())} and {foodCountText(foodCount())} stored
        </p>

        <div class={styles.actions}>
          <button type="button" class={styles.actionButton} onClick={() => void handleExport()}>
            Export All
          </button>
          <button type="button" class={styles.actionButton} onClick={() => fileInput?.click()}>
            Import
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
          Export All saves notes, food entries and food targets in one file.
          Importing merges with what's here: entries whose id matches an
          existing one replace it, others are added. Food targets in the file
          replace the current ones.
        </p>
      </section>

      <section class={styles.section}>
        <h2 class={styles.sectionTitle}>App</h2>
        <div class={styles.actions}>
          <button
            type="button"
            class={styles.actionButton}
            disabled={refreshing()}
            onClick={() => void handleRefreshAppCache()}
          >
            {refreshing() ? 'Refreshing…' : 'Refresh App'}
          </button>
        </div>
        <p class={styles.hint}>
          Clears the cached app files and reloads, so you get the latest
          version. Your notes and food entries are stored separately and are
          never affected.
        </p>
      </section>
    </div>
  );
}

export default Settings;
