import { createEffect, createSignal, For, on, Show } from 'solid-js';
import { ApiError, errorMessage } from '../lib/api';
import { chunkGroups, defaultChoice, groupKey, groupMedsNotes, type GroupChoice, MEDS_TAG, type NoteGroup } from '../lib/meds/convert';
import { medsStore } from '../lib/meds/store-instance';
import { formatDay, takenDay } from '../lib/meds/time';
import type { Medicine } from '../lib/meds/types';
import { noteStore } from '../lib/notes/store-instance';
import styles from './ConvertMedsSection.module.css';

export interface ConvertMedsSectionProps {
  /** Bumped when medicines change in Settings → Medicines: reload the choices. */
  version: number;
  /** Called after converting (new medicines may have been added). */
  onConverted: () => void;
  /** Settings' section and heading classes (the section, heading included, shows only while there are notes). */
  sectionClass: string;
  titleClass: string;
}

const NEW = 'new';
const SKIP = 'skip';

const choiceValue = (choice: GroupChoice) => (choice.kind === 'existing' ? choice.medicineId : choice.kind);
const choiceFrom = (value: string): GroupChoice =>
  value === NEW ? { kind: 'new' } : value === SKIP ? { kind: 'skip' } : { kind: 'existing', medicineId: value };

const range = (group: NoteGroup) => {
  const first = formatDay(takenDay(group.first));
  const last = formatDay(takenDay(group.last));
  return first === last ? first : `${first} – ${last}`;
};

/**
 * Settings → Convert medicine notes: `meds`-tagged notes, grouped by title; each group becomes doses of a medicine
 * (or is skipped), and the converted notes are deleted. Renders nothing while there are no such notes.
 */
function ConvertMedsSection(props: ConvertMedsSectionProps) {
  const [groups, setGroups] = createSignal<NoteGroup[]>([]);
  const [medicines, setMedicines] = createSignal<Medicine[]>([]);
  const [choices, setChoices] = createSignal<Record<string, GroupChoice>>({});
  const [busy, setBusy] = createSignal(false);
  const [status, setStatus] = createSignal<{ kind: 'success' | 'error'; message: string } | undefined>();

  const load = async () => {
    try {
      const [notes, list] = await Promise.all([noteStore.listByTag(MEDS_TAG), medsStore.listMedicines()]);
      const grouped = groupMedsNotes(notes);
      setGroups(grouped);
      setMedicines(list);
      // Keep choices already made; default the rest.
      setChoices((current) =>
        Object.fromEntries(grouped.map((g) => {
          const kept = current[g.key];
          const valid = kept && (kept.kind !== 'existing' || list.some((m) => m.id === kept.medicineId));
          return [g.key, valid ? kept : defaultChoice(g, list)];
        })),
      );
    } catch (err) {
      setStatus({ kind: 'error', message: errorMessage(err) });
    }
  };

  createEffect(on(() => props.version, () => void load()));

  const chosen = (group: NoteGroup) => choiceValue(choices()[group.key] ?? { kind: 'skip' });

  const noteTotal = () => groups().reduce((sum, g) => sum + (choices()[g.key]?.kind === 'skip' ? 0 : g.notes.length), 0);

  /** The medicine named `name` (any case), creating it if there is none. */
  const medicineNamed = async (name: string, known: Medicine[]): Promise<Medicine> => {
    const found = known.find((m) => groupKey(m.name) === groupKey(name));
    if (found) return found;
    try {
      const created = await medsStore.createMedicine({ name });
      known.push(created);
      return created;
    } catch (err) {
      if (!(err instanceof ApiError && err.code === 'duplicate_name')) throw err;
      const again = (await medsStore.listMedicines()).find((m) => groupKey(m.name) === groupKey(name));
      if (!again) throw err;
      return again;
    }
  };

  const handleConvert = async () => {
    setBusy(true);
    setStatus(undefined);
    let converted = 0;
    let skipped = 0;
    try {
      const known = [...medicines()];
      const requests: { noteIds: string[]; medicineId: string }[] = [];
      for (const group of groups()) {
        const choice = choices()[group.key] ?? { kind: 'skip' };
        if (choice.kind === 'skip') continue;
        const medicineId = choice.kind === 'existing' ? choice.medicineId : (await medicineNamed(group.title, known)).id;
        requests.push({ noteIds: group.notes.map((n) => n.id), medicineId });
      }
      // Each request is all-or-nothing on the server; one that fails leaves its notes (and later ones) in place.
      for (const chunk of chunkGroups(requests)) {
        const result = await medsStore.convertNotes(chunk);
        converted += result.converted;
        skipped += result.skipped;
      }
      const skippedText = skipped > 0 ? ` ${skipped} skipped (changed or no longer tagged).` : '';
      setStatus({ kind: 'success', message: `Converted ${converted} note${converted === 1 ? '' : 's'} to doses.${skippedText}` });
    } catch (err) {
      const done = converted > 0 ? ` (${converted} converted before the error.)` : '';
      setStatus({ kind: 'error', message: errorMessage(err) + done });
    } finally {
      setBusy(false);
      await load();
      props.onConverted();
    }
  };

  return (
    <Show when={groups().length > 0 || status()}>
      <section class={props.sectionClass}>
        <h2 class={props.titleClass}>Convert medicine notes</h2>
        <div class={styles.root}>
        <Show when={groups().length > 0}>
          <p class={styles.hint}>
            Notes tagged <code>{MEDS_TAG}</code>, grouped by title. Each group becomes doses of the medicine you pick,
            at the time the note was written; the notes are then deleted.
          </p>
          <ul class={styles.list}>
            <For each={groups()}>
              {(group) => (
                <li class={styles.group}>
                  <div class={styles.groupInfo}>
                    <span class={styles.groupTitle}>{group.title}</span>
                    <span class={styles.groupMeta}>
                      {group.notes.length} note{group.notes.length === 1 ? '' : 's'} · {range(group)}
                    </span>
                  </div>
                  <select
                    class={styles.select}
                    aria-label={`Medicine for ${group.title}`}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      setChoices((current) => ({ ...current, [group.key]: choiceFrom(value) }));
                    }}
                  >
                    {/* `selected` per option: a `value` on the select would be set before its options exist. */}
                    <For each={medicines()}>
                      {(m) => (
                        <option value={m.id} selected={chosen(group) === m.id}>
                          {m.name}
                        </option>
                      )}
                    </For>
                    <Show when={!medicines().some((m) => groupKey(m.name) === group.key)}>
                      <option value={NEW} selected={chosen(group) === NEW}>
                        New medicine named “{group.title}”
                      </option>
                    </Show>
                    <option value={SKIP} selected={chosen(group) === SKIP}>
                      Skip
                    </option>
                  </select>
                </li>
              )}
            </For>
          </ul>
          <button
            type="button"
            class={styles.primary}
            disabled={busy() || noteTotal() === 0}
            onClick={() => void handleConvert()}
          >
            {busy() ? 'Converting…' : `Convert ${noteTotal()} note${noteTotal() === 1 ? '' : 's'}`}
          </button>
        </Show>
        <Show when={status()}>
          {(current) => (
            <p classList={{ [styles.success]: current().kind === 'success', [styles.error]: current().kind === 'error' }}>
              {current().message}
            </p>
          )}
        </Show>
        </div>
      </section>
    </Show>
  );
}

export default ConvertMedsSection;
