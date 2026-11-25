import { env } from 'cloudflare:test';
import type { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type AppEnv, createApp } from '../src/app';
import { createTrackerAuth, ORIGIN, SESSION_COOKIE } from '../src/auth';
import { FakeIdp } from './fakeIdp';

const SECRET = 'test-cookie-secret-at-least-32-characters';
const ME = { sub: 'sub-brian', sid: 'sid-1', preferred_username: 'brian', name: 'Brian <Owner>' };

let idp: FakeIdp;
let app: Hono<AppEnv>;

/** A browser's cookies: Set-Cookie lines applied in order; Max-Age=0 deletes. */
class Jar {
  readonly cookies = new Map<string, string>();
  take(res: Response): Response {
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(';') as [string];
      const at = pair.indexOf('=');
      const name = pair.slice(0, at);
      if (/Max-Age=0(;|$)/i.test(line)) this.cookies.delete(name);
      else this.cookies.set(name, pair.slice(at + 1));
    }
    return res;
  }
  header(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

async function get(jar: Jar, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (jar.cookies.size > 0) headers.set('Cookie', jar.header());
  return jar.take(await app.fetch(new Request(`${ORIGIN}${path}`, { ...init, headers })));
}

async function signIn(jar: Jar): Promise<void> {
  idp.claims = ME;
  const login = await get(jar, '/auth/login?returnTo=/');
  expect(login.status).toBe(302);
  const back = new URL(idp.authorizeRedirect(login.headers.get('Location')!));
  const done = await get(jar, back.pathname + back.search);
  expect(done.status).toBe(302);
  expect(jar.cookies.has(SESSION_COOKIE)).toBe(true);
}

beforeEach(async () => {
  idp = await new FakeIdp().start();
  const auth = createTrackerAuth({ issuer: idp.issuer, clientId: idp.clientId, clientSecret: idp.clientSecret, cookieSecret: SECRET });
  app = createApp({ auth, commit: 'abc1234', db: env.DB, haToken: 'test-ha-token', ownerUserId: 'sub-brian' });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('signed out', () => {
  it('sends the home page to the IdP, coming back to /', async () => {
    const res = await get(new Jar(), '/');
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('Location')!);
    expect(location.origin).toBe(idp.issuer);
    expect(location.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/auth/callback`);
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
  it('returns who I am from /api/me', async () => {
    const jar = new Jar();
    await signIn(jar);
    const res = await get(jar, '/api/me');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sub: 'sub-brian', name: 'Brian <Owner>' });
  });

  it('shows the placeholder page with name, id and build, escaped', async () => {
    const jar = new Jar();
    await signIn(jar);
    const res = await get(jar, '/');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('Brian &lt;Owner&gt;');
    expect(html).not.toContain('Brian <Owner>');
    expect(html).toContain('sub-brian');
    expect(html).toContain('abc1234');
    expect(html).toContain('/auth/logout');
    expect(html).toContain('No readings yet');
  });

  it('answers unknown API paths with a JSON 404', async () => {
    const jar = new Jar();
    await signIn(jar);
    const res = await get(jar, '/api/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  it('sets a secure, http-only session cookie', async () => {
    const jar = new Jar();
    idp.claims = ME;
    const login = await get(jar, '/auth/login?returnTo=/');
    const back = new URL(idp.authorizeRedirect(login.headers.get('Location')!));
    const done = await app.fetch(new Request(`${ORIGIN}${back.pathname}${back.search}`, { headers: { Cookie: jar.header() } }));
    const line = done.headers.getSetCookie().find((l) => l.startsWith(`${SESSION_COOKIE}=`))!;
    expect(line).toMatch(/HttpOnly/i);
    expect(line).toMatch(/Secure/i);
  });
});

it('404s other paths', async () => {
  const res = await get(new Jar(), '/elsewhere');
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
    const jar = new Jar();
    await signIn(jar);
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
    const jar = new Jar();
    await signIn(jar);
    for (const q of ['', '?from=yesterday&to=today', '?from=2026-11-24T00:00:00&to=2026-11-25T00:00:00', '?from=2026-12-01T00:00:00Z&to=2026-11-01T00:00:00Z', '?from=2026-10-01T00:00:00Z&to=2026-11-24T00:00:00Z']) {
      expect((await get(jar, `/api/glucose${q}`)).status, q).toBe(400);
    }
  });

  it('reports the last reading and the poller status', async () => {
    const jar = new Jar();
    await signIn(jar);
    const body = (await (await get(jar, '/api/glucose/status')).json()) as Record<string, unknown>;
    expect(body.lastReading).toEqual({ ts: '2026-11-24T11:00:00Z', mgDl: 140, trend: 4 });
    expect(Object.keys(body.llu as object).sort()).toEqual(['backoffUntil', 'lastError', 'lastOkAt', 'lastRunAt']);
    const html = await (await get(jar, '/')).text();
    expect(html).toContain('140 mg/dL ↗');
  });
});
