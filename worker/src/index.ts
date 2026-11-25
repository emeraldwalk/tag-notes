import type { Hono } from 'hono';
import { type AppEnv, createApp } from './app';
import { createTrackerAuth } from './auth';
import { pollLibreLinkUp } from './glucose';
import type { LluConfig } from './llu';

// One app per isolate: the IdP client caches its cookie key and the provider's discovery and keys.
let cached: { key: string; app: Hono<AppEnv> } | undefined;

function appFor(env: Env): Hono<AppEnv> {
  const key = [env.IDP_ISSUER, env.IDP_CLIENT_ID, env.BUILD_COMMIT, env.OWNER_USER_ID, env.HA_INGEST_TOKEN ?? ''].join('|');
  if (cached?.key !== key) {
    const auth = createTrackerAuth({
      issuer: env.IDP_ISSUER,
      clientId: env.IDP_CLIENT_ID,
      clientSecret: env.IDP_CLIENT_SECRET,
      cookieSecret: env.COOKIE_SECRET,
    });
    cached = {
      key,
      app: createApp({
        assets: env.ASSETS,
        auth,
        commit: env.BUILD_COMMIT.slice(0, 7),
        db: env.DB,
        haToken: env.HA_INGEST_TOKEN,
        ownerUserId: env.OWNER_USER_ID,
        timeZone: env.TZ_NAME,
      }),
    };
  }
  return cached.app;
}

export function lluConfig(env: Env): LluConfig | null {
  if (!env.LLU_EMAIL || !env.LLU_PASSWORD) return null;
  return { region: env.LLU_REGION, version: env.LLU_VERSION, email: env.LLU_EMAIL, password: env.LLU_PASSWORD };
}

export default {
  fetch(request, env) {
    return appFor(env).fetch(request, env);
  },
  async scheduled(_controller, env) {
    const result = await pollLibreLinkUp({
      db: env.DB,
      fetch: (input, init) => fetch(input, init),
      config: lluConfig(env),
      ownerUserId: env.OWNER_USER_ID,
    });
    // One line per run for Workers Logs: the outcome only, never the token, email or ids.
    console.log(JSON.stringify({ llu: result }));
  },
} satisfies ExportedHandler<Env>;
