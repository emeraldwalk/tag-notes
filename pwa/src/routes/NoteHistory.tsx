import { createMemo, createSignal, For, onMount, Show } from 'solid-js';
import EmptyState from '../components/EmptyState';
import ListSection from '../components/ListSection';
import Message from '../components/Message';
import ListRow from '../components/ListRow';
import NavButton from '../components/NavButton';
import Page from '../components/Page';
import SearchField from '../components/SearchField';
import { errorMessage } from '../lib/api';
import { groupBySection, listDate } from '../lib/notes/sections';
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
          : 'No notes yet. Tap the compose button to write one.';

  const sections = createMemo(() => groupBySection(visibleNotes(), (note) => note.updatedAt));

  return (
    <Page
      title="Notes"
      large
      trailing={
        <NavButton href="/notes/new" label="New note">
          <ComposeIcon />
        </NavButton>
      }
    >
      <div class={styles.filters}>
        <SearchField label="Search notes" value={searchQuery()} onInput={setSearchQuery} />

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
                  #{tag}
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
        <Show when={sections().length > 0} fallback={<EmptyState>{emptyText()}</EmptyState>}>
          <For each={sections()}>
            {(group) => (
              <ListSection title={group.section.label} prominent>
                <For each={group.items}>
                  {(note) => (
                    <ListRow
                      href={`/notes/${encodeURIComponent(note.id)}`}
                      title={note.title.trim() || 'Untitled'}
                      detail={listDate(note.updatedAt)}
                      subtitle={preview(note)}
                    />
                  )}
                </For>
              </ListSection>
            )}
          </For>
        </Show>
      </Show>
    </Page>
  );
}

/** The gray line under a note's title: its first line of text and its tags, like iOS Notes' preview. */
function preview(note: Note): string {
  const firstLine = note.body.split('\n').find((line) => line.trim() !== '')?.trim();
  const tags = note.tags.map((tag) => `#${tag}`).join(' ');
  return [firstLine, tags].filter(Boolean).join(' · ') || 'No additional text';
}

/** Square-and-pencil, the iOS compose glyph. */
function ComposeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M11 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5" />
      <path d="M17.5 2.5a2.12 2.12 0 0 1 3 3L12 14l-4 1 1-4Z" />
    </svg>
  );
}

export default NoteHistory;
