import { For, Match, Show, Switch } from 'solid-js';
import type { EntryParse, FoodNumbers, Proposal } from '../lib/inbox/types';
import Button from './Button';
import ProposalRow from './ProposalRow';
import styles from './EntryParseSection.module.css';

export interface EntryParseSectionProps {
  parse: EntryParse | undefined;
  disabled: boolean;
  onParse: () => void;
  onAccept: (proposal: Proposal, food?: FoodNumbers) => void;
  onReject: (proposal: Proposal) => void;
  onAcceptAll: (proposals: Proposal[]) => void;
}

/**
 * Plan 10 on a new Inbox entry: the parse agent's state and proposals. Nothing is logged until accepted; a new food
 * waits for its numbers and keeps the time captured from the entry.
 */
function EntryParseSection(props: EntryParseSectionProps) {
  const proposed = () => props.parse?.proposals.filter((p) => p.status === 'proposed') ?? [];
  /** Accept All takes what can be accepted as is: not new foods, which need numbers. */
  const acceptable = () => proposed().filter((p) => !(p.data.kind === 'food' && p.data.status === 'new'));
  const anyAccepted = () => props.parse?.proposals.some((p) => p.status === 'accepted') ?? false;

  return (
    <div class={styles.root}>
      <Switch>
        <Match when={!props.parse}>
          <Button variant="tinted" small disabled={props.disabled} onClick={() => props.onParse()}>
            Parse
          </Button>
        </Match>
        <Match when={props.parse?.status === 'running'}>
          <p class={styles.status} role="status">
            Reading…
          </p>
        </Match>
        <Match when={props.parse?.status === 'failed' && props.parse}>
          {(parse) => (
            <div class={styles.row}>
              <p class={styles.status}>
                Couldn't read this (<code>{parse().error ?? 'error'}</code>).
              </p>
              <Button variant="tinted" small disabled={props.disabled} onClick={() => props.onParse()}>
                Try Again
              </Button>
            </div>
          )}
        </Match>
        <Match when={props.parse?.status === 'done' && props.parse}>
          {(parse) => (
            <>
              <Show when={parse().proposals.length > 0} fallback={<p class={styles.status}>Nothing to log.</p>}>
                <ul class={styles.list}>
                  <For each={parse().proposals}>
                    {(proposal) => (
                      <ProposalRow
                        proposal={proposal}
                        disabled={props.disabled}
                        onAccept={(food) => props.onAccept(proposal, food)}
                        onReject={() => props.onReject(proposal)}
                      />
                    )}
                  </For>
                </ul>
              </Show>
              <div class={styles.row}>
                <span class={styles.model}>{parse().model}</span>
                <Show when={acceptable().length > 1}>
                  <Button variant="tinted" small disabled={props.disabled} onClick={() => props.onAcceptAll(acceptable())}>
                    Accept All
                  </Button>
                </Show>
                <Show when={!anyAccepted()}>
                  <Button variant="plain" small disabled={props.disabled} onClick={() => props.onParse()}>
                    Re-parse
                  </Button>
                </Show>
              </div>
            </>
          )}
        </Match>
      </Switch>
    </div>
  );
}

export default EntryParseSection;
