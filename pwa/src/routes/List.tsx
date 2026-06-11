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

  const refreshTags = async () => {
    setTags(await noteStore.listTags());
  };

  const refreshNotes = async () => {
    const tag = activeTag();
    setNotes(tag ? await noteStore.listByTag(tag) : await noteStore.list());
  };

  const refreshAll = async () => {
    await Promise.all([refreshTags(), refreshNotes()]);
  };

  onMount(() => {
    void refreshAll();
  });

  const handleTagClick = (tag: string) => {
    setActiveTag((current) => (current === tag ? undefined : tag));
    void refreshNotes();
  };

  const formatTimestamp = (iso: string) => new Date(iso).toLocaleString();

  return (
    <div class={styles.container}>
      <Show when={tags().length > 0}>
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
        </div>
      </Show>

      <Show
        when={notes().length > 0}
        fallback={
          <div class={styles.emptyState}>
            {activeTag() ? 'No notes with this tag' : 'No notes yet'}
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
