import { A } from '@solidjs/router';
import { createSignal, Match, Show, Switch } from 'solid-js';
import type { FoodNumbers, Proposal, ProposalData } from '../lib/inbox/types';
import { formatEntryTime } from '../lib/inbox/time';
import Button from './Button';
import FoodNumbersForm from './FoodNumbersForm';
import styles from './ProposalRow.module.css';

export interface ProposalRowProps {
  proposal: Proposal;
  disabled: boolean;
  onAccept: (food?: FoodNumbers) => void;
  onReject: () => void;
}

const round = (n: number, places = 0) => {
  const f = 10 ** places;
  return Math.round(n * f) / f;
};

/** One line describing what a proposal would log. */
export function describeProposal(data: ProposalData): string {
  switch (data.kind) {
    case 'food': {
      const head = `${round(data.quantity, 2)} × ${data.name}`;
      if (data.status === 'new') return `${head} · ${formatEntryTime(data.eatenAt)}`;
      const q = data.quantity;
      const serving = data.servingSize ? ` (${data.servingSize})` : '';
      return `${head}${serving} · ${round(data.calories * q)} kcal, ${round(data.protein * q, 1)} g protein, ${round(data.carbs * q, 1)} g carbs · ${formatEntryTime(data.eatenAt)}`;
    }
    case 'dose':
      return `${data.medicineName}${data.dose ? ` ${data.dose}` : ''} · ${formatEntryTime(data.takenAt)}`;
    case 'note':
      return `Note: ${data.text.split('\n')[0]}`;
  }
}

/** Where an accepted proposal's row can be seen. */
function outcomeLink(p: Proposal): string | undefined {
  if (!p.outcomeId) return undefined;
  if (p.data.kind === 'food') return '/food/history';
  if (p.data.kind === 'dose') return '/meds';
  return `/notes/${encodeURIComponent(p.outcomeId)}?from=inbox`;
}

/** A proposal on an Inbox entry (plan 10): what it would log, and Accept / Reject, or Add Numbers for a new food. */
function ProposalRow(props: ProposalRowProps) {
  const [editing, setEditing] = createSignal(false);
  const needsNumbers = () => props.proposal.data.kind === 'food' && props.proposal.data.status === 'new';

  return (
    <li class={styles.row} classList={{ [styles.decided]: props.proposal.status !== 'proposed' }}>
      <div class={styles.line}>
        <span class={styles.text}>{describeProposal(props.proposal.data)}</span>
        <Show when={needsNumbers() && props.proposal.status === 'proposed'}>
          <span class={styles.badge}>Needs numbers</span>
        </Show>
      </div>
      <Switch>
        <Match when={props.proposal.status === 'accepted'}>
          <span class={styles.state}>
            Accepted
            <Show when={outcomeLink(props.proposal)}>
              {(href) => (
                <>
                  {' · '}
                  <A href={href()}>Open ›</A>
                </>
              )}
            </Show>
          </span>
        </Match>
        <Match when={props.proposal.status === 'rejected'}>
          <span class={styles.state}>Rejected</span>
        </Match>
        <Match when={editing() && props.proposal.data.kind === 'food' && props.proposal.data}>
          {(food) => (
            <FoodNumbersForm
              name={food().name}
              quantity={food().quantity}
              eatenAt={food().eatenAt}
              disabled={props.disabled}
              onSave={(numbers) => props.onAccept(numbers)}
              onCancel={() => setEditing(false)}
            />
          )}
        </Match>
        <Match when={true}>
          <div class={styles.actions}>
            <Show
              when={needsNumbers()}
              fallback={
                <Button variant="tinted" small disabled={props.disabled} onClick={() => props.onAccept()}>
                  Accept
                </Button>
              }
            >
              <Button variant="tinted" small disabled={props.disabled} onClick={() => setEditing(true)}>
                Add Numbers
              </Button>
            </Show>
            <Button variant="gray" small disabled={props.disabled} onClick={() => props.onReject()}>
              Reject
            </Button>
          </div>
        </Match>
      </Switch>
    </li>
  );
}

export default ProposalRow;
