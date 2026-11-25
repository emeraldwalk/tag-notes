import { env } from 'cloudflare:test';
import type { Hono } from 'hono';
import { afterEach, beforeEach, expect, vi } from 'vitest';
import { type AppEnv, type Assets, createApp } from '../src/app';
import { createTrackerAuth, ORIGIN, SESSION_COOKIE } from '../src/auth';
import { FakeIdp } from './fakeIdp';

const SECRET = 'test-cookie-secret-at-least-32-characters';
export const ME = { sub: 'sub-brian', sid: 'sid-1', preferred_username: 'brian', name: 'Brian <Owner>' };

/** A browser's cookies: Set-Cookie lines applied in order; Max-Age=0 deletes. */
export class Jar {
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

export interface Harness {
  idp: FakeIdp;
  app: Hono<AppEnv>;
  /** Paths the fake ASSETS binding was asked for. */
  assetRequests: string[];
}

/** The PWA's files as a stand-in for `env.ASSETS`: HTML for pages (the SPA fallback), JSON for the manifest. */
function fakeAssets(requests: string[]): Assets {
  return {
    async fetch(request) {
      const path = new URL(request.url).pathname;
      requests.push(path);
      if (path === '/manifest.webmanifest') return Response.json({ name: 'Tracker' }, { headers: { 'Content-Type': 'application/manifest+json' } });
      if (path.endsWith('.png')) return new Response('png', { headers: { 'Content-Type': 'image/png' } });
      if (path.endsWith('.js')) return new Response('// js', { headers: { 'Content-Type': 'text/javascript' } });
      return new Response(`<!doctype html><title>Tracker</title>${path}`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    },
  };
}

/** Registers beforeEach/afterEach for a fresh IdP and app per test; read the fields inside tests. */
export function useHarness(opts: { timeZone?: string } = {}): Harness {
  const h = { assetRequests: [] } as unknown as Harness;
  beforeEach(async () => {
    h.idp = await new FakeIdp().start();
    h.assetRequests.length = 0;
    const auth = createTrackerAuth({ issuer: h.idp.issuer, clientId: h.idp.clientId, clientSecret: h.idp.clientSecret, cookieSecret: SECRET });
    h.app = createApp({
      assets: fakeAssets(h.assetRequests),
      auth,
      commit: 'abc1234',
      db: env.DB,
      haToken: 'test-ha-token',
      ownerUserId: 'sub-brian',
      timeZone: opts.timeZone ?? 'America/Chicago',
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  return h;
}

export async function send(h: Harness, jar: Jar, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (jar.cookies.size > 0) headers.set('Cookie', jar.header());
  return jar.take(await h.app.fetch(new Request(`${ORIGIN}${path}`, { ...init, headers })));
}

/** JSON request helper: `body` is serialized and typed as JSON. */
export function sendJson(h: Harness, jar: Jar, method: string, path: string, body?: unknown): Promise<Response> {
  return send(h, jar, path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }),
  });
}

/** Signs a jar in as `sub` (default the owner). */
export async function signIn(h: Harness, jar: Jar, sub = ME.sub): Promise<Jar> {
  h.idp.claims = { ...ME, sub };
  const login = await send(h, jar, '/auth/login?returnTo=/');
  expect(login.status).toBe(302);
  const back = new URL(h.idp.authorizeRedirect(login.headers.get('Location')!));
  const done = await send(h, jar, back.pathname + back.search);
  expect(done.status).toBe(302);
  expect(jar.cookies.has(SESSION_COOKIE)).toBe(true);
  return jar;
}

/** Empties plan 8's and plan 16's tables. */
export async function clearData(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM doses'),
    env.DB.prepare('DELETE FROM medicines'),
    env.DB.prepare('DELETE FROM note_tags'),
    env.DB.prepare('DELETE FROM notes'),
    env.DB.prepare('DELETE FROM foods'),
    env.DB.prepare('DELETE FROM food_targets'),
  ]);
}
