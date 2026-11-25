import { createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import NavBar from '../components/NavBar';
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

  const handleRemove = async (id: string) => {
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

  return (
    <div class={styles.container}>
      <NavBar title="Today" action={{ label: 'History', href: '/food/history' }} />
      <div class={styles.body}>
        <div class={styles.stats}>
          <div class={styles.remainingRow}>
            <div class={styles.remainingCard}>
              <div class={styles.remainingValue}>{remainingProtein()}g</div>
              <div class={styles.remainingLabel}>protein left</div>
            </div>
            <div class={styles.remainingCard}>
              <div class={styles.remainingValue}>{remainingCalories()}</div>
              <div class={styles.remainingLabel}>calories left</div>
            </div>
          </div>
          <div class={styles.detailRow}>
            <span>
              {Math.round(totals().protein)}g / {targets().protein}g protein
            </span>
            <span>
              {Math.round(totals().calories)} / {targets().calories} cal
            </span>
            <span>{Math.round(totals().carbs)}g carbs</span>
          </div>
        </div>

        <form class={styles.form} onSubmit={(event) => void handleSubmit(event)}>
          <input
            type="text"
            class={styles.nameInput}
            placeholder="Food name"
            value={form().name}
            onInput={(event) => updateField('name', event.currentTarget.value)}
          />
          <input
            type="text"
            class={styles.nameInput}
            placeholder="Serving size (e.g. 1 cup)"
            value={form().servingSize}
            onInput={(event) => updateField('servingSize', event.currentTarget.value)}
          />
          <div class={styles.macroRow}>
            <input
              type="text"
              inputmode="decimal"
              pattern="[0-9]*\.?[0-9]*"
              class={styles.macroInput}
              placeholder="Pro (g)"
              value={form().protein}
              onInput={(event) => updateField('protein', event.currentTarget.value)}
            />
            <input
              type="text"
              inputmode="decimal"
              pattern="[0-9]*\.?[0-9]*"
              class={styles.macroInput}
              placeholder="Cal (cal)"
              value={form().calories}
              onInput={(event) => updateField('calories', event.currentTarget.value)}
            />
            <input
              type="text"
              inputmode="decimal"
              pattern="[0-9]*\.?[0-9]*"
              class={styles.macroInput}
              placeholder="Car (g)"
              value={form().carbs}
              onInput={(event) => updateField('carbs', event.currentTarget.value)}
            />
          </div>
          <div class={styles.quantityRow}>
            <input
              type="text"
              inputmode="decimal"
              pattern="[0-9]*\.?[0-9]*"
              class={styles.quantityInput}
              placeholder="Qty"
              value={form().quantity}
              onInput={(event) => updateField('quantity', event.currentTarget.value)}
            />
            <input
              type="time"
              class={styles.timeInput}
              aria-label="Time eaten"
              value={form().time}
              onInput={(event) => updateField('time', event.currentTarget.value)}
            />
            <button type="submit" class={styles.addButton} disabled={saving()}>
              {editingId() ? 'Save Changes' : 'Add'}
            </button>
            <Show when={editingId()}>
              <button type="button" class={styles.cancelButton} onClick={handleCancelEdit}>
                Cancel
              </button>
            </Show>
          </div>
          <Show when={error()}>
            {(message) => (
              <p class={styles.error} role="alert">
                {message()}
              </p>
            )}
          </Show>
        </form>

        <Show when={recentFoods().length > 0}>
          <div class={styles.recentSection}>
            <div class={styles.sectionTitle}>Recent foods</div>
            <div class={styles.recentList}>
              <For each={recentFoods()}>
                {(entry) => (
                  <button
                    type="button"
                    class={styles.recentChip}
                    onClick={() => handleSelectRecent(entry)}
                  >
                    {entry.name}
                  </button>
                )}
              </For>
            </div>
          </div>
        </Show>

        <Show
          when={todayEntries().length > 0}
          fallback={<div class={styles.emptyState}>No food logged today</div>}
        >
          <div class={styles.list}>
            <For each={todayEntries()}>
              {(entry) => (
                <div class={styles.row} classList={{ [styles.rowEditing]: editingId() === entry.id }}>
                  <button type="button" class={styles.rowMain} onClick={() => handleEdit(entry)}>
                    <div class={styles.rowName}>
                      <Show when={entry.eatenAt}>
                        <span class={styles.rowTime}>{formatEatenAt(entry.eatenAt)} </span>
                      </Show>
                      {entry.name}
                      <Show when={entry.servingSize}>
                        <span class={styles.rowQuantity}> ({entry.servingSize})</span>
                      </Show>
                      <Show when={entry.quantity !== 1}>
                        <span class={styles.rowQuantity}> x{entry.quantity}</span>
                      </Show>
                    </div>
                    <div class={styles.rowMacros}>
                      {Math.round(entry.protein * entry.quantity)}g protein ·{' '}
                      {Math.round(entry.calories * entry.quantity)} cal ·{' '}
                      {Math.round(entry.carbs * entry.quantity)}g carbs
                    </div>
                  </button>
                  <button
                    type="button"
                    class={styles.removeButton}
                    onClick={() => void handleRemove(entry.id)}
                    aria-label={`Remove ${entry.name}`}
                  >
                    ×
                  </button>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
}

export default Food;
