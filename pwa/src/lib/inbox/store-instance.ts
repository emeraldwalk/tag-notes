import { createHttpInboxStore } from './store';

/** Shared `InboxStore` for the whole app. UI code imports this, never `fetch`. */
export const inboxStore = createHttpInboxStore();
