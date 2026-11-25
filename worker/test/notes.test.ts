import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearData, Jar, send, sendJson, signIn, useHarness } from './harness';

const h = useHarness();
type NoteBody = { note: { id: string; title: string; body: string; tags: string[]; rawText: string; createdAt: string; updatedAt: string } };

beforeEach(clearData);

const create = async (jar: Jar, rawText: string) => {
  const res = await sendJson(h, jar, 'POST', '/api/notes', { rawText });
  expect(res.status).toBe(201);
  return ((await res.json()) as NoteBody).note;
};
const listNotes = async (jar: Jar, q = '') => ((await (await send(h, jar, `/api/notes${q}`)).json()) as { notes: { id: string }[] }).notes.map((n) => n.id);
const tags = async (jar: Jar) => ((await (await send(h, jar, '/api/tags')).json()) as { tags: string[] }).tags;

describe('notes API signed out', () => {
  it('401s every route', async () => {
    const jar = new Jar();
    for (const [method, path] of [['GET', '/api/notes'], ['GET', '/api/notes/x'], ['POST', '/api/notes'], ['PUT', '/api/notes/x'], ['DELETE', '/api/notes/x'], ['GET', '/api/tags']] as const) {
      const res = await sendJson(h, jar, method, path, method === 'POST' || method === 'PUT' ? { rawText: 'x' } : undefined);
      expect(res.status, `${method} ${path}`).toBe(401);
    }
  });
});

describe('notes API signed in', () => {
  it('creates a note, parsing it on the server', async () => {
    const jar = await signIn(h, new Jar());
    const note = await create(jar, 'Took meds\n\nwith food\n\n:Meds, morning');
    expect(note).toMatchObject({ title: 'Took meds', body: 'with food', tags: ['meds', 'morning'], rawText: 'Took meds\n\nwith food\n\n:Meds, morning' });
    expect(note.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(note.createdAt).toBe(note.updatedAt);

    const res = await send(h, jar, `/api/notes/${note.id}`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as NoteBody).note).toEqual(note);
  });

  it('lists newest first, filters by tag, and keeps tags in step through update and delete', async () => {
    const jar = await signIn(h, new Jar());
    const a = await create(jar, 'A\n\n:shared, only-a');
    await new Promise((r) => setTimeout(r, 5));
    const b = await create(jar, 'B\n\n:other');
    await new Promise((r) => setTimeout(r, 5));
    const c = await create(jar, 'C\n\n:shared');

    expect(await listNotes(jar)).toEqual([c.id, b.id, a.id]);
    expect(await listNotes(jar, '?tag=shared')).toEqual([c.id, a.id]);
    expect(await listNotes(jar, '?tag=SHARED')).toEqual([c.id, a.id]);
    expect(await tags(jar)).toEqual(['only-a', 'other', 'shared']);

    await new Promise((r) => setTimeout(r, 5));
    const updated = await sendJson(h, jar, 'PUT', `/api/notes/${a.id}`, { rawText: 'A2\n\n:new' });
    expect(updated.status).toBe(200);
    const note = ((await updated.json()) as NoteBody).note;
    expect(note).toMatchObject({ id: a.id, title: 'A2', tags: ['new'], createdAt: a.createdAt });
    expect(note.updatedAt > a.updatedAt).toBe(true);
    expect(await listNotes(jar, '?tag=shared')).toEqual([c.id]);
    expect(await listNotes(jar, '?tag=new')).toEqual([a.id]);
    expect(await tags(jar)).toEqual(['new', 'other', 'shared']);
    expect(await listNotes(jar)).toEqual([a.id, c.id, b.id]);

    expect((await sendJson(h, jar, 'DELETE', `/api/notes/${c.id}`)).status).toBe(204);
    expect(await tags(jar)).toEqual(['new', 'other']);
    expect(await listNotes(jar, '?tag=shared')).toEqual([]);
    const left = await env.DB.prepare('SELECT COUNT(*) AS n FROM note_tags WHERE note_id = ?').bind(c.id).first<{ n: number }>();
    expect(left?.n).toBe(0);
  });

  it('404s missing notes', async () => {
    const jar = await signIn(h, new Jar());
    expect((await send(h, jar, '/api/notes/missing')).status).toBe(404);
    expect((await sendJson(h, jar, 'PUT', '/api/notes/missing', { rawText: 'x' })).status).toBe(404);
    expect((await sendJson(h, jar, 'DELETE', '/api/notes/missing')).status).toBe(404);
  });

  it('refuses bad bodies (400) and big ones (413)', async () => {
    const jar = await signIn(h, new Jar());
    const bad = await sendJson(h, jar, 'POST', '/api/notes', { rawText: 5 });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: 'invalid', detail: expect.any(String) });
    const notJson = await send(h, jar, '/api/notes', { method: 'POST', body: '{nope', headers: { 'Content-Type': 'application/json' } });
    expect(notJson.status).toBe(400);
    const big = await sendJson(h, jar, 'POST', '/api/notes', { rawText: 'x'.repeat(65 * 1024) });
    expect(big.status).toBe(413);
    expect(await big.json()).toEqual({ error: 'too_large' });
  });
});

describe('notes between users', () => {
  it("can't read, change, delete or see the tags of another user's notes", async () => {
    const mine = await signIn(h, new Jar());
    const note = await create(mine, 'Mine\n\n:private');
    const other = await signIn(h, new Jar(), 'sub-other');

    expect((await send(h, other, `/api/notes/${note.id}`)).status).toBe(404);
    expect((await sendJson(h, other, 'PUT', `/api/notes/${note.id}`, { rawText: 'Hijacked\n\n:x' })).status).toBe(404);
    expect((await sendJson(h, other, 'DELETE', `/api/notes/${note.id}`)).status).toBe(404);
    expect(await listNotes(other)).toEqual([]);
    expect(await listNotes(other, '?tag=private')).toEqual([]);
    expect(await tags(other)).toEqual([]);

    const res = await send(h, mine, `/api/notes/${note.id}`);
    expect(((await res.json()) as NoteBody).note).toMatchObject({ title: 'Mine', tags: ['private'] });
    expect(await tags(mine)).toEqual(['private']);
  });
});
