import { DATE_INDEX, FOODS_STORE, openDatabase, requestToPromise, transactionDone } from '../db';
import type { FoodEntry, FoodStore } from './types';

function sortByCreatedAtDesc(entries: FoodEntry[]): FoodEntry[] {
  return [...entries].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Creates a `FoodStore` backed by the same IndexedDB database as notes
 * (`tag-notes`), using a separate `foods` object store keyed by `id` with
 * an index on `date` for per-day stats.
 */
export function createIndexedDbFoodStore(): FoodStore {
  let dbPromise: Promise<IDBDatabase> | undefined;

  function getDb(): Promise<IDBDatabase> {
    if (!dbPromise) {
      dbPromise = openDatabase();
    }
    return dbPromise;
  }

  async function list(): Promise<FoodEntry[]> {
    const db = await getDb();
    const tx = db.transaction(FOODS_STORE, 'readonly');
    const entries = await requestToPromise(tx.objectStore(FOODS_STORE).getAll());
    return sortByCreatedAtDesc(entries);
  }

  async function listByDate(date: string): Promise<FoodEntry[]> {
    const db = await getDb();
    const tx = db.transaction(FOODS_STORE, 'readonly');
    const index = tx.objectStore(FOODS_STORE).index(DATE_INDEX);
    const entries = await requestToPromise(index.getAll(IDBKeyRange.only(date)));
    return sortByCreatedAtDesc(entries);
  }

  async function create(entry: Omit<FoodEntry, 'id' | 'createdAt'>): Promise<FoodEntry> {
    const record: FoodEntry = {
      ...entry,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    };

    const db = await getDb();
    const tx = db.transaction(FOODS_STORE, 'readwrite');
    tx.objectStore(FOODS_STORE).put(record);
    await transactionDone(tx);

    return record;
  }

  async function remove(id: string): Promise<void> {
    const db = await getDb();
    const tx = db.transaction(FOODS_STORE, 'readwrite');
    tx.objectStore(FOODS_STORE).delete(id);
    await transactionDone(tx);
  }

  async function listRecentDistinct(): Promise<FoodEntry[]> {
    const entries = await list();
    const seen = new Set<string>();
    const result: FoodEntry[] = [];
    for (const entry of entries) {
      const key = entry.name.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(entry);
    }
    return result;
  }

  return {
    list,
    listByDate,
    create,
    remove,
    listRecentDistinct,
  };
}
