import { A } from '@solidjs/router';
import { createMemo, createSignal, For, onMount, Show } from 'solid-js';
import EmptyState from '../components/EmptyState';
import ListSection from '../components/ListSection';
import Message from '../components/Message';
import NavBar from '../components/NavBar';
import NavButton from '../components/NavButton';
import Page from '../components/Page';
import { errorMessage } from '../lib/api';
import { formatEntryTime } from '../lib/inbox/time';
import { noteStore } from '../lib/notes/store-instance';
import type { Note } from '../lib/notes/types';
import styles from './NoteHistory.module.css';

/** The "No tags" filter (not a real tag: tags can't hold a NUL). */
const UNTAGGED = '\u0000untagged';

/** The Notes tab: every note, newest first, filtered by tag or search; compose in the nav bar. */
function NoteHistory() {
  const [all, setAll] = createSignal<Note[]>([]);
  const [tags, setTags] = createSignal<string[]>([]);
  /** A tag, `UNTAGGED`, or none. */
  const [filter, setFilter] = createSignal<string | undefined>();
  const [searchQuery, setSearchQuery] = createSignal('');
  const [loaded, setLoaded] = createSignal(false);
  const [error, setError] = createSignal<string | undefined>();

  onMount(async () => {
    try {
      const [notes, tagList] = await Promise.all([noteStore.list(), noteStore.listTags()]);
      setAll(notes);
      setTags(tagList);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoaded(true);
    }
  });

  const hasUntagged = createMemo(() => all().some((note) => note.tags.length === 0));

  const visibleNotes = createMemo(() => {
    const active = filter();
    const query = searchQuery().trim().toLowerCase();
    return all().filter(
      (note) =>
        (active === undefined || (active === UNTAGGED ? note.tags.length === 0 : note.tags.includes(active))) &&
        (!query || note.rawText.toLowerCase().includes(query)),
    );
  });

  const toggle = (value: string) => setFilter((current) => (current === value ? undefined : value));

  const emptyText = () =>
    searchQuery().trim()
      ? 'No notes match your search.'
      : filter() === UNTAGGED
        ? 'No notes without tags.'
        : filter()
          ? 'No notes with this tag.'
          : 'No notes yet. Tap the pencil to write one.';

  return (
    <Page
      nav={
        <NavBar
          title="Notes"
          trailing={
            <NavButton href="/notes/new" label="New note">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
            </NavButton>
          }
        />
      }
    >
      <div class={styles.filters}>
        <input
          type="search"
          class={styles.search}
          placeholder="Search"
          aria-label="Search notes"
          value={searchQuery()}
          onInput={(event) => setSearchQuery(event.currentTarget.value)}
        />

        <Show when={tags().length > 0 || hasUntagged()}>
          <div class={styles.chips} role="group" aria-label="Filter by tag">
            <For each={tags()}>
              {(tag) => (
                <button
                  type="button"
                  class={styles.chip}
                  classList={{ [styles.chipActive]: filter() === tag }}
                  aria-pressed={filter() === tag}
                  onClick={() => toggle(tag)}
                >
                  {tag}
                </button>
              )}
            </For>
            <Show when={hasUntagged()}>
              <button
                type="button"
                class={styles.chip}
                classList={{ [styles.chipActive]: filter() === UNTAGGED }}
                aria-pressed={filter() === UNTAGGED}
                onClick={() => toggle(UNTAGGED)}
              >
                No tags
              </button>
            </Show>
          </div>
        </Show>
      </div>

      <Message kind="error" text={error()} />

      <Show when={loaded()}>
        <Show when={visibleNotes().length > 0} fallback={<EmptyState>{emptyText()}</EmptyState>}>
          <ListSection>
            <For each={visibleNotes()}>
              {(note) => (
                <A href={`/notes/${encodeURIComponent(note.id)}`} class={styles.row}>
                  <span class={styles.main}>
                    <span class={styles.title} classList={{ [styles.untitled]: note.title.trim() === '' }}>
                      {note.title.trim() || 'Untitled'}
                    </span>
                    <span class={styles.meta}>
                      <span>{formatEntryTime(note.updatedAt)}</span>
                      <For each={note.tags}>{(tag) => <span class={styles.tag}>{tag}</span>}</For>
                    </span>
                  </span>
                  <span class={styles.chevron} aria-hidden="true">
                    ›
                  </span>
                </A>
              )}
            </For>
          </ListSection>
        </Show>
      </Show>
    </Page>
  );
}

export default NoteHistory;
