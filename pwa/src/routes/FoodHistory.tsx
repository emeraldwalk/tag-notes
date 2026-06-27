import { createMemo, createSignal, For, onMount, Show } from 'solid-js';
import NavBar from '../components/NavBar';
import { foodStore } from '../lib/foods/store-instance';
import type { FoodEntry } from '../lib/foods/types';
import styles from './FoodHistory.module.css';

interface DayGroup {
  date: string;
  entries: FoodEntry[];
  protein: number;
  calories: number;
  carbs: number;
}

function formatDate(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function FoodHistory() {
  const [entries, setEntries] = createSignal<FoodEntry[]>([]);

  onMount(async () => {
    setEntries(await foodStore.list());
  });

  const groups = createMemo<DayGroup[]>(() => {
    const byDate = new Map<string, FoodEntry[]>();
    for (const entry of entries()) {
      const existing = byDate.get(entry.date);
      if (existing) {
        existing.push(entry);
      } else {
        byDate.set(entry.date, [entry]);
      }
    }

    return [...byDate.entries()]
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([date, dayEntries]) => ({
        date,
        entries: dayEntries,
        protein: dayEntries.reduce((sum, e) => sum + e.protein * e.quantity, 0),
        calories: dayEntries.reduce((sum, e) => sum + e.calories * e.quantity, 0),
        carbs: dayEntries.reduce((sum, e) => sum + e.carbs * e.quantity, 0),
      }));
  });

  return (
    <div class={styles.container}>
      <NavBar title="History" backHref="/food" backLabel="Today" />

      <Show when={groups().length > 0} fallback={<div class={styles.emptyState}>No food logged yet</div>}>
        <div class={styles.dayList}>
          <For each={groups()}>
            {(group) => (
              <div class={styles.day}>
                <div class={styles.dayHeader}>
                  <span class={styles.dayDate}>{formatDate(group.date)}</span>
                  <span class={styles.dayTotals}>
                    {Math.round(group.protein)}g protein · {Math.round(group.calories)} cal ·{' '}
                    {Math.round(group.carbs)}g carbs
                  </span>
                </div>
                <div class={styles.entryList}>
                  <For each={group.entries}>
                    {(entry) => (
                      <div class={styles.entryRow}>
                        <span class={styles.entryName}>
                          {entry.name}
                          <Show when={entry.quantity !== 1}>
                            <span class={styles.entryQuantity}> x{entry.quantity}</span>
                          </Show>
                        </span>
                        <span class={styles.entryMacros}>
                          {Math.round(entry.protein * entry.quantity)}g /{' '}
                          {Math.round(entry.calories * entry.quantity)} cal
                        </span>
                      </div>
                    )}
                  </For>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

export default FoodHistory;
