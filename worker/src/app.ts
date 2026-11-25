import type { AppSession, AuthClient } from '@emeraldwalk/idp-client';
import { authRoutes, requireAuth } from '@emeraldwalk/idp-client/hono';
import { Hono } from 'hono';
import { glucoseStatus } from './glucose';
import { glucoseApi, glucoseIngest } from './glucoseRoutes';
import { jsonError, withCookie } from './http';
import { placeholderPage } from './page';

export interface AppDeps {
  auth: AuthClient;
  /** Short commit of this build, or "dev". */
  commit: string;
  db: D1Database;
  /** Home Assistant's bearer token for `/api/ingest/*`; unset refuses every push. */
  haToken: string | undefined;
  /** The IdP sub that pushed and polled readings belong to (the cron and HA have no session). */
  ownerUserId: string;
  /** IANA zone for times shown on pages. */
  timeZone?: string;
}

export type AppEnv = { Variables: { session: AppSession } };

/**
 * The Worker's router. Pages (GET) send a signed-out browser to sign in; `/api/*` answers JSON 401 instead, so the
 * app can decide where to go. Later plans add their routes to `api`.
 */
export function createApp(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.route('/', authRoutes(deps.auth));
  // Pushes from Home Assistant: a bearer token instead of a session, so mounted before the session middleware.
  app.route('/api/ingest', glucoseIngest(deps));

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
    return c.json({ sub, name }, 200, { 'Cache-Control': 'no-store' });
  });
  api.route('/glucose', glucoseApi(deps));
  api.all('*', () => jsonError(404, 'not_found'));
  app.route('/api', api);

  app.get('/', requireAuth(deps.auth), async (c) =>
    placeholderPage(c.var.session, deps.commit, await glucoseStatus(deps.db, c.var.session.sub), deps.timeZone),
  );
  app.notFound(() => new Response('Not found', { status: 404 }));
  return app;
}
