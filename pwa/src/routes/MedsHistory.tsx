import { createMemo, createSignal, For, onMount, Show } from 'solid-js';
import DoseSheet, { type DoseSheetValues } from '../components/DoseSheet';
import NavBar from '../components/NavBar';
import { errorMessage } from '../lib/api';
import { medsStore } from '../lib/meds/store-instance';
import { formatDay, formatTime, historyRange, MAX_RANGE_DAYS, takenDay } from '../lib/meds/time';
import type { Dose } from '../lib/meds/types';
import styles from './MedsHistory.module.css';

const newestFirst = (a: Dose, b: Dose) => b.takenAt.localeCompare(a.takenAt) || b.createdAt.localeCompare(a.createdAt);

function MedsHistory() {
  const [doses, setDoses] = createSignal<Dose[]>([]);
  /** Windows of `MAX_RANGE_DAYS` loaded so far (page 0 ends today). */
  const [pages, setPages] = createSignal(0);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | undefined>();
  const [editing, setEditing] = createSignal<Dose | undefined>();

  const loadMore = async () => {
    setLoading(true);
    setError(undefined);
    try {
      const page = pages();
      const more = await medsStore.listDoses(historyRange(page));
      setDoses((list) => [...list, ...more].sort(newestFirst));
      setPages(page + 1);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  onMount(() => void loadMore());

  const days = createMemo(() => {
    const byDay = new Map<string, Dose[]>();
    for (const dose of doses()) {
      const day = takenDay(dose.takenAt);
      const list = byDay.get(day);
      if (list) list.push(dose);
      else byDay.set(day, [dose]);
    }
    return [...byDay.entries()].map(([day, list]) => ({ day, doses: list }));
  });

  const handleSave = async (dose: Dose, values: DoseSheetValues) => {
    const updated = await medsStore.updateDose(dose.id, {
      takenAt: values.takenAt,
      dose: values.dose || null,
      note: values.note || null,
    });
    setDoses((list) => list.map((d) => (d.id === dose.id ? updated : d)).sort(newestFirst));
  };

  const handleDelete = async (dose: Dose) => {
    await medsStore.removeDose(dose.id);
    setDoses((list) => list.filter((d) => d.id !== dose.id));
  };

  return (
    <div class={styles.container}>
      <NavBar title="History" backHref="/meds" backLabel="Meds" />

      <Show when={error()}>
        {(message) => (
          <p class={styles.error} role="alert">
            {message()}
          </p>
        )}
      </Show>

      <div class={styles.dayList}>
        <Show when={pages() > 0 && doses().length === 0}>
          <p class={styles.empty}>No doses in the last {pages() * MAX_RANGE_DAYS} days</p>
        </Show>
        <For each={days()}>
          {(group) => (
            <section class={styles.day}>
              <h2 class={styles.dayDate}>{formatDay(group.day)}</h2>
              <For each={group.doses}>
                {(dose) => (
                  <button type="button" class={styles.doseRow} onClick={() => setEditing(dose)}>
                    <span class={styles.doseTime}>{formatTime(dose.takenAt)}</span>
                    <span class={styles.doseMain}>
                      <span class={styles.doseName}>{dose.medicineName}</span>
                      <Show when={dose.note}>
                        <span class={styles.doseNote}>{dose.note}</span>
                      </Show>
                    </span>
                    <span class={styles.doseAmount}>{dose.dose ?? ''}</span>
                  </button>
                )}
              </For>
            </section>
          )}
        </For>
        <Show when={pages() > 0}>
          <button type="button" class={styles.moreButton} disabled={loading()} onClick={() => void loadMore()}>
            {loading() ? 'Loading…' : 'Load earlier'}
          </button>
        </Show>
      </div>

      <Show when={editing()}>
        {(dose) => (
          <DoseSheet
            title={dose().medicineName}
            initial={{ takenAt: dose().takenAt, dose: dose().dose, note: dose().note }}
            onSave={(values) => handleSave(dose(), values)}
            onDelete={() => handleDelete(dose())}
            onClose={() => setEditing(undefined)}
          />
        )}
      </Show>
    </div>
  );
}

export default MedsHistory;
