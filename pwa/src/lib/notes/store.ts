import { parseNoteText } from './parse';
import type { Note, NoteStore } from './types';

const DB_NAME = 'tag-notes';
const DB_VERSION = 1;
const NOTES_STORE = 'notes';
const TAGS_INDEX = 'tags';

/** Thrown by `update()` when no note exists with the given id. */
export class NoteNotFoundError extends Error {
  constructor(id: string) {
    super(`Note not found: ${id}`);
    this.name = 'NoteNotFoundError';
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(NOTES_STORE)) {
        const store = db.createObjectStore(NOTES_STORE, { keyPath: 'id' });
        store.createIndex(TAGS_INDEX, 'tags', { multiEntry: true });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function sortByUpdatedAtDesc(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * Creates a `NoteStore` backed by IndexedDB.
 *
 * Uses a single database (`tag-notes`) with one object store (`notes`),
 * keyed by `id`, plus a `multiEntry` index on `tags` for `listByTag`.
 */
export function createIndexedDbNoteStore(): NoteStore {
  let dbPromise: Promise<IDBDatabase> | undefined;

  function getDb(): Promise<IDBDatabase> {
    if (!dbPromise) {
      dbPromise = openDatabase();
    }
    return dbPromise;
  }

  async function list(): Promise<Note[]> {
    const db = await getDb();
    const tx = db.transaction(NOTES_STORE, 'readonly');
    const store = tx.objectStore(NOTES_STORE);
    const notes = await requestToPromise(store.getAll());
    return sortByUpdatedAtDesc(notes);
  }

  async function get(id: string): Promise<Note | undefined> {
    const db = await getDb();
    const tx = db.transaction(NOTES_STORE, 'readonly');
    const store = tx.objectStore(NOTES_STORE);
    const note = await requestToPromise(store.get(id));
    return note ?? undefined;
  }

  async function create(rawText: string): Promise<Note> {
    const parsed = parseNoteText(rawText);
    const now = new Date().toISOString();
    const note: Note = {
      ...parsed,
      id: crypto.randomUUID(),
      rawText,
      createdAt: now,
      updatedAt: now,
    };

    const db = await getDb();
    const tx = db.transaction(NOTES_STORE, 'readwrite');
    tx.objectStore(NOTES_STORE).put(note);
    await transactionDone(tx);

    return note;
  }

  async function update(id: string, rawText: string): Promise<Note> {
    const db = await getDb();
    const tx = db.transaction(NOTES_STORE, 'readwrite');
    const store = tx.objectStore(NOTES_STORE);

    const existing = await requestToPromise(store.get(id));
    if (!existing) {
      tx.abort();
      throw new NoteNotFoundError(id);
    }

    const parsed = parseNoteText(rawText);
    const updated: Note = {
      ...parsed,
      id: existing.id,
      rawText,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };

    store.put(updated);
    await transactionDone(tx);

    return updated;
  }

  async function remove(id: string): Promise<void> {
    const db = await getDb();
    const tx = db.transaction(NOTES_STORE, 'readwrite');
    tx.objectStore(NOTES_STORE).delete(id);
    await transactionDone(tx);
  }

  async function listTags(): Promise<string[]> {
    const notes = await list();
    const tags = new Set<string>();
    for (const note of notes) {
      for (const tag of note.tags) {
        tags.add(tag);
      }
    }
    return [...tags].sort((a, b) => a.localeCompare(b));
  }

  async function listByTag(tag: string): Promise<Note[]> {
    const normalizedTag = tag.toLowerCase();
    const db = await getDb();
    const tx = db.transaction(NOTES_STORE, 'readonly');
    const index = tx.objectStore(NOTES_STORE).index(TAGS_INDEX);
    const notes = await requestToPromise(index.getAll(IDBKeyRange.only(normalizedTag)));
    return sortByUpdatedAtDesc(notes);
  }

  return {
    list,
    get,
    create,
    update,
    remove,
    listTags,
    listByTag,
  };
}
