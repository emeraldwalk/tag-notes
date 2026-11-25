import { A } from '@solidjs/router';
import { Show } from 'solid-js';
import type { RawEntry, RawEntryStatus } from '../lib/inbox/types';
import { formatEntryTime } from '../lib/inbox/time';
import styles from './RawEntryCard.module.css';

export interface RawEntryCardProps {
  entry: RawEntry;
  disabled: boolean;
  onMakeNote: () => void;
  onSetStatus: (status: RawEntryStatus) => void;
  onDelete: () => void;
}

const STATUS_LABEL: Record<RawEntryStatus, string> = { new: 'New', done: 'Done', dismissed: 'Dismissed' };

/** One raw entry: its words, when and where from, and what can be done with it. */
function RawEntryCard(props: RawEntryCardProps) {
  const isNew = () => props.entry.status === 'new';

  return (
    <li class={styles.card} classList={{ [styles.filed]: !isNew() }}>
      <p class={styles.text}>{props.entry.text}</p>
      <div class={styles.meta}>
        <span>{formatEntryTime(props.entry.occurredAt)}</span>
        <span>·</span>
        <span>{props.entry.source === 'app' ? 'Typed' : props.entry.source}</span>
        <Show when={!isNew()}>
          <span>·</span>
          <span>{STATUS_LABEL[props.entry.status]}</span>
        </Show>
        <Show when={props.entry.outcomeKind === 'note' && props.entry.outcomeId}>
          {(noteId) => (
            <A class={styles.outcome} href={`/notes/${encodeURIComponent(noteId())}`}>
              Open note
            </A>
          )}
        </Show>
      </div>
      <div class={styles.actions}>
        <Show
          when={isNew()}
          fallback={
            <button type="button" class={styles.action} disabled={props.disabled} onClick={() => props.onSetStatus('new')}>
              Move back to Inbox
            </button>
          }
        >
          <Show when={!props.entry.outcomeKind}>
            <button type="button" class={styles.action} disabled={props.disabled} onClick={() => props.onMakeNote()}>
              Note
            </button>
          </Show>
          <button type="button" class={styles.action} disabled={props.disabled} onClick={() => props.onSetStatus('done')}>
            Done
          </button>
          <button type="button" class={styles.action} disabled={props.disabled} onClick={() => props.onSetStatus('dismissed')}>
            Dismiss
          </button>
        </Show>
        <button type="button" class={styles.delete} disabled={props.disabled} onClick={() => props.onDelete()}>
          Delete
        </button>
      </div>
    </li>
  );
}

export default RawEntryCard;
