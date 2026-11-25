import { createSignal, onMount } from 'solid-js';
import AccountSection from '../components/AccountSection';
import Button from '../components/Button';
import CaptureSourcesSection from '../components/CaptureSourcesSection';
import ConvertMedsSection from '../components/ConvertMedsSection';
import Field from '../components/Field';
import GlucoseSection from '../components/GlucoseSection';
import ListSection from '../components/ListSection';
import MedicinesSection from '../components/MedicinesSection';
import Message from '../components/Message';
import NavBar from '../components/NavBar';
import Page from '../components/Page';
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
  /** Food targets' own status, shown next to their Save button (not down in Data). */
  const [targetsStatus, setTargetsStatus] = createSignal<Status | undefined>();
  const [refreshing, setRefreshing] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [proteinTarget, setProteinTarget] = createSignal('');
  const [calorieTarget, setCalorieTarget] = createSignal('');
  // Each medicine section reloads when the other changes the list.
  const [medicinesVersion, setMedicinesVersion] = createSignal(0);
  const [convertVersion, setConvertVersion] = createSignal(0);
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
      setTargetsStatus({ kind: 'error', message: errorMessage(err) });
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
    setTargetsStatus(undefined);
    try {
      await setFoodTargets({
        protein: Number(proteinTarget()) || 0,
        calories: Number(calorieTarget()) || 0,
      });
      setTargetsStatus({ kind: 'success', message: 'Saved.' });
    } catch (err) {
      setTargetsStatus({ kind: 'error', message: errorMessage(err) });
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
    const { notes, foods, doses, rawEntries } = file;
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = exportFileName();
    link.click();
    URL.revokeObjectURL(url);

    setStatus({
      kind: 'success',
      message: `Exported ${noteCountText(notes.length)}, ${foodCountText(foods.length)}, ${doses.length} medicine doses, ${rawEntries.length} inbox entries and food targets.`,
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
      if (result.medicines > 0) setMedicinesVersion((v) => v + 1);
      setConvertVersion((v) => v + 1);
      await refreshCount();
      const meds = result.medicines + result.doses > 0 ? `, ${result.medicines} medicines, ${result.doses} doses` : '';
      const inbox = result.rawEntries > 0 ? `, ${result.rawEntries} inbox entries` : '';
      const counts = `${noteCountText(result.notes)}, ${foodCountText(result.foods)}${meds}${inbox}`;
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
    <Page nav={<NavBar title="Settings" />}>
      <form onSubmit={(event) => void handleSaveTargets(event)}>
        <ListSection title="Food targets" padded>
          <div class={styles.grid2}>
            <Field label="Protein per day (g)">
              <input type="number" inputmode="decimal" value={proteinTarget()} onInput={(event) => setProteinTarget(event.currentTarget.value)} />
            </Field>
            <Field label="Calories per day">
              <input type="number" inputmode="decimal" value={calorieTarget()} onInput={(event) => setCalorieTarget(event.currentTarget.value)} />
            </Field>
          </div>
          <Message kind={targetsStatus()?.kind ?? 'success'} text={targetsStatus()?.message} />
          <Button type="submit">Save Targets</Button>
        </ListSection>
      </form>

      <ListSection
        title="Medicines"
        footer="Hidden medicines stay off the Meds tab but keep their history. Deleting one keeps the doses already logged, under its name."
      >
        <MedicinesSection version={medicinesVersion()} onChange={() => setConvertVersion((v) => v + 1)} />
      </ListSection>

      <ConvertMedsSection version={convertVersion()} onConverted={() => setMedicinesVersion((v) => v + 1)} />

      <ListSection
        title="Capture sources"
        footer="Each source (the Siri Shortcut, Home Assistant) gets its own token to post text to the Inbox. Entries show the source's name. The README has the Shortcut's steps."
      >
        <CaptureSourcesSection />
      </ListSection>

      <ListSection
        title="Data"
        padded
        footer="Export saves notes, food entries, food targets, medicines, doses and inbox entries in one file. Importing a file (from this app or the old Tag Notes app) merges it into your account: entries whose id matches an existing one replace it, others are added. Food targets in the file replace the current ones."
      >
        <p class={styles.text}>
          {noteCountText(noteCount())} and {foodCountText(foodCount())} stored
        </p>
        <div class={styles.grid2}>
          <Button variant="tinted" onClick={() => void handleExport()}>
            Export All
          </Button>
          <Button variant="tinted" disabled={busy()} onClick={() => fileInput?.click()}>
            {busy() ? 'Importing…' : 'Import…'}
          </Button>
        </div>
        <input ref={fileInput} type="file" accept="application/json" class={styles.hiddenInput} onChange={(event) => void handleFileChange(event)} />
        <Message kind={status()?.kind ?? 'success'} text={status()?.message} />
      </ListSection>

      <ListSection title="Glucose" padded>
        <GlucoseSection />
      </ListSection>

      <ListSection title="Account" padded>
        <AccountSection />
      </ListSection>

      <ListSection
        title="App"
        padded
        footer="Clears the cached app files and reloads, so you get the latest version. Your data is on the server and is never affected."
      >
        <Button variant="tinted" disabled={refreshing()} onClick={() => void handleRefreshAppCache()}>
          {refreshing() ? 'Refreshing…' : 'Refresh App'}
        </Button>
      </ListSection>
    </Page>
  );
}

export default Settings;
