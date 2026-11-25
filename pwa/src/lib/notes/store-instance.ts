import { createHttpNoteStore } from './store';

/** Shared `NoteStore` for the whole app (plan 8: the Worker's API). UI code imports this, never `fetch`. */
export const noteStore = createHttpNoteStore();
