import { NOTES_STORE, openDatabase, requestToPromise, TAGS_INDEX, transactionDone } from '../db';
import { parseNoteText } from './parse';
import type { ImportableNote, Note, NoteStore } from './types';

/** Thrown by `update()` when no note exists with the given id. */
export class NoteNotFoundError extends Error {
  constructor(id: string) {
    super(`Note not found: ${id}`);
    this.name = 'NoteNotFoundError';
  }
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

  async function importAll(notes: ImportableNote[]): Promise<void> {
    const db = await getDb();
    const tx = db.transaction(NOTES_STORE, 'readwrite');
    const store = tx.objectStore(NOTES_STORE);
    const now = new Date().toISOString();

    for (const note of notes) {
      const parsed = parseNoteText(note.rawText);
      const record: Note = {
        ...parsed,
        id: note.id ?? crypto.randomUUID(),
        rawText: note.rawText,
        createdAt: note.createdAt ?? now,
        updatedAt: note.updatedAt ?? now,
      };
      store.put(record);
    }

    await transactionDone(tx);
  }

  return {
    list,
    get,
    create,
    update,
    remove,
    listTags,
    listByTag,
    importAll,
  };
}
