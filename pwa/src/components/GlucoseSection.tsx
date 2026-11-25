import { createResource, Show } from 'solid-js';
import { getGlucoseStatus } from '../lib/account';
import { errorMessage } from '../lib/api';
import Message from './Message';
import styles from './GlucoseSection.module.css';

const ARROWS: Record<number, string> = { 1: '↓', 2: '↘', 3: '→', 4: '↗', 5: '↑' };

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'never';

/** Plan 14's glucose status (last reading, LibreLinkUp poller), moved here from the Worker's placeholder page. */
function GlucoseSection() {
  const [status] = createResource(getGlucoseStatus);

  return (
    <div class={styles.root}>
      <Message kind="error" text={status.error ? errorMessage(status.error) : undefined} />
      <Show when={status()}>
        {(s) => (
          <dl class={styles.list}>
            <dt>Last reading</dt>
            <dd>
              <Show when={s().lastReading} fallback="No readings yet">
                {(r) => (
                  <>
                    {r().mgDl} mg/dL {r().trend ? (ARROWS[r().trend!] ?? '') : ''}{' '}
                    <span class={styles.dim}>at {when(r().ts)}</span>
                  </>
                )}
              </Show>
            </dd>
            <dt>LibreLinkUp</dt>
            <dd>
              Last run {when(s().llu.lastRunAt)} · last success {when(s().llu.lastOkAt)}
              <Show when={s().llu.lastError}>
                {(code) => (
                  <>
                    {' '}
                    · error <code>{code()}</code>
                  </>
                )}
              </Show>
              <Show when={s().llu.backoffUntil}>{(until) => <> · paused until {when(until())}</>}</Show>
            </dd>
          </dl>
        )}
      </Show>
    </div>
  );
}

export default GlucoseSection;
