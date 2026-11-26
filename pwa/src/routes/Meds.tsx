import { A } from '@solidjs/router';
import { createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import Button from '../components/Button';
import DoseSheet, { type DoseSheetValues } from '../components/DoseSheet';
import EmptyState from '../components/EmptyState';
import ListSection from '../components/ListSection';
import MedicineButton from '../components/MedicineButton';
import Message from '../components/Message';
import ListRow from '../components/ListRow';
import NavButton from '../components/NavButton';
import Page from '../components/Page';
import { errorMessage } from '../lib/api';
import { medsStore } from '../lib/meds/store-instance';
import { dayLabel, formatDay, formatTime, historyRange, MAX_RANGE_DAYS, takenDay } from '../lib/meds/time';
import type { Dose, Medicine } from '../lib/meds/types';
import styles from './Meds.module.css';

const UNDO_MS = 6000;

/** What the sheet is for: logging a medicine with a time or dose, logging a one-off, or editing a logged dose. */
type Sheet = { kind: 'medicine'; medicine: Medicine } | { kind: 'other' } | { kind: 'edit'; dose: Dose };

const newestFirst = (a: Dose, b: Dose) => b.takenAt.localeCompare(a.takenAt) || b.createdAt.localeCompare(a.createdAt);

/**
 * The Meds tab: one-tap buttons on top, and under them the log of every dose, by day (Today, Yesterday, …). The
 * log loads `MAX_RANGE_DAYS` at a time and fetches earlier days as it's scrolled to the end; tapping a dose edits it.
 */
function Meds() {
  const [medicines, setMedicines] = createSignal<Medicine[]>([]);
  const [doses, setDoses] = createSignal<Dose[]>([]);
  /** Windows of `MAX_RANGE_DAYS` loaded so far (page 0 ends today). */
  const [pages, setPages] = createSignal(0);
  /** Whether the last window had any doses: scrolling to the end only loads more while it did. */
  const [lastPageHadDoses, setLastPageHadDoses] = createSignal(true);
  const [loading, setLoading] = createSignal(false);
  const [loaded, setLoaded] = createSignal(false);
  const [error, setError] = createSignal<string | undefined>();
  const [undo, setUndo] = createSignal<Dose | undefined>();
  const [sheet, setSheet] = createSignal<Sheet | undefined>();
  const [logging, setLogging] = createSignal(false);
  let undoTimer: ReturnType<typeof setTimeout> | undefined;
  let sentinel: HTMLDivElement | undefined;

  const active = () => medicines().filter((m) => m.active);

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

  /** The earliest day the log covers, for "Showing since …". */
  const since = () => formatDay(takenDay(historyRange(pages() - 1).from));

  const loadMore = async () => {
    if (loading()) return;
    setLoading(true);
    setError(undefined);
    try {
      const page = pages();
      const more = await medsStore.listDoses(historyRange(page));
      setDoses((list) => {
        const seen = new Set(list.map((d) => d.id));
        return [...list, ...more.filter((d) => !seen.has(d.id))].sort(newestFirst);
      });
      setPages(page + 1);
      setLastPageHadDoses(more.length > 0);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  onMount(async () => {
    try {
      const [list] = await Promise.all([medsStore.listMedicines(), loadMore()]);
      setMedicines(list);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoaded(true);
    }

    // Reaching the end of the log loads the window before it.
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && lastPageHadDoses() && !error()) void loadMore();
    });
    if (sentinel) observer.observe(sentinel);
    onCleanup(() => observer.disconnect());
  });
  onCleanup(() => clearTimeout(undoTimer));

  const add = (dose: Dose) => setDoses((list) => [dose, ...list.filter((d) => d.id !== dose.id)].sort(newestFirst));
  const drop = (id: string) => setDoses((list) => list.filter((d) => d.id !== id));

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
      add(dose);
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
      drop(dose.id);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const handleSheetSave = async (current: Sheet, values: DoseSheetValues) => {
    if (current.kind === 'edit') {
      add(await medsStore.updateDose(current.dose.id, { takenAt: values.takenAt, dose: values.dose || null, note: values.note || null }));
      return;
    }
    const common = { takenAt: values.takenAt, note: values.note || undefined, source: 'manual' as const };
    const dose =
      current.kind === 'medicine'
        ? // The sheet starts with the default dose, so a cleared field means none.
          await medsStore.createDose({ ...common, medicineId: current.medicine.id, dose: values.dose || null })
        : await medsStore.createDose({ ...common, dose: values.dose || undefined, medicineName: values.medicineName });
    add(dose);
    offerUndo(dose);
  };

  const sheetProps = (current: Sheet) => {
    switch (current.kind) {
      case 'medicine':
        return { title: current.medicine.name, initial: { takenAt: new Date().toISOString(), dose: current.medicine.defaultDose }, saveLabel: 'Log' };
      case 'other':
        return { title: 'Other Medicine', askName: true, initial: { takenAt: new Date().toISOString() }, saveLabel: 'Log' };
      case 'edit': {
        const { dose } = current;
        return {
          title: dose.medicineName,
          initial: { takenAt: dose.takenAt, dose: dose.dose, note: dose.note },
          onDelete: async () => {
            await medsStore.removeDose(dose.id);
            drop(dose.id);
          },
        };
      }
    }
  };

  return (
    <Page
      title="Meds"
      large
      trailing={
        <NavButton label="Log something else" onClick={() => setSheet({ kind: 'other' })}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </NavButton>
      }
    >
      <Message kind="error" text={error()} />

      <section class={styles.buttons} aria-label="Log a medicine">
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
      </section>

      <Show when={loaded() && active().length === 0}>
        <p class={styles.hint}>
          Add your medicines in <A href="/settings">Settings</A> to log them with one tap. Tap a medicine to log it now;
          press and hold (or tap ···) to pick the time or dose. + logs anything else.
        </p>
      </Show>

      <Show when={loaded() && doses().length === 0 && !loading()}>
        <EmptyState>No doses in the last {pages() * MAX_RANGE_DAYS} days.</EmptyState>
      </Show>

      <For each={days()}>
        {(group) => (
          <ListSection title={dayLabel(group.day)} prominent>
            <For each={group.doses}>
              {(dose) => (
                <ListRow
                  title={dose.medicineName}
                  detail={formatTime(dose.takenAt)}
                  subtitle={[dose.dose, dose.note].filter(Boolean).join(' · ') || undefined}
                  onClick={() => setSheet({ kind: 'edit', dose })}
                />
              )}
            </For>
          </ListSection>
        )}
      </For>

      {/* The end of the log: scrolling it into view loads earlier days. */}
      <div ref={sentinel} class={styles.logEnd}>
        <Show when={pages() > 0}>
          <span>Showing since {since()}</span>
          <Button variant="plain" small disabled={loading()} onClick={() => void loadMore()}>
            {loading() ? 'Loading…' : 'Load Earlier'}
          </Button>
        </Show>
      </div>

      <Show when={undo()}>
        {(dose) => (
          <div class={styles.toast} role="status">
            <span>
              Logged {dose().medicineName} at {formatTime(dose().takenAt)}
            </span>
            <button type="button" class={styles.undoButton} onClick={() => void handleUndo()}>
              Undo
            </button>
          </div>
        )}
      </Show>

      <Show when={sheet()}>
        {(current) => (
          <DoseSheet
            {...sheetProps(current())}
            onSave={(values) => handleSheetSave(current(), values)}
            onClose={() => setSheet(undefined)}
          />
        )}
      </Show>
    </Page>
  );
}

export default Meds;
