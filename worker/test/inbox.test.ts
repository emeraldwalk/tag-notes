import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { ORIGIN } from '../src/auth';
import { MAX_ENTRY_TEXT, MAX_INGEST_TEXT_BYTES } from '../src/inbox';
import { clearData, Jar, send, sendJson, signIn, useHarness } from './harness';

const h = useHarness();
beforeEach(clearData);

type Row = Record<string, unknown> & { id: string };

const createToken = async (jar: Jar, name: string) => {
  const res = await sendJson(h, jar, 'POST', '/api/ingest-tokens', { name });
  expect(res.status, name).toBe(201);
  return (await res.json()) as { token: Row; secret: string };
};

/** `POST /api/ingest/text` with no session, as a Shortcut sends it. */
const ingest = (secret: string | null, body: unknown, contentType = 'application/json') => {
  const headers: Record<string, string> = { 'Content-Type': contentType };
  if (secret !== null) headers['Authorization'] = `Bearer ${secret}`;
  return h.app.fetch(
    new Request(`${ORIGIN}/api/ingest/text`, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) }),
  );
};

const entries = async (jar: Jar, q = '') => {
  const res = await send(h, jar, `/api/raw-entries${q}`);
  expect(res.status).toBe(200);
  return ((await res.json()) as { entries: Row[] }).entries;
};
const addEntry = async (jar: Jar, body: Record<string, unknown>) => {
  const res = await sendJson(h, jar, 'POST', '/api/raw-entries', body);
  expect(res.status, JSON.stringify(body)).toBe(201);
  return ((await res.json()) as { entry: Row }).entry;
};
const count = async (jar: Jar) => ((await (await send(h, jar, '/api/raw-entries/count')).json()) as { new: number }).new;

