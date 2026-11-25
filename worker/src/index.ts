import type { Hono } from 'hono';
import { type AppEnv, createApp } from './app';
import { createTrackerAuth } from './auth';

// One app per isolate: the IdP client caches its cookie key and the provider's discovery and keys.
let cached: { key: string; app: Hono<AppEnv> } | undefined;

function appFor(env: Env): Hono<AppEnv> {
  const key = `${env.IDP_ISSUER}|${env.IDP_CLIENT_ID}|${env.BUILD_COMMIT}`;
  if (cached?.key !== key) {
    const auth = createTrackerAuth({
      issuer: env.IDP_ISSUER,
      clientId: env.IDP_CLIENT_ID,
      clientSecret: env.IDP_CLIENT_SECRET,
      cookieSecret: env.COOKIE_SECRET,
    });
    cached = { key, app: createApp({ auth, commit: env.BUILD_COMMIT.slice(0, 7) }) };
  }
  return cached.app;
}

export default {
  fetch(request, env) {
    return appFor(env).fetch(request, env);
  },
} satisfies ExportedHandler<Env>;
