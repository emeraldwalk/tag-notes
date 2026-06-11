import { createIndexedDbNoteStore } from './store';

/**
 * Shared `NoteStore` instance for the whole app. UI code should import this
 * rather than constructing its own store, so all routes/components operate
 * on the same underlying IndexedDB connection.
 */
export const noteStore = createIndexedDbNoteStore();
