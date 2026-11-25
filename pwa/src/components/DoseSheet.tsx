import { createSignal, createUniqueId, onMount, Show } from 'solid-js';
import Button from './Button';
import Field from './Field';
import Message from './Message';
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
  const titleId = createUniqueId();
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
    <dialog
      ref={dialog}
      class={styles.sheet}
      aria-labelledby={titleId}
      onClose={() => props.onClose()}
      onClick={(event) => {
        // A tap on the backdrop (the dialog itself, outside the form) closes it, like an iOS sheet.
        if (event.target === dialog) dialog.close();
      }}
    >
      <form class={styles.form} onSubmit={handleSubmit}>
        <header class={styles.header}>
          <button type="button" class={styles.headerButton} onClick={() => dialog?.close()}>
            Cancel
          </button>
          <h2 id={titleId} class={styles.title}>
            {props.title}
          </h2>
          <button type="submit" class={`${styles.headerButton} ${styles.headerPrimary}`} disabled={busy()}>
            {props.saveLabel ?? 'Save'}
          </button>
        </header>
        <div class={styles.fields}>
          <Show when={props.askName}>
            <Field label="Name">
              <input type="text" placeholder="e.g. Ibuprofen" value={name()} onInput={(event) => setName(event.currentTarget.value)} />
            </Field>
          </Show>
          <Field label="Taken at">
            <input type="datetime-local" value={time()} onInput={(event) => setTime(event.currentTarget.value)} />
          </Field>
          <Field label="Dose">
            <input type="text" placeholder="e.g. 500 mg" value={dose()} onInput={(event) => setDose(event.currentTarget.value)} />
          </Field>
          <Field label="Note">
            <textarea rows={2} value={note()} onInput={(event) => setNote(event.currentTarget.value)} />
          </Field>
          <Message kind="error" text={error()} />
          <Show when={props.onDelete}>
            {(remove) => (
              <Button
                variant="destructive"
                disabled={busy()}
                onClick={() => {
                  if (window.confirm('Delete this dose?')) void run(remove());
                }}
              >
                Delete Dose
              </Button>
            )}
          </Show>
        </div>
      </form>
    </dialog>
  );
}

export default DoseSheet;
