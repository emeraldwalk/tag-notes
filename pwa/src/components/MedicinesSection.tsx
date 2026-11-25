import { createEffect, createSignal, For, on, Show } from 'solid-js';
import { errorMessage } from '../lib/api';
import { medsStore } from '../lib/meds/store-instance';
import type { Medicine } from '../lib/meds/types';
import Button from './Button';
import Field from './Field';
import Message from './Message';
import styles from './MedicinesSection.module.css';

export interface MedicinesSectionProps {
  /** Bumped when medicines change elsewhere (Convert medicine notes adds some): reload. */
  version: number;
  /** Called after any change here. */
  onChange: () => void;
}

/** Settings → Medicines: add, rename, default dose, reorder, deactivate, delete. */
function MedicinesSection(props: MedicinesSectionProps) {
  const [medicines, setMedicines] = createSignal<Medicine[]>([]);
  const [error, setError] = createSignal<string | undefined>();
  const [busy, setBusy] = createSignal(false);
  const [newName, setNewName] = createSignal('');
  const [newDose, setNewDose] = createSignal('');
  const [editingId, setEditingId] = createSignal<string | undefined>();
  const [editName, setEditName] = createSignal('');
  const [editDose, setEditDose] = createSignal('');
  const [editActive, setEditActive] = createSignal(true);

  const load = async () => {
    try {
      setMedicines(await medsStore.listMedicines());
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  createEffect(on(() => props.version, () => void load()));

  /** Runs a change, then reloads the list; errors go to the status line. */
  const change = async (action: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true);
    setError(undefined);
    try {
      await action();
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    } finally {
      await load();
      setBusy(false);
      props.onChange();
    }
  };

  const handleAdd = async (event: Event) => {
    event.preventDefault();
    const name = newName().trim();
    if (!name) return;
    const ok = await change(() => medsStore.createMedicine({ name, defaultDose: newDose().trim() || undefined }));
    if (ok) {
      setNewName('');
      setNewDose('');
    }
  };

  const startEdit = (medicine: Medicine) => {
    setEditingId(medicine.id);
    setEditName(medicine.name);
    setEditDose(medicine.defaultDose ?? '');
    setEditActive(medicine.active);
  };

  const handleSave = async (event: Event, id: string) => {
    event.preventDefault();
    const ok = await change(() =>
      medsStore.updateMedicine(id, { name: editName().trim(), defaultDose: editDose().trim() || null, active: editActive() }),
    );
    if (ok) setEditingId(undefined);
  };

  const handleDelete = async (medicine: Medicine) => {
    if (!window.confirm(`Delete ${medicine.name}? Doses already logged keep its name.`)) return;
    const ok = await change(() => medsStore.removeMedicine(medicine.id));
    if (ok) setEditingId(undefined);
  };

  /** Swaps a medicine with its neighbour and renumbers the list 0…n (only rows whose number changes are saved). */
  const move = (index: number, by: -1 | 1) => {
    const list = [...medicines()];
    const target = index + by;
    if (target < 0 || target >= list.length) return;
    [list[index], list[target]] = [list[target]!, list[index]!];
    void change(() =>
      Promise.all(list.map((m, i) => (m.sortOrder === i ? undefined : medsStore.updateMedicine(m.id, { sortOrder: i })))),
    );
  };

  // A fragment: each row is a direct child of the Settings card, so the card draws the hairlines between them.
  return (
    <>
      <Show when={medicines().length === 0}>
        <p class={`${styles.row} ${styles.empty}`}>No medicines yet.</p>
      </Show>
      <For each={medicines()}>
        {(medicine, index) => (
          <Show
            when={editingId() === medicine.id}
            fallback={
              <div class={styles.row}>
                <span class={styles.name} classList={{ [styles.inactive]: !medicine.active }}>
                  {medicine.name}
                  <Show when={medicine.defaultDose}>
                    <span class={styles.dose}> · {medicine.defaultDose}</span>
                  </Show>
                  <Show when={!medicine.active}>
                    <span class={styles.dose}> (hidden)</span>
                  </Show>
                </span>
                <span class={styles.rowActions}>
                  <Button
                    variant="gray"
                    small
                    aria-label={`Move ${medicine.name} up`}
                    disabled={busy() || index() === 0}
                    onClick={() => move(index(), -1)}
                  >
                    ↑
                  </Button>
                  <Button
                    variant="gray"
                    small
                    aria-label={`Move ${medicine.name} down`}
                    disabled={busy() || index() === medicines().length - 1}
                    onClick={() => move(index(), 1)}
                  >
                    ↓
                  </Button>
                  <Button variant="gray" small disabled={busy()} onClick={() => startEdit(medicine)}>
                    Edit
                  </Button>
                </span>
              </div>
            }
          >
            <form class={styles.form} onSubmit={(event) => void handleSave(event, medicine.id)}>
              <Field label="Name">
                <input type="text" value={editName()} onInput={(event) => setEditName(event.currentTarget.value)} />
              </Field>
              <Field label="Default dose">
                <input
                  type="text"
                  placeholder="e.g. 500 mg"
                  value={editDose()}
                  onInput={(event) => setEditDose(event.currentTarget.value)}
                />
              </Field>
              <label class={styles.check}>
                <input type="checkbox" checked={editActive()} onChange={(event) => setEditActive(event.currentTarget.checked)} />
                <span>Show on the Meds tab</span>
              </label>
              <div class={styles.formActions}>
                <Button variant="destructive" disabled={busy()} onClick={() => void handleDelete(medicine)}>
                  Delete
                </Button>
                <Button variant="gray" onClick={() => setEditingId(undefined)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={busy() || !editName().trim()}>
                  Save
                </Button>
              </div>
            </form>
          </Show>
        )}
      </For>

      <form class={styles.form} onSubmit={(event) => void handleAdd(event)}>
        <div class={styles.addFields}>
          <input
            type="text"
            placeholder="New medicine"
            aria-label="New medicine name"
            value={newName()}
            onInput={(event) => setNewName(event.currentTarget.value)}
          />
          <input
            type="text"
            placeholder="Default dose"
            aria-label="Default dose (optional)"
            value={newDose()}
            onInput={(event) => setNewDose(event.currentTarget.value)}
          />
        </div>
        <Button type="submit" variant="tinted" disabled={busy() || !newName().trim()}>
          Add Medicine
        </Button>
        <Message kind="error" text={error()} />
      </form>
    </>
  );
}

export default MedicinesSection;
