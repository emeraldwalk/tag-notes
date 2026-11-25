import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { ORIGIN, SESSION_COOKIE } from '../src/auth';
import { Jar, ME, send, signIn, useHarness } from './harness';

const h = useHarness();
const get = (jar: Jar, path: string, init: RequestInit = {}) => send(h, jar, path, init);

describe('signed out', () => {
  it('sends a page request to the IdP, coming back to the same path', async () => {
    const res = await get(new Jar(), '/food/history?x=1');
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('Location')!);
    expect(location.origin).toBe(h.idp.issuer);
    expect(location.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/auth/callback`);
    expect(h.assetRequests).toEqual([]);

    // The login round trip lands back on the page.
    const jar = new Jar();
    h.idp.claims = ME;
    const login = await get(jar, '/food/history?x=1');
    const back = new URL(h.idp.authorizeRedirect(login.headers.get('Location')!));
    const done = await get(jar, back.pathname + back.search);
    expect(done.headers.get('Location')).toMatch(/\/food\/history\?x=1$/);
  });

  it('sends the home page to the IdP too', async () => {
    expect((await get(new Jar(), '/')).status).toBe(302);
  });

  it('serves the manifest, icons and service worker without a session', async () => {
    for (const path of ['/manifest.webmanifest', '/pwa-192x192.png', '/apple-touch-icon-180x180.png', '/maskable-icon-512x512.png', '/sw.js', '/registerSW.js', '/workbox-5f1d2c3a.js', '/favicon.ico']) {
      const res = await get(new Jar(), path);
      expect(res.status, path).toBe(200);
    }
    expect(await (await get(new Jar(), '/manifest.webmanifest')).json()).toEqual({ name: 'Tracker' });
  });

  it('keeps other files behind sign-in', async () => {
    expect((await get(new Jar(), '/assets/index-abc.js')).status).toBe(302);
    expect((await get(new Jar(), '/index.html')).status).toBe(302);
  });

  it('answers the API with a JSON 401, not a redirect', async () => {
    const res = await get(new Jar(), '/api/me');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthenticated' });
  });

  it('401s unknown API paths too, so they reveal nothing', async () => {
    const res = await get(new Jar(), '/api/nope');
    expect(res.status).toBe(401);
  });
});

describe('signed in', () => {
  it('returns who I am and the build from /api/me', async () => {
    const jar = await signIn(h, new Jar());
    const res = await get(jar, '/api/me');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sub: 'sub-brian', name: 'Brian <Owner>', build: 'abc1234' });
  });

  it('serves the PWA for app paths (the SPA fallback is the binding’s)', async () => {
    const jar = await signIn(h, new Jar());
    for (const path of ['/', '/notes/history', '/food']) {
      const res = await get(jar, path);
      expect(res.status, path).toBe(200);
      expect(res.headers.get('Content-Type')).toContain('text/html');
      expect(res.headers.get('Cache-Control')).toBe('private, no-cache');
    }
    expect(h.assetRequests).toEqual(['/', '/notes/history', '/food']);
  });

  it('answers unknown API paths with a JSON 404', async () => {
    const jar = await signIn(h, new Jar());
    const res = await get(jar, '/api/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  it('does not hand unknown /auth paths to the PWA', async () => {
    const jar = await signIn(h, new Jar());
    expect((await get(jar, '/auth/nope')).status).toBe(404);
  });

  it('sets a secure, http-only session cookie', async () => {
    const jar = new Jar();
    h.idp.claims = ME;
    const login = await get(jar, '/auth/login?returnTo=/');
    const back = new URL(h.idp.authorizeRedirect(login.headers.get('Location')!));
    const done = await h.app.fetch(new Request(`${ORIGIN}${back.pathname}${back.search}`, { headers: { Cookie: jar.header() } }));
    const line = done.headers.getSetCookie().find((l) => l.startsWith(`${SESSION_COOKIE}=`))!;
    expect(line).toMatch(/HttpOnly/i);
    expect(line).toMatch(/Secure/i);
  });
});

it('404s non-GET requests outside the API', async () => {
  const res = await get(new Jar(), '/elsewhere', { method: 'POST' });
  expect(res.status).toBe(404);
});

describe('glucose reads', () => {
  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM glucose_readings'),
      env.DB.prepare(
        `INSERT INTO glucose_readings (user_id, ts, mg_dl, trend, source, kind, created_at) VALUES
         ('sub-brian', '2026-11-24T10:00:00Z', 110, NULL, 'llu', 'historic', '2026-11-24T12:00:00Z'),
         ('sub-brian', '2026-11-24T11:00:00Z', 140, 4, 'llu', 'current', '2026-11-24T12:00:00Z'),
         ('sub-someone', '2026-11-24T10:30:00Z', 99, NULL, 'llu', 'current', '2026-11-24T12:00:00Z')`,
      ),
    ]);
  });

  it('needs a session', async () => {
    expect((await get(new Jar(), '/api/glucose?from=2026-11-24T00:00:00Z&to=2026-11-25T00:00:00Z')).status).toBe(401);
    expect((await get(new Jar(), '/api/glucose/status')).status).toBe(401);
  });

  it('returns only my readings in the range, oldest first', async () => {
    const jar = await signIn(h, new Jar());
    const res = await get(jar, '/api/glucose?from=2026-11-24T00:00:00Z&to=2026-11-24T10:59:59-01:00');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      readings: [
        { ts: '2026-11-24T10:00:00Z', mgDl: 110, trend: null, source: 'llu', kind: 'historic' },
        { ts: '2026-11-24T11:00:00Z', mgDl: 140, trend: 4, source: 'llu', kind: 'current' },
      ],
    });
  });

  it('refuses bad or too-long ranges', async () => {
    const jar = await signIn(h, new Jar());
    for (const q of ['', '?from=yesterday&to=today', '?from=2026-11-24T00:00:00&to=2026-11-25T00:00:00', '?from=2026-12-01T00:00:00Z&to=2026-11-01T00:00:00Z', '?from=2026-10-01T00:00:00Z&to=2026-11-24T00:00:00Z']) {
      expect((await get(jar, `/api/glucose${q}`)).status, q).toBe(400);
    }
  });

  it('reports the last reading and the poller status', async () => {
    const jar = await signIn(h, new Jar());
    const body = (await (await get(jar, '/api/glucose/status')).json()) as Record<string, unknown>;
    expect(body.lastReading).toEqual({ ts: '2026-11-24T11:00:00Z', mgDl: 140, trend: 4 });
    expect(Object.keys(body.llu as object).sort()).toEqual(['backoffUntil', 'lastError', 'lastOkAt', 'lastRunAt']);
  });
});
