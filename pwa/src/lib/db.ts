const DB_NAME = 'tag-notes';
const DB_VERSION = 2;
export const NOTES_STORE = 'notes';
export const TAGS_INDEX = 'tags';
export const FOODS_STORE = 'foods';
export const DATE_INDEX = 'date';

/**
 * Opens the shared `tag-notes` IndexedDB database, creating the `notes` and
 * `foods` object stores (and their indexes) if missing. Both stores live in
 * one database so notes and food entries share a single connection setup.
 */
export function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(NOTES_STORE)) {
        const notesStore = db.createObjectStore(NOTES_STORE, { keyPath: 'id' });
        notesStore.createIndex(TAGS_INDEX, 'tags', { multiEntry: true });
      }
      if (!db.objectStoreNames.contains(FOODS_STORE)) {
        const foodsStore = db.createObjectStore(FOODS_STORE, { keyPath: 'id' });
        foodsStore.createIndex(DATE_INDEX, 'date');
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
