import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import Button from '../components/Button';
import CaptureBox from '../components/CaptureBox';
import EmptyState from '../components/EmptyState';
import ListSection from '../components/ListSection';
import Message from '../components/Message';
import NavButton from '../components/NavButton';
import Page from '../components/Page';
import RawEntryCard from '../components/RawEntryCard';
import { errorMessage } from '../lib/api';
import { refreshInboxCount } from '../lib/inbox/count';
import { inboxStore } from '../lib/inbox/store-instance';
import type { FoodNumbers, Proposal, RawEntry, RawEntryFilter, RawEntryStatus } from '../lib/inbox/types';

const PAGE = 50;
/** While an entry is being read (plan 10), the list is re-fetched this often, for at most `POLL_FOR_MS`. */
const POLL_EVERY_MS = 3000;
const POLL_FOR_MS = 60_000;

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
      if (anyReading()) poll();
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

  /** A just-saved entry is parsed in the background: show it as being read until the list says otherwise. */
  const reading = (entry: RawEntry): RawEntry =>
    entry.parse ? entry : { ...entry, parse: { runId: '', status: 'running', model: '', startedAt: new Date().toISOString(), proposals: [] } };

  // Polls the first page while anything shown is being read, then stops (and after POLL_FOR_MS regardless).
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let pollUntil = 0;
  const anyReading = () => entries().some((e) => e.parse?.status === 'running');
  const poll = () => {
    if (pollTimer !== undefined) return;
    pollUntil = Date.now() + POLL_FOR_MS;
    const tick = async () => {
      pollTimer = undefined;
      try {
        const fresh = new Map((await inboxStore.list(filter(), { limit: PAGE })).map((e) => [e.id, e]));
        setEntries((list) => list.map((e) => fresh.get(e.id) ?? e));
      } catch {
        // The next action or reload shows any error.
      }
      if (anyReading() && Date.now() < pollUntil) pollTimer = setTimeout(() => void tick(), POLL_EVERY_MS);
    };
    pollTimer = setTimeout(() => void tick(), POLL_EVERY_MS);
  };
  onCleanup(() => clearTimeout(pollTimer));

  /** Runs an action on one entry; on success replaces or removes it here and refreshes the tab's count. */
  const act = async (entry: RawEntry, action: () => Promise<RawEntry | undefined>) => {
    setBusyId(entry.id);
    setError(undefined);
    try {
      const result = await action();
      // Status changes answer without the parse; keep the one shown.
      const updated = result && !result.parse && entry.parse ? { ...result, parse: entry.parse } : result;
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
    setEntries((list) => [reading(entry), ...list]);
    void refreshInboxCount();
    poll();
  };

  const handleMakeNote = (entry: RawEntry) => act(entry, async () => (await inboxStore.makeNote(entry.id)).entry);
  const handleStatus = (entry: RawEntry, status: RawEntryStatus) => act(entry, () => inboxStore.setStatus(entry.id, status));
  const handleParse = (entry: RawEntry) => act(entry, () => inboxStore.parse(entry.id));
  const handleAccept = (entry: RawEntry, proposal: Proposal, food?: FoodNumbers) =>
    act(entry, async () => (await inboxStore.acceptProposal(proposal.id, food)).entry);
  const handleReject = (entry: RawEntry, proposal: Proposal) => act(entry, async () => (await inboxStore.rejectProposal(proposal.id)).entry);
  /** One at a time, so a failure stops the rest and what was accepted stays accepted. */
  const handleAcceptAll = (entry: RawEntry, proposals: Proposal[]) =>
    act(entry, async () => {
      let latest: RawEntry | undefined;
      for (const proposal of proposals) latest = (await inboxStore.acceptProposal(proposal.id)).entry;
      return latest;
    });
  const handleDelete = (entry: RawEntry) => {
    if (!window.confirm('Delete this entry? Its words are gone for good.')) return;
    void act(entry, async () => {
      await inboxStore.remove(entry.id);
      return undefined;
    });
  };

  return (
    <Page
      title={isNewView() ? 'Inbox' : 'Filed'}
      large={isNewView()}
      back={isNewView() ? undefined : { href: '/inbox', label: 'Inbox' }}
      trailing={isNewView() ? <NavButton href="/inbox/filed">Filed</NavButton> : undefined}
    >
      <Show when={isNewView()}>
        <CaptureBox onSave={handleSave} />
      </Show>

      <Message kind="error" text={error()} />

      <Show when={loaded()}>
        <Show
          when={entries().length > 0}
          fallback={
            <EmptyState>
              {isNewView() ? 'Nothing new. Say "Hey Siri, Tracker" or type above.' : 'Done and dismissed entries show up here.'}
            </EmptyState>
          }
        >
          <ListSection>
            <For each={entries()}>
              {(entry) => (
                <RawEntryCard
                  entry={entry}
                  disabled={busyId() === entry.id}
                  onMakeNote={() => void handleMakeNote(entry)}
                  onSetStatus={(status) => void handleStatus(entry, status)}
                  onDelete={() => handleDelete(entry)}
                  onParse={() => void handleParse(entry)}
                  onAccept={(proposal, food) => void handleAccept(entry, proposal, food)}
                  onReject={(proposal) => void handleReject(entry, proposal)}
                  onAcceptAll={(proposals) => void handleAcceptAll(entry, proposals)}
                />
              )}
            </For>
          </ListSection>
        </Show>
      </Show>

      <Show when={more()}>
        <Button variant="plain" onClick={() => void loadEarlier()}>
          Load Earlier
        </Button>
      </Show>
    </Page>
  );
}

export default Inbox;
