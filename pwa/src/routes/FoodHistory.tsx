import { createMemo, createSignal, For, onMount, Show } from 'solid-js';
import EmptyState from '../components/EmptyState';
import ListSection from '../components/ListSection';
import Message from '../components/Message';
import Page from '../components/Page';
import { errorMessage } from '../lib/api';
import { foodStore } from '../lib/foods/store-instance';
import { formatEatenAt } from '../lib/foods/time';
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
  const [loaded, setLoaded] = createSignal(false);
  const [error, setError] = createSignal<string | undefined>();

  onMount(async () => {
    try {
      setEntries(await foodStore.list());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoaded(true);
    }
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
    <Page title="Food History" back={{ href: '/food', label: 'Food' }}>
      <Message kind="error" text={error()} />

      <Show when={loaded()}>
        <Show when={groups().length > 0} fallback={<Show when={!error()}><EmptyState>No food logged yet.</EmptyState></Show>}>
          <For each={groups()}>
            {(group) => (
              <ListSection
                prominent
                title={formatDate(group.date)}
                footer={`${Math.round(group.protein)}g protein · ${Math.round(group.calories)} cal · ${Math.round(group.carbs)}g carbs`}
              >
                <For each={group.entries}>
                  {(entry) => (
                    <div class={styles.entryRow}>
                      <span class={styles.entryName}>
                        <Show when={entry.eatenAt}>
                          <span class={styles.entryTime}>{formatEatenAt(entry.eatenAt)} </span>
                        </Show>
                        {entry.name}
                        <Show when={entry.quantity !== 1}>
                          <span class={styles.entryQuantity}> ×{entry.quantity}</span>
                        </Show>
                      </span>
                      <span class={styles.entryMacros}>
                        {Math.round(entry.protein * entry.quantity)}g · {Math.round(entry.calories * entry.quantity)} cal
                      </span>
                    </div>
                  )}
                </For>
              </ListSection>
            )}
          </For>
        </Show>
      </Show>
    </Page>
  );
}

export default FoodHistory;
