import { createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import Button from '../components/Button';
import EmptyState from '../components/EmptyState';
import Field from '../components/Field';
import ListSection from '../components/ListSection';
import Message from '../components/Message';
import NavButton from '../components/NavButton';
import Page from '../components/Page';
import { errorMessage } from '../lib/api';
import { foodStore } from '../lib/foods/store-instance';
import { DEFAULT_FOOD_TARGETS, getFoodTargets, todayDateKey } from '../lib/foods/targets';
import { eatenAtFrom, eatenDay, formatEatenAt, timeInputValue } from '../lib/foods/time';
import type { FoodEntry, FoodInput } from '../lib/foods/types';
import styles from './Food.module.css';

interface FormState {
  name: string;
  servingSize: string;
  protein: string;
  calories: string;
  carbs: string;
  quantity: string;
  /** HH:mm local; "" = unknown. */
  time: string;
}

const EMPTY_FORM: FormState = {
  name: '',
  servingSize: '',
  protein: '',
  calories: '',
  carbs: '',
  quantity: '1',
  time: '',
};

const newForm = (): FormState => ({ ...EMPTY_FORM, time: timeInputValue(new Date()) });

function Food() {
  const [todayEntries, setTodayEntries] = createSignal<FoodEntry[]>([]);
  const [recentFoods, setRecentFoods] = createSignal<FoodEntry[]>([]);
  const [targets, setTargets] = createSignal(DEFAULT_FOOD_TARGETS);
  const [form, setForm] = createSignal<FormState>(newForm());
  const [editingId, setEditingId] = createSignal<string | undefined>();
  /** The entry being edited, as loaded (its date and time are kept unless the time is changed). */
  const [editing, setEditing] = createSignal<FoodEntry | undefined>();
  /** Whether the time field was changed by hand; untouched on a new entry means "now" at save. */
  const [timeTouched, setTimeTouched] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string | undefined>();
  let formRef: HTMLFormElement | undefined;

  const refresh = async () => {
    try {
      const [today, recent] = await Promise.all([
        foodStore.listByDate(todayDateKey()),
        foodStore.listRecentDistinct(),
      ]);
      setTodayEntries(today);
      setRecentFoods(recent);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  onMount(() => {
    getFoodTargets().then(setTargets, (err) => setError(errorMessage(err)));
    void refresh();
    // Keep the default time current while the page stays open.
    const timer = setInterval(() => {
      if (!editingId() && !timeTouched()) setForm((current) => ({ ...current, time: timeInputValue(new Date()) }));
    }, 30_000);
    onCleanup(() => clearInterval(timer));
  });

  const totals = createMemo(() => {
    return todayEntries().reduce(
      (acc, entry) => ({
        protein: acc.protein + entry.protein * entry.quantity,
        calories: acc.calories + entry.calories * entry.quantity,
        carbs: acc.carbs + entry.carbs * entry.quantity,
      }),
      { protein: 0, calories: 0, carbs: 0 },
    );
  });

  const remainingProtein = createMemo(() => Math.round(targets().protein - totals().protein));
  const remainingCalories = createMemo(() => Math.round(targets().calories - totals().calories));

  const updateField = (field: keyof FormState, value: string) => {
    if (field === 'time') setTimeTouched(true);
    setForm((current) => ({ ...current, [field]: value }));
  };

  const resetForm = () => {
    setEditingId(undefined);
    setEditing(undefined);
    setTimeTouched(false);
    setForm(newForm());
  };

  const handleSelectRecent = (entry: FoodEntry) => {
    // Leaving an edit: the time goes back to "now".
    const time = editingId() ? timeInputValue(new Date()) : form().time;
    if (editingId()) setTimeTouched(false);
    setEditingId(undefined);
    setEditing(undefined);
    setForm({
      time,
      name: entry.name,
      servingSize: entry.servingSize ?? '',
      protein: String(entry.protein),
      calories: String(entry.calories),
      carbs: String(entry.carbs),
      quantity: '1',
    });
  };

  const handleEdit = (entry: FoodEntry) => {
    // The form is above the list: bring it into view.
    formRef?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setEditingId(entry.id);
    setEditing(entry);
    setTimeTouched(false);
    setForm({
      name: entry.name,
      servingSize: entry.servingSize ?? '',
      protein: String(entry.protein),
      calories: String(entry.calories),
      carbs: String(entry.carbs),
      quantity: String(entry.quantity),
      time: timeInputValue(entry.eatenAt),
    });
  };

  const handleCancelEdit = () => {
    resetForm();
  };

  /**
   * `eatenAt` to save. New entry: now, or today at the typed time. Editing: the entry's own time unless the field
   * was changed; a changed time stays on the day the entry was eaten (or its `date` if that was unknown).
   */
  const eatenAtToSave = (current: FormState): string | undefined => {
    const entry = editing();
    if (!entry) return timeTouched() ? eatenAtFrom(todayDateKey(), current.time) : new Date().toISOString();
    if (!timeTouched()) return entry.eatenAt;
    return eatenAtFrom(entry.eatenAt ? eatenDay(entry.eatenAt) : entry.date, current.time);
  };

  const handleSubmit = async (event: Event) => {
    event.preventDefault();
    const current = form();
    const name = current.name.trim();
    if (!name) return;

    const servingSize = current.servingSize.trim();
    const record: FoodInput = {
      name,
      servingSize: servingSize || undefined,
      quantity: Number(current.quantity) || 1,
      protein: Number(current.protein) || 0,
      calories: Number(current.calories) || 0,
      carbs: Number(current.carbs) || 0,
      // The day it counts towards: kept when editing, today for a new entry.
      date: editing()?.date ?? todayDateKey(),
      eatenAt: eatenAtToSave(current),
    };

    setSaving(true);
    setError(undefined);
    try {
      const id = editingId();
      if (id) {
        await foodStore.update(id, record);
      } else {
        await foodStore.create(record);
      }
    } catch (err) {
      // The form keeps what was typed.
      setError(errorMessage(err));
      return;
    } finally {
      setSaving(false);
    }

    resetForm();
    await refresh();
  };

  const handleRemove = async (entry: FoodEntry) => {
    if (!window.confirm(`Delete ${entry.name}?`)) return;
    const id = entry.id;
    setError(undefined);
    try {
      await foodStore.remove(id);
    } catch (err) {
      setError(errorMessage(err));
      return;
    }
    if (editingId() === id) handleCancelEdit();
    await refresh();
  };

  /** "42g" left, or "12g over" once past the target. */
  const remaining = (value: number, unit: string) => ({
    value: `${Math.abs(value)}${unit}`,
    label: value < 0 ? 'over' : 'left',
    over: value < 0,
  });

  const macros = (entry: FoodEntry) =>
    `${Math.round(entry.protein * entry.quantity)}g protein · ${Math.round(entry.calories * entry.quantity)} cal · ${Math.round(entry.carbs * entry.quantity)}g carbs`;

  return (
    <Page title="Food" large trailing={<NavButton href="/food/history">History</NavButton>}>
      <div class={styles.stats}>
        <div class={styles.remainingRow}>
          <For
            each={[
              { ...remaining(remainingProtein(), 'g'), what: 'protein' },
              { ...remaining(remainingCalories(), ''), what: 'calories' },
            ]}
          >
            {(stat) => (
              <div class={styles.remainingCard} classList={{ [styles.over]: stat.over }}>
                <div class={styles.remainingValue}>{stat.value}</div>
                <div class={styles.remainingLabel}>
                  {stat.what} {stat.label}
                </div>
              </div>
            )}
          </For>
        </div>
        <div class={styles.detailRow}>
          <span>
            {Math.round(totals().protein)} / {targets().protein}g protein
          </span>
          <span>
            {Math.round(totals().calories)} / {targets().calories} cal
          </span>
          <span>{Math.round(totals().carbs)}g carbs</span>
        </div>
      </div>

      <form ref={formRef} class={styles.formSection} onSubmit={(event) => void handleSubmit(event)}>
        <ListSection title={editingId() ? 'Edit entry' : 'Add food'} padded>
          <Field label="Food">
            <input
              type="text"
              placeholder="e.g. Greek yogurt"
              value={form().name}
              onInput={(event) => updateField('name', event.currentTarget.value)}
            />
          </Field>
          <Field label="Serving size">
            <input
              type="text"
              placeholder="e.g. 1 cup (optional)"
              value={form().servingSize}
              onInput={(event) => updateField('servingSize', event.currentTarget.value)}
            />
          </Field>
          <div class={styles.grid3}>
            <Field label="Protein (g)">
              <input
                type="text"
                inputmode="decimal"
                pattern="[0-9]*\.?[0-9]*"
                placeholder="0"
                value={form().protein}
                onInput={(event) => updateField('protein', event.currentTarget.value)}
              />
            </Field>
            <Field label="Calories">
              <input
                type="text"
                inputmode="decimal"
                pattern="[0-9]*\.?[0-9]*"
                placeholder="0"
                value={form().calories}
                onInput={(event) => updateField('calories', event.currentTarget.value)}
              />
            </Field>
            <Field label="Carbs (g)">
              <input
                type="text"
                inputmode="decimal"
                pattern="[0-9]*\.?[0-9]*"
                placeholder="0"
                value={form().carbs}
                onInput={(event) => updateField('carbs', event.currentTarget.value)}
              />
            </Field>
          </div>
          <div class={styles.grid2}>
            <Field label="Servings">
              <input
                type="text"
                inputmode="decimal"
                pattern="[0-9]*\.?[0-9]*"
                placeholder="1"
                value={form().quantity}
                onInput={(event) => updateField('quantity', event.currentTarget.value)}
              />
            </Field>
            <Field label="Time eaten">
              <input type="time" value={form().time} onInput={(event) => updateField('time', event.currentTarget.value)} />
            </Field>
          </div>
          <Message kind="error" text={error()} />
          <div class={styles.formActions}>
            <Show when={editingId()}>
              <Button variant="gray" onClick={handleCancelEdit}>
                Cancel
              </Button>
            </Show>
            <Button type="submit" disabled={saving() || form().name.trim() === ''}>
              {editingId() ? 'Save Changes' : 'Add'}
            </Button>
          </div>
        </ListSection>
      </form>

      <Show when={recentFoods().length > 0}>
        <section class={styles.recentSection}>
          <h2 class={styles.sectionTitle}>Recent foods</h2>
          <div class={styles.recentList}>
            <For each={recentFoods()}>
              {(entry) => (
                <button type="button" class={styles.recentChip} onClick={() => handleSelectRecent(entry)}>
                  {entry.name}
                </button>
              )}
            </For>
          </div>
        </section>
      </Show>

      <Show
        when={todayEntries().length > 0}
        fallback={<EmptyState>No food logged today.</EmptyState>}
      >
        <ListSection title="Today" footer="Tap an entry to edit it.">
          <For each={todayEntries()}>
            {(entry) => (
              <div class={styles.row} classList={{ [styles.rowEditing]: editingId() === entry.id }}>
                <button type="button" class={styles.rowMain} onClick={() => handleEdit(entry)}>
                  <span class={styles.rowName}>
                    <Show when={entry.eatenAt}>
                      <span class={styles.rowTime}>{formatEatenAt(entry.eatenAt)} </span>
                    </Show>
                    {entry.name}
                    <Show when={entry.servingSize}>
                      <span class={styles.rowQuantity}> ({entry.servingSize})</span>
                    </Show>
                    <Show when={entry.quantity !== 1}>
                      <span class={styles.rowQuantity}> ×{entry.quantity}</span>
                    </Show>
                  </span>
                  <span class={styles.rowMacros}>{macros(entry)}</span>
                </button>
                <button
                  type="button"
                  class={styles.removeButton}
                  onClick={() => void handleRemove(entry)}
                  aria-label={`Delete ${entry.name}`}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M3 6h18" />
                    <path d="M8 6V4h8v2" />
                    <path d="M19 6l-1 14H6L5 6" />
                  </svg>
                </button>
              </div>
            )}
          </For>
        </ListSection>
      </Show>
    </Page>
  );
}

export default Food;
