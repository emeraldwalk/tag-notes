import { A } from '@solidjs/router';
import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import DoseSheet, { type DoseSheetValues } from '../components/DoseSheet';
import MedicineButton from '../components/MedicineButton';
import NavBar from '../components/NavBar';
import { errorMessage } from '../lib/api';
import { medsStore } from '../lib/meds/store-instance';
import { formatTime, todayRange } from '../lib/meds/time';
import type { Dose, Medicine } from '../lib/meds/types';
import styles from './Meds.module.css';

const UNDO_MS = 6000;

type Sheet = { kind: 'medicine'; medicine: Medicine } | { kind: 'other' };

const sheetMedicine = (sheet: Sheet) => (sheet.kind === 'medicine' ? sheet.medicine : undefined);

function Meds() {
  const [medicines, setMedicines] = createSignal<Medicine[]>([]);
  const [today, setToday] = createSignal<Dose[]>([]);
  const [loaded, setLoaded] = createSignal(false);
  const [error, setError] = createSignal<string | undefined>();
  const [undo, setUndo] = createSignal<Dose | undefined>();
  const [sheet, setSheet] = createSignal<Sheet | undefined>();
  const [logging, setLogging] = createSignal(false);
  let undoTimer: ReturnType<typeof setTimeout> | undefined;

  const active = () => medicines().filter((m) => m.active);

  const refreshToday = async () => {
    setToday(await medsStore.listDoses(todayRange()));
  };

  onMount(async () => {
    try {
      const [list] = await Promise.all([medsStore.listMedicines(), refreshToday()]);
      setMedicines(list);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoaded(true);
    }
  });
  onCleanup(() => clearTimeout(undoTimer));

  const offerUndo = (dose: Dose) => {
    clearTimeout(undoTimer);
    setUndo(dose);
    undoTimer = setTimeout(() => setUndo(undefined), UNDO_MS);
  };

  const handleTap = async (medicine: Medicine) => {
    setLogging(true);
    setError(undefined);
    try {
      const dose = await medsStore.createDose({ medicineId: medicine.id, source: 'tap' });
      setToday((list) => [dose, ...list]);
      offerUndo(dose);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLogging(false);
    }
  };

  const handleUndo = async () => {
    const dose = undo();
    if (!dose) return;
    clearTimeout(undoTimer);
    setUndo(undefined);
    try {
      await medsStore.removeDose(dose.id);
      setToday((list) => list.filter((d) => d.id !== dose.id));
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const handleSheetSave = async (current: Sheet, values: DoseSheetValues) => {
    const common = { takenAt: values.takenAt, dose: values.dose || undefined, note: values.note || undefined, source: 'manual' as const };
    const dose =
      current.kind === 'medicine'
        ? // The sheet starts with the default dose, so a cleared field means none.
          await medsStore.createDose({ ...common, medicineId: current.medicine.id, dose: values.dose || null })
        : await medsStore.createDose({ ...common, medicineName: values.medicineName });
    offerUndo(dose);
    await refreshToday();
  };

  return (
    <div class={styles.container}>
      <NavBar title="Meds" action={{ label: 'History', href: '/meds/history' }} />
      <div class={styles.body}>
        <section class={styles.today}>
          <h2 class={styles.sectionTitle}>Today</h2>
          <Show
            when={today().length > 0}
            fallback={<p class={styles.empty}>{loaded() ? 'Nothing logged today' : ''}</p>}
          >
            <ul class={styles.doseList}>
              <For each={today()}>
                {(dose) => (
                  <li class={styles.doseRow}>
                    <span class={styles.doseTime}>{formatTime(dose.takenAt)}</span>
                    <span class={styles.doseName}>{dose.medicineName}</span>
                    <span class={styles.doseAmount}>{dose.dose ?? ''}</span>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </section>

        <Show when={undo()}>
          {(dose) => (
            <div class={styles.undoBar} role="status">
              <span>
                Logged {dose().medicineName} at {formatTime(dose().takenAt)}
              </span>
              <button type="button" class={styles.undoButton} onClick={() => void handleUndo()}>
                Undo
              </button>
            </div>
          )}
        </Show>

        <Show when={error()}>
          {(message) => (
            <p class={styles.error} role="alert">
              {message()}
            </p>
          )}
        </Show>

        <section class={styles.buttons}>
          <For each={active()}>
            {(medicine) => (
              <MedicineButton
                medicine={medicine}
                disabled={logging()}
                onTap={() => void handleTap(medicine)}
                onMore={() => setSheet({ kind: 'medicine', medicine })}
              />
            )}
          </For>
          <button type="button" class={styles.otherButton} onClick={() => setSheet({ kind: 'other' })}>
            Log something else
          </button>
        </section>

        <Show when={loaded() && active().length === 0}>
          <p class={styles.hint}>
            Add your medicines in <A href="/settings">Settings → Medicines</A> to log them with one tap.
          </p>
        </Show>
      </div>

      <Show when={sheet()}>
        {(current) => (
          <DoseSheet
            title={sheetMedicine(current())?.name ?? 'Log something else'}
            askName={current().kind === 'other'}
            initial={{ takenAt: new Date().toISOString(), dose: sheetMedicine(current())?.defaultDose }}
            saveLabel="Log"
            onSave={(values) => handleSheetSave(current(), values)}
            onClose={() => setSheet(undefined)}
          />
        )}
      </Show>
    </div>
  );
}

export default Meds;