describe('POST /api/ingest/text', () => {
  it('saves the text for the token’s user, with its name as source, and marks the token used', async () => {
    const jar = await signIn(h, new Jar());
    const { token, secret } = await createToken(jar, 'Siri');
    expect(secret).toMatch(/^trk_[A-Za-z0-9_-]{43}$/);

    const res = await ingest(secret, { text: '  I had two eggs and toast  ' });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; saved: string };
    expect(body.saved).toBe('Saved: I had two eggs and toast');

    const [entry] = await entries(jar);
    expect(entry).toMatchObject({ id: body.id, text: 'I had two eggs and toast', source: 'Siri', status: 'new' });
    expect(entry!['occurredAt']).toBe(entry!['receivedAt']);
    expect(entry).not.toHaveProperty('outcomeKind');
    const tokens = ((await (await send(h, jar, '/api/ingest-tokens')).json()) as { tokens: Row[] }).tokens;
    expect(tokens).toEqual([expect.objectContaining({ id: token.id, name: 'Siri', lastUsedAt: expect.any(String) })]);

    // Another user sees nothing.
    expect(await entries(await signIn(h, new Jar(), 'sub-other'))).toEqual([]);
  });

  it('keeps the sender’s time and shortens the spoken reply', async () => {
    const jar = await signIn(h, new Jar());
    const { secret } = await createToken(jar, 'Siri');
    const text = 'a'.repeat(100);
    const res = await ingest(secret, { text, occurredAt: '2026-11-24T08:30:00-06:00' });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { saved: string }).saved).toBe(`Saved: ${'a'.repeat(59)}…`);
    expect((await entries(jar))[0]).toMatchObject({ text, occurredAt: '2026-11-24T14:30:00.000Z' });
  });

  it('refuses missing, unknown and revoked tokens', async () => {
    const jar = await signIn(h, new Jar());
    const { token, secret } = await createToken(jar, 'Siri');
    expect((await ingest(null, { text: 'x' })).status).toBe(401);
    expect((await ingest('trk_nope', { text: 'x' })).status).toBe(401);
    expect((await ingest(`${secret}x`, { text: 'x' })).status).toBe(401);
    // The glucose token is not a capture token.
    expect((await ingest('test-ha-token', { text: 'x' })).status).toBe(401);

    expect((await send(h, jar, `/api/ingest-tokens/${token.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await ingest(secret, { text: 'x' })).status).toBe(401);
    expect(await entries(jar, '?status=all')).toEqual([]);
  });

  it('validates the body', async () => {
    const jar = await signIn(h, new Jar());
    const { secret } = await createToken(jar, 'Siri');
    expect((await ingest(secret, 'text=x', 'application/x-www-form-urlencoded')).status).toBe(415);
    expect((await ingest(secret, { text: 'x'.repeat(MAX_INGEST_TEXT_BYTES) })).status).toBe(413);
    for (const body of [
      { text: '   ' },
      { text: 'x'.repeat(MAX_ENTRY_TEXT + 1) },
      { text: 5 },
      {},
      { text: 'x', occurredAt: '2026-11-24T08:30:00' },
      { text: 'x', occurredAt: new Date(Date.now() + 10 * 60_000).toISOString() },
      'not json',
      [],
    ]) {
      expect((await ingest(secret, body)).status, JSON.stringify(body)).toBe(400);
    }
    expect((await ingest(secret, { text: 'x'.repeat(MAX_ENTRY_TEXT), occurredAt: '' })).status).toBe(201);
  });
});

describe('ingest tokens', () => {
  it('lists without secrets, refuses duplicate active names, and allows a name again after revoking', async () => {
    const jar = await signIn(h, new Jar());
    const siri = await createToken(jar, 'Siri');
    const res = await send(h, jar, '/api/ingest-tokens');
    const text = await res.text();
    expect(text).not.toContain(siri.secret);
    expect(text).not.toContain('hash');

    expect((await sendJson(h, jar, 'POST', '/api/ingest-tokens', { name: 'siri' })).status).toBe(409);
    for (const name of ['', '   ', 'x'.repeat(41), 7]) {
      expect((await sendJson(h, jar, 'POST', '/api/ingest-tokens', { name })).status, String(name)).toBe(400);
    }
    // Another user may use the same name.
    await createToken(await signIn(h, new Jar(), 'sub-other'), 'Siri');

    expect((await send(h, jar, `/api/ingest-tokens/${siri.token.id}`, { method: 'DELETE' })).status).toBe(204);
    const again = await createToken(jar, 'Siri');
    expect(again.secret).not.toBe(siri.secret);
    const tokens = ((await (await send(h, jar, '/api/ingest-tokens')).json()) as { tokens: Row[] }).tokens;
    expect(tokens.map((t) => [t.name, 'revokedAt' in t])).toEqual([['Siri', false], ['Siri', true]]);
  });

  it('cannot revoke another user’s token', async () => {
    const jar = await signIn(h, new Jar());
    const { token, secret } = await createToken(jar, 'Siri');
    const other = await signIn(h, new Jar(), 'sub-other');
    expect((await send(h, other, `/api/ingest-tokens/${token.id}`, { method: 'DELETE' })).status).toBe(404);
    expect((await ingest(secret, { text: 'x' })).status).toBe(201);
  });
});

describe('raw entries API', () => {
  it('401s every route signed out', async () => {
    const jar = new Jar();
    for (const [method, path] of [
      ['GET', '/api/raw-entries'], ['GET', '/api/raw-entries/count'], ['POST', '/api/raw-entries'], ['PUT', '/api/raw-entries/x'],
      ['POST', '/api/raw-entries/x/note'], ['DELETE', '/api/raw-entries/x'],
      ['GET', '/api/ingest-tokens'], ['POST', '/api/ingest-tokens'], ['DELETE', '/api/ingest-tokens/x'],
    ] as const) {
      expect((await sendJson(h, jar, method, path, method === 'GET' || method === 'DELETE' ? undefined : {})).status, `${method} ${path}`).toBe(401);
    }
  });

  it('adds from the app, filters by status, pages back and counts new ones', async () => {
    const jar = await signIn(h, new Jar());
    const a = await addEntry(jar, { text: 'one', occurredAt: '2026-11-20T10:00:00Z' });
    const b = await addEntry(jar, { text: 'two', occurredAt: '2026-11-21T10:00:00Z' });
    const c = await addEntry(jar, { text: 'three', occurredAt: '2026-11-22T10:00:00Z' });
    expect(a).toMatchObject({ source: 'app', status: 'new' });
    expect(await count(jar)).toBe(3);

    const put = await sendJson(h, jar, 'PUT', `/api/raw-entries/${b.id}`, { status: 'dismissed' });
    expect(put.status).toBe(200);
    expect(((await put.json()) as { entry: Row }).entry).toMatchObject({ id: b.id, status: 'dismissed', text: 'two' });
    expect(await count(jar)).toBe(2);

    expect((await entries(jar)).map((e) => e.id)).toEqual([c.id, a.id]);
    expect((await entries(jar, '?status=dismissed')).map((e) => e.id)).toEqual([b.id]);
    expect((await entries(jar, '?status=all')).map((e) => e.id)).toEqual([c.id, b.id, a.id]);
    expect((await entries(jar, '?status=all&limit=2')).map((e) => e.id)).toEqual([c.id, b.id]);
    expect((await entries(jar, `?status=all&limit=2&before=${encodeURIComponent(b['occurredAt'] as string)}`)).map((e) => e.id)).toEqual([a.id]);

    for (const q of ['?status=old', '?limit=0', '?limit=201', '?limit=x', '?before=nope']) {
      expect((await send(h, jar, `/api/raw-entries${q}`)).status, q).toBe(400);
    }
    // Text can't be edited; status must be one of three.
    for (const body of [{ status: 'new', text: 'changed' }, { status: 'filed' }, { text: 'changed' }]) {
      expect((await sendJson(h, jar, 'PUT', `/api/raw-entries/${a.id}`, body)).status, JSON.stringify(body)).toBe(400);
    }
    expect((await sendJson(h, jar, 'PUT', `/api/raw-entries/${b.id}`, { status: 'new' })).status).toBe(200);
    expect(await count(jar)).toBe(3);
  });

  it('makes a note at the entry’s time, once, and marks the entry done', async () => {
    const jar = await signIn(h, new Jar());
    const e = await addEntry(jar, { text: 'Headache after lunch\n\n:symptoms', occurredAt: '2026-11-24T19:05:00Z' });
    const res = await send(h, jar, `/api/raw-entries/${e.id}/note`, { method: 'POST' });
    expect(res.status).toBe(201);
    const { note, entry } = (await res.json()) as { note: Row; entry: Row };
    expect(note).toMatchObject({ rawText: e['text'], title: 'Headache after lunch', tags: ['symptoms'], createdAt: '2026-11-24T19:05:00.000Z' });
    expect(entry).toMatchObject({ id: e.id, status: 'done', outcomeKind: 'note', outcomeId: note.id });

    const stored = ((await (await send(h, jar, `/api/notes/${note.id}`)).json()) as { note: Row }).note;
    expect(stored).toMatchObject({ rawText: e['text'], createdAt: '2026-11-24T19:05:00.000Z', updatedAt: '2026-11-24T19:05:00.000Z' });
    expect(((await (await send(h, jar, '/api/notes?tag=symptoms')).json()) as { notes: Row[] }).notes).toHaveLength(1);

    const again = await send(h, jar, `/api/raw-entries/${e.id}/note`, { method: 'POST' });
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: 'already_filed' });
    // Moving it back to new doesn't let it make a second note.
    await sendJson(h, jar, 'PUT', `/api/raw-entries/${e.id}`, { status: 'new' });
    expect((await send(h, jar, `/api/raw-entries/${e.id}/note`, { method: 'POST' })).status).toBe(409);
    const { results } = await env.DB.prepare('SELECT id FROM notes').all();
    expect(results).toHaveLength(1);
  });

  it('keeps users apart on every route', async () => {
    const jar = await signIn(h, new Jar());
    const e = await addEntry(jar, { text: 'mine' });
    const other = await signIn(h, new Jar(), 'sub-other');
    expect(await entries(other, '?status=all')).toEqual([]);
    expect(await count(other)).toBe(0);
    expect((await sendJson(h, other, 'PUT', `/api/raw-entries/${e.id}`, { status: 'done' })).status).toBe(404);
    expect((await send(h, other, `/api/raw-entries/${e.id}/note`, { method: 'POST' })).status).toBe(404);
    expect((await send(h, other, `/api/raw-entries/${e.id}`, { method: 'DELETE' })).status).toBe(404);
    expect(await entries(jar)).toEqual([expect.objectContaining({ id: e.id, status: 'new' })]);

    expect((await send(h, jar, `/api/raw-entries/${e.id}`, { method: 'DELETE' })).status).toBe(204);
    expect(await entries(jar, '?status=all')).toEqual([]);
    expect((await send(h, jar, `/api/raw-entries/${e.id}`, { method: 'DELETE' })).status).toBe(404);
  });
});

describe('export / import of raw entries', () => {
  it('round-trips through GET and POST /api/import, never touching another user’s entry', async () => {
    const jar = await signIn(h, new Jar());
    const { secret } = await createToken(jar, 'Siri');
    await ingest(secret, { text: 'spoken', occurredAt: '2026-11-24T08:30:00Z' });
    const typed = await addEntry(jar, { text: 'typed' });
    await send(h, jar, `/api/raw-entries/${typed.id}/note`, { method: 'POST' });
    const all = await entries(jar, '?status=all');
    const file = { app: 'tag-notes', version: 2, notes: [], foods: [], rawEntries: all };

    const fresh = await signIn(h, new Jar(), 'sub-fresh');
    const res = await sendJson(h, fresh, 'POST', '/api/import', file);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ rawEntries: 0, skipped: 2 });
    // The ids are the first user's: skipped, not taken over.
    expect(await entries(fresh, '?status=all')).toEqual([]);

    // Into the same account after deleting them: restored exactly.
    for (const e of all) await send(h, jar, `/api/raw-entries/${e.id}`, { method: 'DELETE' });
    const again = await sendJson(h, jar, 'POST', '/api/import', file);
    expect(await again.json()).toMatchObject({ rawEntries: 2, skipped: 0 });
    expect(await entries(jar, '?status=all')).toEqual(all);
  });

  it('rejects a bad raw entry with its index', async () => {
    const jar = await signIn(h, new Jar());
    const res = await sendJson(h, jar, 'POST', '/api/import', {
      app: 'tag-notes', version: 2, notes: [], rawEntries: [{ text: 'ok', source: 'app', occurredAt: '2026-11-24T08:30:00Z' }, { text: 'x', source: 'app', occurredAt: 'yesterday' }],
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { detail: string }).detail).toContain('Raw entry at index 1');
  });
});

describe('paging with ties', () => {
  it('continues exactly after an entry when several share its time', async () => {
    const jar = await signIn(h, new Jar());
    const at = '2026-11-24T08:30:00Z';
    for (const text of ['a', 'b', 'c', 'd', 'e']) await addEntry(jar, { text, occurredAt: at });
    const seen: Row[] = [];
    for (;;) {
      const last = seen.at(-1);
      const q = last ? `&before=${encodeURIComponent(last['occurredAt'] as string)}&beforeId=${last.id}` : '';
      const page = await entries(jar, `?status=all&limit=2${q}`);
      seen.push(...page);
      if (page.length < 2) break;
    }
    expect(seen.map((e) => e['text']).sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect((await send(h, jar, '/api/raw-entries?beforeId=x')).status).toBe(400);
  });
});
