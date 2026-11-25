import { createSignal, For, onMount, Show } from 'solid-js';
import { ApiError, errorMessage } from '../lib/api';
import { inboxStore } from '../lib/inbox/store-instance';
import { formatEntryTime } from '../lib/inbox/time';
import type { CreatedIngestToken, IngestToken } from '../lib/inbox/types';
import Button from './Button';
import Message from './Message';
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

  // A fragment: each row is a direct child of the Settings card, so the card draws the hairlines between them.
  return (
    <>
      <For each={tokens()}>
        {(token) => (
          <div class={styles.item} classList={{ [styles.revoked]: Boolean(token.revokedAt) }}>
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
              <Button variant="plain" small class={styles.revoke} disabled={busy()} onClick={() => void handleRevoke(token)}>
                Revoke
              </Button>
            </Show>
          </div>
        )}
      </For>

      <Show when={created()}>
        {(fresh) => (
          <div class={styles.secretBox} role="status">
            <p class={styles.secretTitle}>Token for "{fresh().token.name}"</p>
            <code class={styles.secret}>{fresh().secret}</code>
            <div class={styles.secretActions}>
              <Button variant="tinted" small onClick={() => void handleCopy(fresh().secret)}>
                {copied() ? 'Copied' : 'Copy'}
              </Button>
              <Button variant="gray" small onClick={() => setCreated(undefined)}>
                Done
              </Button>
            </div>
            <p class={styles.warning}>You won't see this again. Put it in the Shortcut's Authorization header as "Bearer" and the token.</p>
          </div>
        )}
      </Show>

      <form class={styles.addForm} onSubmit={(event) => void handleAdd(event)}>
        <input
          placeholder="New source, e.g. Siri"
          aria-label="New capture source name"
          maxLength={40}
          value={name()}
          onInput={(event) => setName(event.currentTarget.value)}
        />
        <Button type="submit" variant="tinted" disabled={busy() || name().trim() === ''}>
          Add
        </Button>
        <div class={styles.message}>
          <Message kind="error" text={error()} />
        </div>
      </form>
    </>
  );
}

export default CaptureSourcesSection;
