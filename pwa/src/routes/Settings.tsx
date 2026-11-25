import { createSignal, onMount, Show } from 'solid-js';
import AccountSection from '../components/AccountSection';
import GlucoseSection from '../components/GlucoseSection';
import { errorMessage } from '../lib/api';
import { exportAll, importBundle } from '../lib/backup';
import { exportFileName, parseExportFile } from '../lib/export';
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
  const [busy, setBusy] = createSignal(false);
  const [proteinTarget, setProteinTarget] = createSignal('');
  const [calorieTarget, setCalorieTarget] = createSignal('');
  let fileInput: HTMLInputElement | undefined;

  const showError = (err: unknown) => setStatus({ kind: 'error', message: errorMessage(err) });

  const refreshCount = async () => {
    try {
      const [notes, foods] = await Promise.all([noteStore.list(), foodStore.list()]);
      setNoteCount(notes.length);
      setFoodCount(foods.length);
    } catch (err) {
      showError(err);
    }
  };

  const loadTargets = async () => {
    try {
      const targets = await getFoodTargets();
      setProteinTarget(String(targets.protein));
      setCalorieTarget(String(targets.calories));
    } catch (err) {
      showError(err);
    }
  };

  const noteCountText = (count: number) => `${count} note${count === 1 ? '' : 's'}`;
  const foodCountText = (count: number) => `${count} food ${count === 1 ? 'entry' : 'entries'}`;

  onMount(() => {
    void refreshCount();
    void loadTargets();
  });

  const handleSaveTargets = async (event: Event) => {
    event.preventDefault();
    try {
      await setFoodTargets({
        protein: Number(proteinTarget()) || 0,
        calories: Number(calorieTarget()) || 0,
      });
      setStatus({ kind: 'success', message: 'Food targets saved.' });
    } catch (err) {
      showError(err);
    }
  };

  const handleExport = async () => {
    let file;
    try {
      file = await exportAll();
    } catch (err) {
      showError(err);
      return;
    }
    const { notes, foods } = file;
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

    setBusy(true);
    setStatus(undefined);
    try {
      const bundle = parseExportFile(await file.text());
      const result = await importBundle(bundle);
      if (result.targets) await loadTargets();
      await refreshCount();
      const counts = `${noteCountText(result.notes)}, ${foodCountText(result.foods)}`;
      const skipped = result.skipped > 0 ? ` Skipped ${result.skipped} that belong to another account.` : '';
      setStatus({
        kind: 'success',
        message: (result.targets ? `Imported ${counts} and food targets.` : `Imported ${counts}.`) + skipped,
      });
    } catch (err) {
      // An import stopped part-way keeps what was saved; importing the same file again is safe (by id).
      showError(err);
    } finally {
      setBusy(false);
      input.value = '';
    }
  };

  return (
    <div class={styles.container}>
      <h1 class={styles.heading}>Settings</h1>

      <section class={styles.section}>
        <h2 class={styles.sectionTitle}>Food Targets</h2>
        <form class={styles.targetForm} onSubmit={(event) => void handleSaveTargets(event)}>
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
          <button
            type="button"
            class={styles.actionButton}
            disabled={busy()}
            onClick={() => fileInput?.click()}
          >
            {busy() ? 'Importing…' : 'Import'}
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
          Importing a file (from this app or the old Tag Notes app) merges it
          into your account: entries whose id matches an existing one replace
          it, others are added. Food targets in the file replace the current
          ones.
        </p>
      </section>

      <section class={styles.section}>
        <h2 class={styles.sectionTitle}>Glucose</h2>
        <GlucoseSection />
      </section>

      <section class={styles.section}>
        <h2 class={styles.sectionTitle}>Account</h2>
        <AccountSection />
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
          version. Your notes and food entries are on the server and are
          never affected.
        </p>
      </section>
    </div>
  );
}

export default Settings;
