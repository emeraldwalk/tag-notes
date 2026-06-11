import { useNavigate } from '@solidjs/router';
import { createSignal, For, onMount, Show } from 'solid-js';
import { noteStore } from '../lib/notes/store-instance';
import type { Note } from '../lib/notes/types';
import styles from './List.module.css';

function List() {
  const navigate = useNavigate();

  const [notes, setNotes] = createSignal<Note[]>([]);
  const [tags, setTags] = createSignal<string[]>([]);
  const [activeTag, setActiveTag] = createSignal<string | undefined>();
  const [untaggedOnly, setUntaggedOnly] = createSignal(false);
  const [hasUntagged, setHasUntagged] = createSignal(false);

  const refreshTags = async () => {
    setTags(await noteStore.listTags());
  };

  const refreshNotes = async () => {
    if (untaggedOnly()) {
      const all = await noteStore.list();
      setNotes(all.filter((note) => note.tags.length === 0));
      return;
    }
    const tag = activeTag();
    setNotes(tag ? await noteStore.listByTag(tag) : await noteStore.list());
  };

  const refreshHasUntagged = async () => {
    const all = await noteStore.list();
    setHasUntagged(all.some((note) => note.tags.length === 0));
  };

  const refreshAll = async () => {
    await Promise.all([refreshTags(), refreshNotes(), refreshHasUntagged()]);
  };

  onMount(() => {
    void refreshAll();
  });

  const handleTagClick = (tag: string) => {
    setUntaggedOnly(false);
    setActiveTag((current) => (current === tag ? undefined : tag));
    void refreshNotes();
  };

  const handleUntaggedClick = () => {
    setActiveTag(undefined);
    setUntaggedOnly((current) => !current);
    void refreshNotes();
  };

  const formatTimestamp = (iso: string) => new Date(iso).toLocaleString();

  return (
    <div class={styles.container}>
      <Show when={tags().length > 0 || hasUntagged()}>
        <div class={styles.tagFilter}>
          <For each={tags()}>
            {(tag) => (
              <button
                type="button"
                class={styles.tagChip}
                classList={{ [styles.tagChipActive]: activeTag() === tag }}
                onClick={() => handleTagClick(tag)}
              >
                {tag}
              </button>
            )}
          </For>
          <Show when={hasUntagged()}>
            <button
              type="button"
              class={styles.tagChip}
              classList={{ [styles.tagChipActive]: untaggedOnly() }}
              onClick={() => handleUntaggedClick()}
            >
              No tags
            </button>
          </Show>
        </div>
      </Show>

      <Show
        when={notes().length > 0}
        fallback={
          <div class={styles.emptyState}>
            {untaggedOnly()
              ? 'No notes without tags'
              : activeTag()
                ? 'No notes with this tag'
                : 'No notes yet'}
          </div>
        }
      >
        <div class={styles.list}>
          <For each={notes()}>
            {(note) => (
              <button
                type="button"
                class={styles.row}
                onClick={() => navigate(`/notes/${note.id}`)}
              >
                <Show
                  when={note.title.trim() !== ''}
                  fallback={<div class={`${styles.title} ${styles.titlePlaceholder}`}>Untitled</div>}
                >
                  <div class={styles.title}>{note.title}</div>
                </Show>
                <div class={styles.meta}>{formatTimestamp(note.updatedAt)}</div>
                <Show when={note.tags.length > 0}>
                  <div class={styles.tags}>
                    <For each={note.tags}>{(tag) => <span class={styles.tag}>{tag}</span>}</For>
                  </div>
                </Show>
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

export default List;
