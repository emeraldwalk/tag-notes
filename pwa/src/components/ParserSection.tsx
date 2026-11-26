import { createEffect, createResource, createSignal, For, on, onMount, Show } from 'solid-js';
import { errorMessage } from '../lib/api';
import { inboxStore } from '../lib/inbox/store-instance';
import { listParseModels, tryParse } from '../lib/inbox/store';
import type { ParseTryResult } from '../lib/inbox/types';
import Button from './Button';
import Message from './Message';
import { describeProposal } from './ProposalRow';
import styles from './ParserSection.module.css';

/**
 * Plan 10: compare the parse models on a real text, side by side. Uses my medicines and foods; saves nothing. The
 * default model is `PARSE_MODEL` in `worker/wrangler.jsonc`.
 */
function ParserSection() {
  const [info] = createResource(listParseModels);
  const [text, setText] = createSignal('');
  const [chosen, setChosen] = createSignal<Set<string>>(new Set());
  const [results, setResults] = createSignal<ParseTryResult[]>([]);
  const [running, setRunning] = createSignal<string | undefined>();
  const [error, setError] = createSignal<string | undefined>();

  onMount(async () => {
    try {
      const [latest] = await inboxStore.list('all', { limit: 1 });
      if (latest && text() === '') setText(latest.text);
    } catch {
      // An empty box is fine.
    }
  });

  const available = () => info()?.models.filter((m) => m.available) ?? [];
  const selected = () => available().filter((m) => chosen().has(m.id));
  // Every model that can be called starts ticked.
  createEffect(on(info, (i) => i && setChosen(new Set(i.models.filter((m) => m.available).map((m) => m.id)))));

  const toggle = (id: string) =>
    setChosen((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const handleTry = async () => {
    const value = text().trim();
    if (!value) return;
    setResults([]);
    setError(undefined);
    try {
      for (const model of selected()) {
        setRunning(model.id);
        const result = await tryParse(value, model.id);
        setResults((list) => [...list, result]);
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setRunning(undefined);
    }
  };

  return (
    <div class={styles.root}>
      <Message kind="error" text={info.error ? errorMessage(info.error) : error()} />
      <Show when={info()}>
        {(i) => (
          <ul class={styles.models}>
            <For each={i().models}>
              {(m) => (
                <li>
                  <label class={styles.model} classList={{ [styles.unavailable]: !m.available }}>
                    <input
                      type="checkbox"
                      disabled={!m.available}
                      checked={chosen().has(m.id)}
                      onChange={() => toggle(m.id)}
                    />
                    <span>
                      {m.id}
                      {m.id === i().default ? ' (default)' : ''}
                    </span>
                    <span class={styles.ref}>{m.available ? m.model : 'no API key set'}</span>
                  </label>
                </li>
              )}
            </For>
          </ul>
        )}
      </Show>
      <textarea
        class={styles.text}
        rows={3}
        aria-label="Text to try"
        placeholder="I had two eggs and toast for breakfast, took my metformin at 8"
        value={text()}
        onInput={(e) => setText(e.currentTarget.value)}
      />
      <Button variant="tinted" disabled={running() !== undefined || text().trim() === '' || selected().length === 0} onClick={() => void handleTry()}>
        {running() ? `Trying ${running()}…` : 'Try'}
      </Button>
      <For each={results()}>
        {(r) => (
          <div class={styles.result}>
            <p class={styles.head}>
              <strong>{r.model}</strong> · {(r.ms / 1000).toFixed(1)} s
              <Show when={r.inputTokens !== undefined}>
                {' '}
                · {r.inputTokens} in / {r.outputTokens} out tokens
              </Show>
            </p>
            <Show when={r.error}>
              {(code) => (
                <p class={styles.error}>
                  Failed: <code>{code()}</code>
                </p>
              )}
            </Show>
            <Show when={!r.error}>
              <Show when={r.proposals.length > 0} fallback={<p class={styles.line}>Nothing to log.</p>}>
                <ul class={styles.lines}>
                  <For each={r.proposals}>
                    {(p) => (
                      <li class={styles.line}>
                        {describeProposal(p)}
                        {p.kind === 'food' && p.status === 'new' ? ' · Needs numbers' : ''}
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </Show>
            <Show when={r.output}>
              {(output) => (
                <details>
                  <summary class={styles.line}>Raw answer</summary>
                  <pre class={styles.raw}>{output()}</pre>
                </details>
              )}
            </Show>
          </div>
        )}
      </For>
    </div>
  );
}

export default ParserSection;
