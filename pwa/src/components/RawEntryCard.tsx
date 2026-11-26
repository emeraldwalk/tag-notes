import { A } from '@solidjs/router';
import { Show } from 'solid-js';
import type { FoodNumbers, Proposal, RawEntry, RawEntryStatus } from '../lib/inbox/types';
import { formatEntryTime } from '../lib/inbox/time';
import Button from './Button';
import EntryParseSection from './EntryParseSection';
import styles from './RawEntryCard.module.css';

export interface RawEntryCardProps {
  entry: RawEntry;
  disabled: boolean;
  onMakeNote: () => void;
  onSetStatus: (status: RawEntryStatus) => void;
  onDelete: () => void;
  /** Plan 10: parse now (or again). */
  onParse: () => void;
  onAccept: (proposal: Proposal, food?: FoodNumbers) => void;
  onReject: (proposal: Proposal) => void;
  onAcceptAll: (proposals: Proposal[]) => void;
}

const STATUS_LABEL: Record<RawEntryStatus, string> = { new: 'New', done: 'Done', dismissed: 'Dismissed' };

/** One raw entry (a row of the Inbox list): its words, when and where from, and what can be done with it. */
function RawEntryCard(props: RawEntryCardProps) {
  const isNew = () => props.entry.status === 'new';

  return (
    <div class={styles.card} classList={{ [styles.filed]: !isNew() }}>
      <p class={styles.text}>{props.entry.text}</p>
      <div class={styles.meta}>
        <span>{formatEntryTime(props.entry.occurredAt)}</span>
        <span aria-hidden="true">·</span>
        <span>{props.entry.source === 'app' ? 'Typed' : props.entry.source}</span>
        <Show when={!isNew()}>
          <span aria-hidden="true">·</span>
          <span>{STATUS_LABEL[props.entry.status]}</span>
        </Show>
        <Show when={props.entry.outcomeKind === 'proposals'}>
          <span aria-hidden="true">·</span>
          <span>Logged</span>
        </Show>
        <Show when={props.entry.outcomeKind === 'note' && props.entry.outcomeId}>
          {(noteId) => (
            <A class={styles.outcome} href={`/notes/${encodeURIComponent(noteId())}?from=inbox`}>
              Open Note ›
            </A>
          )}
        </Show>
      </div>
      <Show when={isNew()}>
        <EntryParseSection
          parse={props.entry.parse}
          disabled={props.disabled}
          onParse={() => props.onParse()}
          onAccept={(proposal, food) => props.onAccept(proposal, food)}
          onReject={(proposal) => props.onReject(proposal)}
          onAcceptAll={(proposals) => props.onAcceptAll(proposals)}
        />
      </Show>
      <div class={styles.actions}>
        <Show
          when={isNew()}
          fallback={
            <Button variant="gray" small disabled={props.disabled} onClick={() => props.onSetStatus('new')}>
              Move to Inbox
            </Button>
          }
        >
          <Show when={!props.entry.outcomeKind}>
            <Button variant="tinted" small disabled={props.disabled} onClick={() => props.onMakeNote()}>
              Make Note
            </Button>
          </Show>
          <Button variant="gray" small disabled={props.disabled} onClick={() => props.onSetStatus('done')}>
            Done
          </Button>
          <Button variant="gray" small disabled={props.disabled} onClick={() => props.onSetStatus('dismissed')}>
            Dismiss
          </Button>
        </Show>
        <Button variant="plain" small class={styles.delete} disabled={props.disabled} onClick={() => props.onDelete()}>
          Delete
        </Button>
      </div>
    </div>
  );
}

export default RawEntryCard;
