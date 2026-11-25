import { createResource, Show } from 'solid-js';
import { getMe, LOGOUT_URL } from '../lib/account';
import { errorMessage } from '../lib/api';
import styles from './AccountSection.module.css';

/** Who is signed in, the build, and Sign out. */
function AccountSection() {
  const [me] = createResource(getMe);

  return (
    <div class={styles.root}>
      <Show when={me.error}>
        <p class={styles.error}>{errorMessage(me.error)}</p>
      </Show>
      <Show when={me()}>
        {(m) => (
          <dl class={styles.list}>
            <dt>Name</dt>
            <dd>{m().name}</dd>
            <dt>User id</dt>
            <dd>
              <code class={styles.id}>{m().sub}</code>
            </dd>
            <dt>Server build</dt>
            <dd>{m().build}</dd>
            <dt>App build</dt>
            <dd>{__APP_BUILD__}</dd>
          </dl>
        )}
      </Show>
      {/* rel="external": a full page load to the Worker, not a client-side route. */}
      <a class={styles.signOut} href={LOGOUT_URL} rel="external">
        Sign out
      </a>
    </div>
  );
}

export default AccountSection;
