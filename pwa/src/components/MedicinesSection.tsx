import { createEffect, createSignal, For, on, Show } from 'solid-js';
import { errorMessage } from '../lib/api';
import { medsStore } from '../lib/meds/store-instance';
import type { Medicine } from '../lib/meds/types';
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

  return (
    <div class={styles.root}>
      <Show when={medicines().length > 0} fallback={<p class={styles.hint}>No medicines yet.</p>}>
        <ul class={styles.list}>
          <For each={medicines()}>
            {(medicine, index) => (
              <li class={styles.item}>
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
                          <span class={styles.dose}> (inactive)</span>
                        </Show>
                      </span>
                      <button
                        type="button"
                        class={styles.iconButton}
                        aria-label={`Move ${medicine.name} up`}
                        disabled={busy() || index() === 0}
                        onClick={() => move(index(), -1)}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        class={styles.iconButton}
                        aria-label={`Move ${medicine.name} down`}
                        disabled={busy() || index() === medicines().length - 1}
                        onClick={() => move(index(), 1)}
                      >
                        ↓
                      </button>
                      <button type="button" class={styles.textButton} disabled={busy()} onClick={() => startEdit(medicine)}>
                        Edit
                      </button>
                    </div>
                  }
                >
                  <form class={styles.form} onSubmit={(event) => void handleSave(event, medicine.id)}>
                    <input
                      type="text"
                      class={styles.input}
                      aria-label="Name"
                      value={editName()}
                      onInput={(event) => setEditName(event.currentTarget.value)}
                    />
                    <input
                      type="text"
                      class={styles.input}
                      aria-label="Default dose"
                      placeholder="Default dose (e.g. 500 mg)"
                      value={editDose()}
                      onInput={(event) => setEditDose(event.currentTarget.value)}
                    />
                    <label class={styles.check}>
                      <input
                        type="checkbox"
                        checked={editActive()}
                        onChange={(event) => setEditActive(event.currentTarget.checked)}
                      />
                      <span>Show on the Meds tab</span>
                    </label>
                    <div class={styles.formActions}>
                      <button type="submit" class={styles.primary} disabled={busy() || !editName().trim()}>
                        Save
                      </button>
                      <button type="button" class={styles.secondary} onClick={() => setEditingId(undefined)}>
                        Cancel
                      </button>
                      <button type="button" class={styles.danger} disabled={busy()} onClick={() => void handleDelete(medicine)}>
                        Delete
                      </button>
                    </div>
                  </form>
                </Show>
              </li>
            )}
          </For>
        </ul>
      </Show>

      <form class={styles.addForm} onSubmit={(event) => void handleAdd(event)}>
        <input
          type="text"
          class={styles.input}
          placeholder="Medicine name"
          value={newName()}
          onInput={(event) => setNewName(event.currentTarget.value)}
        />
        <input
          type="text"
          class={styles.input}
          placeholder="Default dose (optional)"
          value={newDose()}
          onInput={(event) => setNewDose(event.currentTarget.value)}
        />
        <button type="submit" class={styles.primary} disabled={busy() || !newName().trim()}>
          Add Medicine
        </button>
      </form>

      <Show when={error()}>
        {(message) => (
          <p class={styles.error} role="alert">
            {message()}
          </p>
        )}
      </Show>
      <p class={styles.hint}>
        Inactive medicines are hidden from the Meds tab but kept for history. Deleting one keeps the doses already
        logged, under its name.
      </p>
    </div>
  );
}

export default MedicinesSection;
