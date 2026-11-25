import type { AppSession, AuthClient } from '@emeraldwalk/idp-client';
import { authRoutes, requireAuth } from '@emeraldwalk/idp-client/hono';
import { Hono } from 'hono';
import { foodsApi } from './foods';
import { glucoseApi, glucoseIngest } from './glucoseRoutes';
import { jsonError, withCookie } from './http';
import { importApi } from './import';
import { inboxApi, textIngest } from './inbox';
import { medsApi } from './meds';
import { notesApi } from './notes';

/** The static assets binding (the built PWA), or a stand-in in tests. */
export interface Assets {
  fetch(request: Request): Promise<Response>;
}

export interface AppDeps {
  /** The PWA's built files (`env.ASSETS`), with single-page-app fallback to `index.html`. */
  assets: Assets;
  auth: AuthClient;
  /** Short commit of this build, or "dev". */
  commit: string;
  db: D1Database;
  /** Home Assistant's bearer token for `POST /api/ingest/glucose`; unset refuses every glucose push. */
  haToken: string | undefined;
  /** The IdP sub that pushed and polled readings belong to (the cron and HA have no session). */
  ownerUserId: string;
  /** IANA zone for local dates (the import's `eatenAt` rule). */
  timeZone?: string;
}

/**
 * PWA files served without a session: iOS fetches the manifest and icons without cookies when adding to the home
 * screen, and the service worker script is fetched on its own schedule.
 */
const PUBLIC_ASSET = /^\/(manifest\.webmanifest|sw\.js|registerSW\.js|workbox-[\w-]+\.js|favicon\.ico|logo\.svg|(apple-touch-icon|maskable-icon|pwa)-\d+x\d+\.png)$/;

/** An asset response with headers we can add to (a fetched Response's are immutable). */
async function asset(assets: Assets, request: Request): Promise<Response> {
  const res = await assets.fetch(request);
  return new Response(res.body, res);
}

export type AppEnv = { Variables: { session: AppSession } };

/**
 * The Worker's router. `/auth/*` signs in and out; `/api/*` answers JSON (401 when signed out, so the app can decide
 * where to go). Everything else is the PWA: a signed-out page request goes to sign in and comes back.
 */
export function createApp(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.route('/', authRoutes(deps.auth));
  // Pushes with a bearer token instead of a session, so mounted before the session middleware: glucose from Home
  // Assistant (HA_INGEST_TOKEN, plan 14), and text from capture sources (ingest tokens in D1, plan 9).
  app.route('/api/ingest', glucoseIngest(deps));
  app.route('/api/ingest', textIngest(deps.db));

  const api = new Hono<AppEnv>();
  api.use('*', async (c, next) => {
    const { session, setCookie } = await deps.auth.getSession(c.req.raw);
    if (!session) return withCookie(jsonError(401, 'unauthenticated'), setCookie);
    c.set('session', session);
    await next();
    if (setCookie) c.res = withCookie(c.res, setCookie);
  });
  api.get('/me', (c) => {
    const { sub, name } = c.var.session;
    return c.json({ sub, name, build: deps.commit }, 200, { 'Cache-Control': 'no-store' });
  });
  api.route('/glucose', glucoseApi(deps));
  api.route('/', notesApi(deps.db));
  api.route('/', foodsApi(deps.db));
  api.route('/', medsApi(deps.db));
  api.route('/', inboxApi(deps.db));
  api.route('/import', importApi(deps.db, deps.timeZone ?? 'America/Chicago'));
  api.all('*', () => jsonError(404, 'not_found'));
  app.route('/api', api);
  // `/auth/*` paths the IdP routes don't answer are not the app.
  app.all('/auth/*', () => new Response('Not found', { status: 404 }));

  app.on(['GET', 'HEAD'], '*', async (c, next) => {
    if (PUBLIC_ASSET.test(new URL(c.req.url).pathname)) return asset(deps.assets, c.req.raw);
    await next();
  });
  app.on(['GET', 'HEAD'], '*', requireAuth(deps.auth), async (c) => {
    const res = await asset(deps.assets, c.req.raw);
    // The app shell is per-user behind sign-in: never let a shared cache keep it.
    if ((res.headers.get('Content-Type') ?? '').startsWith('text/html')) res.headers.set('Cache-Control', 'private, no-cache');
    return res;
  });
  app.notFound(() => new Response('Not found', { status: 404 }));
  return app;
}
