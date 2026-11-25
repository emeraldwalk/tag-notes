import { createSignal, onMount, Show } from 'solid-js';
import { fromLocalInput, localInputValue } from '../lib/meds/time';
import styles from './DoseSheet.module.css';

export interface DoseSheetValues {
  /** Only when the sheet asks for a name ("Log something else"). */
  medicineName?: string;
  takenAt: string; // UTC ISO
  dose: string; // "" = none
  note: string; // "" = none
}

export interface DoseSheetProps {
  title: string;
  /** Ask for the medicine's name (a one-off). */
  askName?: boolean;
  initial: { takenAt: string; dose?: string; note?: string };
  saveLabel?: string;
  /** Resolves when saved (the sheet closes); rejects with a message to show. */
  onSave: (values: DoseSheetValues) => Promise<void>;
  /** Shows a Delete button (History). */
  onDelete?: () => Promise<void>;
  onClose: () => void;
}

/**
 * A modal sheet to set a dose's time, dose and note before saving (Meds "…" / long press, "Log something else") or to
 * edit one (History). Rendered only while open; closing it (Cancel, Escape) calls `onClose`.
 */
function DoseSheet(props: DoseSheetProps) {
  let dialog: HTMLDialogElement | undefined;
  const [name, setName] = createSignal('');
  const [time, setTime] = createSignal(localInputValue(props.initial.takenAt));
  const [dose, setDose] = createSignal(props.initial.dose ?? '');
  const [note, setNote] = createSignal(props.initial.note ?? '');
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | undefined>();

  onMount(() => dialog?.showModal());

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await action();
      dialog?.close();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = (event: Event) => {
    event.preventDefault();
    const takenAt = fromLocalInput(time());
    if (!takenAt) {
      setError('Pick a date and time.');
      return;
    }
    if (props.askName && !name().trim()) {
      setError('Name what you took.');
      return;
    }
    void run(() =>
      props.onSave({ medicineName: props.askName ? name().trim() : undefined, takenAt, dose: dose().trim(), note: note().trim() }),
    );
  };

  return (
    <dialog ref={dialog} class={styles.sheet} onClose={() => props.onClose()}>
      <form class={styles.form} onSubmit={handleSubmit}>
        <h2 class={styles.title}>{props.title}</h2>
        <Show when={props.askName}>
          <label class={styles.field}>
            <span>Name</span>
            <input
              type="text"
              class={styles.input}
              placeholder="e.g. Ibuprofen"
              value={name()}
              onInput={(event) => setName(event.currentTarget.value)}
            />
          </label>
        </Show>
        <label class={styles.field}>
          <span>Taken at</span>
          <input
            type="datetime-local"
            class={styles.input}
            value={time()}
            onInput={(event) => setTime(event.currentTarget.value)}
          />
        </label>
        <label class={styles.field}>
          <span>Dose</span>
          <input
            type="text"
            class={styles.input}
            placeholder="e.g. 500 mg"
            value={dose()}
            onInput={(event) => setDose(event.currentTarget.value)}
          />
        </label>
        <label class={styles.field}>
          <span>Note</span>
          <textarea class={styles.textarea} rows={2} value={note()} onInput={(event) => setNote(event.currentTarget.value)} />
        </label>
        <Show when={error()}>
          {(message) => (
            <p class={styles.error} role="alert">
              {message()}
            </p>
          )}
        </Show>
        <div class={styles.actions}>
          <button type="button" class={styles.secondary} onClick={() => dialog?.close()}>
            Cancel
          </button>
          <button type="submit" class={styles.primary} disabled={busy()}>
            {props.saveLabel ?? 'Save'}
          </button>
        </div>
        <Show when={props.onDelete}>
          {(remove) => (
            <button type="button" class={styles.danger} disabled={busy()} onClick={() => void run(remove())}>
              Delete
            </button>
          )}
        </Show>
      </form>
    </dialog>
  );
}

export default DoseSheet;
