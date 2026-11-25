import { createSignal, For, onMount, Show } from 'solid-js';
import CaptureBox from '../components/CaptureBox';
import NavBar from '../components/NavBar';
import RawEntryCard from '../components/RawEntryCard';
import { errorMessage } from '../lib/api';
import { refreshInboxCount } from '../lib/inbox/count';
import { inboxStore } from '../lib/inbox/store-instance';
import type { RawEntry, RawEntryFilter, RawEntryStatus } from '../lib/inbox/types';
import styles from './Inbox.module.css';

const PAGE = 50;

export interface InboxProps {
  /** `new`: the Inbox (with the capture box). `filed`: done and dismissed entries. */
  view: 'new' | 'filed';
}

/**
 * Raw entries (plan 9): text from the Inbox box, Siri and Home Assistant, word for word. New ones are made into
 * notes, marked done (handled elsewhere) or dismissed; filed ones can be moved back.
 */
function Inbox(props: InboxProps) {
  const [entries, setEntries] = createSignal<RawEntry[]>([]);
  const [loaded, setLoaded] = createSignal(false);
  const [more, setMore] = createSignal(false);
  const [busyId, setBusyId] = createSignal<string | undefined>();
  const [error, setError] = createSignal<string | undefined>();

  const isNewView = () => props.view === 'new';
  /** The filed view lists done and dismissed together: all, minus new. */
  const filter = (): RawEntryFilter => (isNewView() ? 'new' : 'all');
  const belongs = (entry: RawEntry) => (isNewView() ? entry.status === 'new' : entry.status !== 'new');

  /** Loads a page after `after` (or the first page), keeping only this view's entries. */
  const loadPage = async (after?: RawEntry) => {
    const page = await inboxStore.list(filter(), { after, limit: PAGE });
    setMore(page.length === PAGE);
    return { shown: page.filter(belongs), last: page.at(-1) };
  };

  let lastLoaded: RawEntry | undefined;

  const loadFirst = async () => {
    setError(undefined);
    try {
      const { shown, last } = await loadPage();
      lastLoaded = last;
      setEntries(shown);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoaded(true);
    }
  };

  const loadEarlier = async () => {
    try {
      const { shown, last } = await loadPage(lastLoaded);
      lastLoaded = last ?? lastLoaded;
      setEntries((list) => [...list, ...shown]);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  onMount(() => void loadFirst());

  /** Runs an action on one entry; on success replaces or removes it here and refreshes the tab's count. */
  const act = async (entry: RawEntry, action: () => Promise<RawEntry | undefined>) => {
    setBusyId(entry.id);
    setError(undefined);
    try {
      const updated = await action();
      setEntries((list) =>
        updated && belongs(updated) ? list.map((e) => (e.id === entry.id ? updated : e)) : list.filter((e) => e.id !== entry.id),
      );
      void refreshInboxCount();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId(undefined);
    }
  };

  const handleSave = async (text: string) => {
    const entry = await inboxStore.create(text);
    setEntries((list) => [entry, ...list]);
    void refreshInboxCount();
  };

  const handleMakeNote = (entry: RawEntry) => act(entry, async () => (await inboxStore.makeNote(entry.id)).entry);
  const handleStatus = (entry: RawEntry, status: RawEntryStatus) => act(entry, () => inboxStore.setStatus(entry.id, status));
  const handleDelete = (entry: RawEntry) => {
    if (!window.confirm('Delete this entry? Its words are gone for good.')) return;
    void act(entry, async () => {
      await inboxStore.remove(entry.id);
      return undefined;
    });
  };

  return (
    <div class={styles.container}>
      <Show
        when={isNewView()}
        fallback={<NavBar title="Done and dismissed" backHref="/inbox" backLabel="Inbox" />}
      >
        <NavBar title="Inbox" action={{ label: 'Filed', href: '/inbox/filed' }} />
      </Show>
      <div class={styles.body}>
        <Show when={isNewView()}>
          <CaptureBox onSave={handleSave} />
        </Show>

        <Show when={error()}>
          {(message) => (
            <p class={styles.error} role="alert">
              {message()}
            </p>
          )}
        </Show>

        <Show
          when={entries().length > 0}
          fallback={
            <p class={styles.empty}>
              {loaded() ? (isNewView() ? 'Nothing new. Say "Hey Siri, Tracker" or type above.' : 'Nothing filed yet.') : ''}
            </p>
          }
        >
          <ul class={styles.list}>
            <For each={entries()}>
              {(entry) => (
                <RawEntryCard
                  entry={entry}
                  disabled={busyId() === entry.id}
                  onMakeNote={() => void handleMakeNote(entry)}
                  onSetStatus={(status) => void handleStatus(entry, status)}
                  onDelete={() => handleDelete(entry)}
                />
              )}
            </For>
          </ul>
        </Show>

        <Show when={more()}>
          <button type="button" class={styles.more} onClick={() => void loadEarlier()}>
            Load earlier
          </button>
        </Show>
      </div>
    </div>
  );
}

export default Inbox;
