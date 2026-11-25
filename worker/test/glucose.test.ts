import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { glucoseIngest } from '../src/glucoseRoutes';
import { pollLibreLinkUp } from '../src/glucose';
import { type Fetch, type LluConfig, parseFactoryTimestamp, sha256Hex } from '../src/llu';

const CONFIG: LluConfig = { region: 'us', version: '4.16.0', email: 'follower@example.test', password: 'pw' };
const OWNER = 'sub-brian';
const NOW = new Date('2026-11-24T19:40:00Z');
const NOW_S = Math.floor(NOW.getTime() / 1000);

interface Call {
  method: string;
  url: string;
  headers: Headers;
  body: string;
}

/** A scripted LibreView: answers per path (in order, the last one repeating), and records every call. */
function fakeLibreView(answers: Record<string, (Response | (() => Response))[]>): { fetch: Fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: Fetch = async (input, init) => {
    const url = new URL(input);
    calls.push({ method: init?.method ?? 'GET', url: url.href, headers: new Headers(init?.headers), body: String(init?.body ?? '') });
    const queue = answers[`${url.host}${url.pathname}`] ?? answers[url.pathname];
    if (!queue?.length) throw new TypeError(`fetch failed: no answer for ${url.href}`);
    const next = queue.length > 1 ? queue.shift()! : queue[0]!;
    return typeof next === 'function' ? next() : next.clone();
  };
  return { fetch, calls };
}

const json = (body: unknown, init: ResponseInit = {}) => Response.json(body, init);
const loginOk = (expires = NOW_S + 180 * 86_400, token = 'tok-1') =>
  json({ status: 0, data: { user: { id: 'llu-user-1' }, authTicket: { token, expires, duration: 15_552_000_000 } } });
const connections = () => json({ status: 0, data: [{ patientId: 'patient-1' }] });
const graphOk = () =>
  json({
    status: 0,
    data: {
      connection: { glucoseMeasurement: { FactoryTimestamp: '11/24/2026 7:38:50 PM', ValueInMgPerDl: 112, TrendArrow: 3 } },
      graphData: [
        { FactoryTimestamp: '11/24/2026 7:15:00 PM', ValueInMgPerDl: 108 },
        { FactoryTimestamp: '11/24/2026 7:30:00 PM', ValueInMgPerDl: 110.4 },
        { FactoryTimestamp: 'garbage', ValueInMgPerDl: 999 },
      ],
    },
  });

async function state() {
  return env.DB.prepare('SELECT * FROM llu_state WHERE id = 1').first<Record<string, unknown>>();
}
async function rows() {
  return (await env.DB.prepare('SELECT ts, mg_dl, trend, source, kind, user_id FROM glucose_readings ORDER BY ts').all()).results;
}

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM glucose_readings'),
    env.DB.prepare(
      `UPDATE llu_state SET host = NULL, token = NULL, token_expires = NULL, account_id = NULL, patient_id = NULL,
       last_run_at = NULL, last_ok_at = NULL, last_error = NULL, backoff_until = NULL WHERE id = 1`,
    ),
  ]);
});

describe('parseFactoryTimestamp', () => {
  it.each([
    ['11/24/2026 1:38:50 PM', '2026-11-24T13:38:50Z'],
    ['11/24/2026 12:05:00 AM', '2026-11-24T00:05:00Z'],
    ['11/24/2026 12:05:00 PM', '2026-11-24T12:05:00Z'],
    ['1/2/2027 9:00:01 am', '2027-01-02T09:00:01Z'],
    ['12/31/2026 11:59:59 PM', '2026-12-31T23:59:59Z'],
  ])('%s → %s', (input, expected) => {
    expect(parseFactoryTimestamp(input)).toBe(expected);
  });

  it.each(['2026-11-24T13:38:50Z', '13/01/2026 1:00:00 PM', '2/30/2026 1:00:00 PM', '11/24/2026 13:00:00 PM', '11/24/2026 0:10:00 AM', ''])(
    'rejects %j',
    (input) => {
      expect(parseFactoryTimestamp(input)).toBeNull();
    },
  );
});

