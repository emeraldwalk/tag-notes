import { createHttpMedsStore } from './store';

/** Shared `MedsStore` for the whole app. UI code imports this, never `fetch`. */
export const medsStore = createHttpMedsStore();
