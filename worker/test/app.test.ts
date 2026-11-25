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
  app = createApp({ auth, commit: 'abc1234' });
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