describe('pollLibreLinkUp', () => {
  it('signs in, follows the region redirect, and stores the graph', async () => {
    const lv = fakeLibreView({
      'api-us.libreview.io/llu/auth/login': [json({ status: 0, data: { redirect: true, region: 'eu' } })],
      'api-eu.libreview.io/llu/auth/login': [loginOk()],
      '/llu/connections': [connections()],
      '/llu/connections/patient-1/graph': [graphOk()],
    });
    const result = await pollLibreLinkUp({ db: env.DB, fetch: lv.fetch, config: CONFIG, ownerUserId: OWNER, now: NOW });
    expect(result).toEqual({ ok: true, inserted: 3 });

    expect(lv.calls.map((c) => c.url)).toEqual([
      'https://api-us.libreview.io/llu/auth/login',
      'https://api-eu.libreview.io/llu/auth/login',
      'https://api-eu.libreview.io/llu/connections',
      'https://api-eu.libreview.io/llu/connections/patient-1/graph',
    ]);
    const [login, , conn] = lv.calls as [Call, Call, Call];
    expect(JSON.parse(login.body)).toEqual({ email: CONFIG.email, password: CONFIG.password });
    expect(login.headers.get('product')).toBe('llu.ios');
    expect(login.headers.get('version')).toBe('4.16.0');
    expect(login.headers.get('account-id')).toBeNull();
    expect(conn.headers.get('Authorization')).toBe('Bearer tok-1');
    expect(conn.headers.get('account-id')).toBe(await sha256Hex('llu-user-1'));
    expect(conn.headers.get('account-id')).toMatch(/^[0-9a-f]{64}$/);

    expect(await rows()).toEqual([
      { ts: '2026-11-24T19:15:00Z', mg_dl: 108, trend: null, source: 'llu', kind: 'historic', user_id: OWNER },
      { ts: '2026-11-24T19:30:00Z', mg_dl: 110, trend: null, source: 'llu', kind: 'historic', user_id: OWNER },
      { ts: '2026-11-24T19:38:50Z', mg_dl: 112, trend: 3, source: 'llu', kind: 'current', user_id: OWNER },
    ]);
    const s = await state();
    expect(s).toMatchObject({
      host: 'https://api-eu.libreview.io',
      token: 'tok-1',
      patient_id: 'patient-1',
      last_run_at: '2026-11-24T19:40:00Z',
      last_ok_at: '2026-11-24T19:40:00Z',
      last_error: null,
    });
  });

  it('reuses the cached token and patient, and adds no duplicates for overlapping graphs', async () => {
    const lv = fakeLibreView({
      '/llu/auth/login': [loginOk()],
      '/llu/connections': [connections()],
      '/llu/connections/patient-1/graph': [graphOk()],
    });
    await pollLibreLinkUp({ db: env.DB, fetch: lv.fetch, config: CONFIG, ownerUserId: OWNER, now: NOW });
    lv.calls.length = 0;
    const again = await pollLibreLinkUp({ db: env.DB, fetch: lv.fetch, config: CONFIG, ownerUserId: OWNER, now: new Date(NOW.getTime() + 300_000) });
    expect(again).toEqual({ ok: true, inserted: 0 });
    expect(lv.calls.map((c) => new URL(c.url).pathname)).toEqual(['/llu/connections/patient-1/graph']);
    expect(await rows()).toHaveLength(3);
  });

  it('signs in again when the token is within an hour of expiring', async () => {
    const lv = fakeLibreView({
      '/llu/auth/login': [loginOk(NOW_S + 1800, 'old'), loginOk(NOW_S + 180 * 86_400, 'new')],
      '/llu/connections': [connections()],
      '/llu/connections/patient-1/graph': [graphOk()],
    });
    await pollLibreLinkUp({ db: env.DB, fetch: lv.fetch, config: CONFIG, ownerUserId: OWNER, now: NOW });
    await pollLibreLinkUp({ db: env.DB, fetch: lv.fetch, config: CONFIG, ownerUserId: OWNER, now: NOW });
    expect(lv.calls.filter((c) => c.url.endsWith('/login'))).toHaveLength(2);
    expect((await state())?.token).toBe('new');
  });

  it('on 401 signs in once more and retries', async () => {
    const lv = fakeLibreView({
      '/llu/auth/login': [loginOk(undefined, 'first'), loginOk(undefined, 'second')],
      '/llu/connections': [connections()],
      '/llu/connections/patient-1/graph': [new Response('no', { status: 401 }), graphOk()],
    });
    const result = await pollLibreLinkUp({ db: env.DB, fetch: lv.fetch, config: CONFIG, ownerUserId: OWNER, now: NOW });
    expect(result).toEqual({ ok: true, inserted: 3 });
    expect((await state())?.token).toBe('second');
  });

  it('backs off after a rate limit, using Retry-After when given', async () => {
    const lv = fakeLibreView({
      '/llu/auth/login': [new Response('slow down', { status: 429, headers: { 'Retry-After': '120' } })],
    });
    expect(await pollLibreLinkUp({ db: env.DB, fetch: lv.fetch, config: CONFIG, ownerUserId: OWNER, now: NOW })).toEqual({
      ok: false,
      error: 'rate_limited',
    });
    expect((await state())?.backoff_until).toBe('2026-11-24T19:42:00Z');

    lv.calls.length = 0;
    const skipped = await pollLibreLinkUp({ db: env.DB, fetch: lv.fetch, config: CONFIG, ownerUserId: OWNER, now: new Date(NOW.getTime() + 60_000) });
    expect(skipped).toEqual({ skipped: 'backoff' });
    expect(lv.calls).toHaveLength(0);
  });

  it('backs off 30 minutes after a 430 without Retry-After', async () => {
    const lv = fakeLibreView({ '/llu/auth/login': [new Response('', { status: 430 })] });
    await pollLibreLinkUp({ db: env.DB, fetch: lv.fetch, config: CONFIG, ownerUserId: OWNER, now: NOW });
    expect((await state())?.backoff_until).toBe('2026-11-24T20:10:00Z');
  });

  it('backs off an hour after a refused sign-in, so the account is not locked', async () => {
    const lv = fakeLibreView({ '/llu/auth/login': [json({ status: 2, error: { message: 'bad credentials' } })] });
    expect(await pollLibreLinkUp({ db: env.DB, fetch: lv.fetch, config: CONFIG, ownerUserId: OWNER, now: NOW })).toEqual({
      ok: false,
      error: 'login_failed',
    });
    expect(await state()).toMatchObject({ last_error: 'login_failed', backoff_until: '2026-11-24T20:40:00Z', token: null });
  });

  it('records a blocked request (for example a Cloudflare challenge) as its status', async () => {
    const lv = fakeLibreView({ '/llu/auth/login': [new Response('<html>challenge</html>', { status: 403 })] });
    expect(await pollLibreLinkUp({ db: env.DB, fetch: lv.fetch, config: CONFIG, ownerUserId: OWNER, now: NOW })).toEqual({
      ok: false,
      error: 'http_403',
    });
    expect(await state()).toMatchObject({ last_error: 'http_403', backoff_until: null, last_ok_at: null });
  });

  it('records network failures', async () => {
    const lv = fakeLibreView({});
    expect(await pollLibreLinkUp({ db: env.DB, fetch: lv.fetch, config: CONFIG, ownerUserId: OWNER, now: NOW })).toEqual({
      ok: false,
      error: 'network',
    });
  });

  it('does nothing without the LibreLinkUp secrets', async () => {
    const lv = fakeLibreView({});
    expect(await pollLibreLinkUp({ db: env.DB, fetch: lv.fetch, config: null, ownerUserId: OWNER, now: NOW })).toEqual({
      ok: false,
      error: 'not_configured',
    });
    expect(lv.calls).toHaveLength(0);
    expect((await state())?.last_error).toBe('not_configured');
  });

  it('does nothing without OWNER_USER_ID', async () => {
    const lv = fakeLibreView({});
    expect(await pollLibreLinkUp({ db: env.DB, fetch: lv.fetch, config: CONFIG, ownerUserId: '', now: NOW })).toEqual({
      ok: false,
      error: 'no_owner_user_id',
    });
    expect(lv.calls).toHaveLength(0);
  });
});

