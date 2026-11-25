import { createSignal, For, onMount, Show } from 'solid-js';
import { ApiError, errorMessage } from '../lib/api';
import { inboxStore } from '../lib/inbox/store-instance';
import { formatEntryTime } from '../lib/inbox/time';
import type { CreatedIngestToken, IngestToken } from '../lib/inbox/types';
import styles from './CaptureSourcesSection.module.css';

/**
 * Settings → Capture sources (plan 9): a token per thing that posts text to the Inbox (the Siri Shortcut, Home
 * Assistant). The secret is shown once, when added; revoking stops it working.
 */
function CaptureSourcesSection() {
  const [tokens, setTokens] = createSignal<IngestToken[]>([]);
  const [name, setName] = createSignal('');
  const [created, setCreated] = createSignal<CreatedIngestToken | undefined>();
  const [copied, setCopied] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | undefined>();

  const load = async () => {
    try {
      setTokens(await inboxStore.listTokens());
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  onMount(() => void load());

  const handleAdd = async (event: Event) => {
    event.preventDefault();
    const value = name().trim();
    if (!value) return;
    setBusy(true);
    setError(undefined);
    setCopied(false);
    try {
      setCreated(await inboxStore.createToken(value));
      setName('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'duplicate_name' ? 'There is already a capture source with that name.' : errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const handleCopy = async (secret: string) => {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
    } catch {
      setError('Could not copy. Select the token and copy it by hand.');
    }
  };

  const handleRevoke = async (token: IngestToken) => {
    if (!window.confirm(`Revoke "${token.name}"? Anything still using it will stop saving to the Inbox.`)) return;
    setBusy(true);
    setError(undefined);
    try {
      await inboxStore.revokeToken(token.id);
      if (created()?.token.id === token.id) setCreated(undefined);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class={styles.root}>
      <Show when={tokens().length > 0}>
        <ul class={styles.list}>
          <For each={tokens()}>
            {(token) => (
              <li class={styles.item} classList={{ [styles.revoked]: Boolean(token.revokedAt) }}>
                <div class={styles.details}>
                  <span class={styles.name}>{token.name}</span>
                  <span class={styles.meta}>
                    {token.revokedAt
                      ? `Revoked ${formatEntryTime(token.revokedAt)}`
                      : token.lastUsedAt
                        ? `Last used ${formatEntryTime(token.lastUsedAt)}`
                        : `Added ${formatEntryTime(token.createdAt)}, not used yet`}
                  </span>
                </div>
                <Show when={!token.revokedAt}>
                  <button type="button" class={styles.revoke} disabled={busy()} onClick={() => void handleRevoke(token)}>
                    Revoke
                  </button>
                </Show>
              </li>
            )}
          </For>
        </ul>
      </Show>

      <Show when={created()}>
        {(fresh) => (
          <div class={styles.secretBox} role="status">
            <p class={styles.secretTitle}>Token for "{fresh().token.name}"</p>
            <code class={styles.secret}>{fresh().secret}</code>
            <div class={styles.secretActions}>
              <button type="button" class={styles.button} onClick={() => void handleCopy(fresh().secret)}>
                {copied() ? 'Copied' : 'Copy'}
              </button>
              <button type="button" class={styles.button} onClick={() => setCreated(undefined)}>
                Done
              </button>
            </div>
            <p class={styles.warning}>You won't see this again. Put it in the Shortcut's Authorization header as "Bearer" and the token.</p>
          </div>
        )}
      </Show>

      <form class={styles.addForm} onSubmit={(event) => void handleAdd(event)}>
        <input
          class={styles.input}
          placeholder="Name, e.g. Siri"
          maxLength={40}
          value={name()}
          onInput={(event) => setName(event.currentTarget.value)}
        />
        <button type="submit" class={styles.button} disabled={busy() || name().trim() === ''}>
          Add
        </button>
      </form>

      <Show when={error()}>
        {(message) => (
          <p class={styles.error} role="alert">
            {message()}
          </p>
        )}
      </Show>

      <p class={styles.hint}>
        Each source (the Siri Shortcut, Home Assistant) gets its own token to post text to the Inbox. Entries show the
        source's name. The README has the Shortcut's steps.
      </p>
    </div>
  );
}

export default CaptureSourcesSection;
