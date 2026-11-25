import { createSignal } from 'solid-js';
import { inboxStore } from './store-instance';

const [count, setCount] = createSignal(0);

/** How many raw entries are `new` (the Inbox tab's badge). */
export const inboxCount = count;

/** Reloads the count; failures leave the last one (the badge isn't worth an error). */
export async function refreshInboxCount(): Promise<void> {
  try {
    setCount(await inboxStore.countNew());
  } catch {
    // Signed out (the api wrapper redirects) or offline: keep what we had.
  }
}