describe('POST /api/ingest/glucose', () => {
  const app = () => glucoseIngest({ db: env.DB, haToken: 'test-ha-token', ownerUserId: OWNER });
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    app().fetch(
      new Request('https://tracker.ingles.place/glucose', {
        method: 'POST',
        headers: { Authorization: 'Bearer test-ha-token', 'Content-Type': 'application/json', ...headers },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }),
    );
  const good = { source: 'ha', readings: [{ ts: '2026-11-24T13:38:50-06:00', mgDl: 112, trend: 3 }] };

  it('stores readings for the owner and counts duplicates', async () => {
    const first = await post(good);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ inserted: 1, duplicates: 0 });
    expect(await (await post(good)).json()).toEqual({ inserted: 0, duplicates: 1 });
    expect(await rows()).toEqual([{ ts: '2026-11-24T19:38:50Z', mg_dl: 112, trend: 3, source: 'ha', kind: 'current', user_id: OWNER }]);
  });

  it('refuses a wrong, missing or unset token', async () => {
    expect((await post(good, { Authorization: 'Bearer nope' })).status).toBe(401);
    expect((await post(good, { Authorization: '' })).status).toBe(401);
    const unset = glucoseIngest({ db: env.DB, haToken: undefined, ownerUserId: OWNER });
    const res = await unset.fetch(
      new Request('https://tracker.ingles.place/glucose', { method: 'POST', headers: { Authorization: 'Bearer ', 'Content-Type': 'application/json' }, body: '{}' }),
    );
    expect(res.status).toBe(401);
  });

  it('wants JSON, not too big', async () => {
    expect((await post(good, { 'Content-Type': 'text/plain' })).status).toBe(415);
    expect((await post('x'.repeat(300 * 1024))).status).toBe(413);
  });

  it.each([
    ['not JSON', '{'],
    ['wrong source', { ...good, source: 'llu' }],
    ['no readings', { source: 'ha', readings: [] }],
    ['too many', { source: 'ha', readings: Array.from({ length: 501 }, () => good.readings[0]) }],
    ['no zone', { source: 'ha', readings: [{ ts: '2026-11-24T13:38:50', mgDl: 112 }] }],
    ['future', { source: 'ha', readings: [{ ts: '2999-01-01T00:00:00Z', mgDl: 112 }] }],
    ['low value', { source: 'ha', readings: [{ ts: '2026-11-24T13:38:50Z', mgDl: 5 }] }],
    ['fraction', { source: 'ha', readings: [{ ts: '2026-11-24T13:38:50Z', mgDl: 112.5 }] }],
    ['bad trend', { source: 'ha', readings: [{ ts: '2026-11-24T13:38:50Z', mgDl: 112, trend: 9 }] }],
  ])('400s %s', async (_name, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('invalid');
  });
});
