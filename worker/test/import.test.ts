import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { importedEatenAt, MAX_BATCH } from '../src/import';
import { clearData, Jar, send, sendJson, signIn, useHarness } from './harness';

const h = useHarness();
beforeEach(clearData);

type Result = { notes: number; foods: number; targets: boolean; medicines: number; doses: number; rawEntries: number; skipped: number };
const doImport = async (jar: Jar, file: unknown) => {
  const res = await sendJson(h, jar, 'POST', '/api/import', file);
  expect(res.status).toBe(200);
  return (await res.json()) as Result;
};
const notes = async (jar: Jar, q = '') =>
  ((await (await send(h, jar, `/api/notes${q}`)).json()) as { notes: Record<string, unknown>[] }).notes;
const foods = async (jar: Jar) => ((await (await send(h, jar, '/api/foods')).json()) as { foods: Record<string, unknown>[] }).foods;

const v2 = {
  app: 'tag-notes',
  version: 2,
  exportedAt: '2026-11-25T12:00:00.000Z',
  notes: [
    { id: 'n-1', rawText: 'Old note\n\nbody\n\n:meds', title: 'stale', body: 'stale', tags: ['stale'], createdAt: '2026-01-01T10:00:00.000Z', updatedAt: '2026-01-02T10:00:00.000Z' },
    { rawText: 'No id' },
  ],
  foods: [
    // 14:00Z is 08:00 in Chicago on the 24th: logged as eaten.
    { id: 'f-same', name: 'Oats', quantity: 1, protein: 5, calories: 150, carbs: 27, date: '2026-11-24', createdAt: '2026-11-24T14:00:00.000Z' },
    // Logged on the 25th against the 24th: time unknown.
    { id: 'f-other', name: 'Snack', quantity: 1, protein: 1, calories: 100, carbs: 10, date: '2026-11-24', createdAt: '2026-11-25T15:00:00.000Z' },
    // 05:30Z on the 25th is 23:30 on the 24th in Chicago: the same local day, though the UTC dates differ.
    { id: 'f-midnight', name: 'Late', quantity: 1, protein: 1, calories: 100, carbs: 10, date: '2026-11-24', createdAt: '2026-11-25T05:30:00.000Z' },
    // 06:30Z on the 25th is 00:30 on the 25th in Chicago: past midnight, so not the 24th.
    { id: 'f-after', name: 'Later', quantity: 1, protein: 1, calories: 100, carbs: 10, date: '2026-11-24', createdAt: '2026-11-25T06:30:00.000Z' },
  ],
  foodTargets: { protein: 140, calories: 1900 },
};

describe('POST /api/import', () => {
  it('imports a v2 file: notes, foods (with the eatenAt rule) and targets', async () => {
    const jar = await signIn(h, new Jar());
    expect(await doImport(jar, v2)).toEqual({ notes: 2, foods: 4, targets: true, medicines: 0, doses: 0, rawEntries: 0, skipped: 0 });

    const all = await notes(jar);
    const old = all.find((n) => n['id'] === 'n-1')!;
    expect(old).toMatchObject({ title: 'Old note', body: 'body', tags: ['meds'], createdAt: '2026-01-01T10:00:00.000Z', updatedAt: '2026-01-02T10:00:00.000Z' });
    expect(all.find((n) => n['rawText'] === 'No id')!['id']).toMatch(/^[0-9a-f-]{36}$/);
    expect((await notes(jar, '?tag=meds')).map((n) => n['id'])).toEqual(['n-1']);

    const byId = Object.fromEntries((await foods(jar)).map((f) => [f['id'], f]));
    expect(byId['f-same']!['eatenAt']).toBe('2026-11-24T14:00:00.000Z');
    expect(byId['f-other']).not.toHaveProperty('eatenAt');
    expect(byId['f-midnight']!['eatenAt']).toBe('2026-11-25T05:30:00.000Z');
    expect(byId['f-after']).not.toHaveProperty('eatenAt');
    expect(byId['f-same']!['createdAt']).toBe('2026-11-24T14:00:00.000Z');

    expect(await (await send(h, jar, '/api/food-targets')).json()).toEqual({ targets: { protein: 140, calories: 1900 } });
  });

  it('keeps an eatenAt the file has (an export from this app)', async () => {
    const jar = await signIn(h, new Jar());
    const food = { ...v2.foods[1], eatenAt: '2026-11-24T22:00:00Z' };
    await doImport(jar, { ...v2, notes: [], foods: [food] });
    expect((await foods(jar))[0]!['eatenAt']).toBe('2026-11-24T22:00:00.000Z');
  });

  it('imports a v1 file and a bare array of notes', async () => {
    const jar = await signIn(h, new Jar());
    expect(await doImport(jar, { app: 'tag-notes', version: 1, notes: [{ id: 'v1', rawText: 'V1\n\n:a' }] })).toEqual({ notes: 1, foods: 0, targets: false, medicines: 0, doses: 0, rawEntries: 0, skipped: 0 });
    expect(await doImport(jar, [{ id: 'bare', rawText: 'Bare\n\n:b' }])).toEqual({ notes: 1, foods: 0, targets: false, medicines: 0, doses: 0, rawEntries: 0, skipped: 0 });
    expect((await notes(jar)).map((n) => n['id']).sort()).toEqual(['bare', 'v1']);
    expect(await (await send(h, jar, '/api/food-targets')).json()).toEqual({ targets: null });
  });

  it('upserts by id: importing again replaces, re-parsing and re-tagging', async () => {
    const jar = await signIn(h, new Jar());
    await doImport(jar, [{ id: 'n', rawText: 'First\n\n:old' }]);
    await doImport(jar, [{ id: 'n', rawText: 'Second\n\n:new' }]);
    const all = await notes(jar);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ id: 'n', title: 'Second', tags: ['new'] });
    expect(await notes(jar, '?tag=old')).toEqual([]);
  });

  it("never overwrites another user's rows with the same id: skipped", async () => {
    const owner = await signIn(h, new Jar());
    await doImport(owner, v2);
    const other = await signIn(h, new Jar(), 'sub-other');
    const hijack = {
      ...v2,
      notes: [{ id: 'n-1', rawText: 'Hijacked\n\n:evil' }, { id: 'n-mine', rawText: 'Mine' }],
      foods: [{ ...v2.foods[0], name: 'Hijacked' }],
      foodTargets: { protein: 1, calories: 1 },
    };
    expect(await doImport(other, hijack)).toEqual({ notes: 1, foods: 0, targets: true, medicines: 0, doses: 0, rawEntries: 0, skipped: 2 });

    expect((await notes(owner)).find((n) => n['id'] === 'n-1')).toMatchObject({ title: 'Old note', tags: ['meds'] });
    expect((await notes(owner, '?tag=evil'))).toEqual([]);
    expect((await notes(other)).map((n) => n['id'])).toEqual(['n-mine']);
    expect(await notes(other, '?tag=meds')).toEqual([]);
    expect((await foods(owner)).find((f) => f['id'] === 'f-same')).toMatchObject({ name: 'Oats' });
    expect(await foods(other)).toEqual([]);
    expect(await (await send(h, owner, '/api/food-targets')).json()).toEqual({ targets: { protein: 140, calories: 1900 } });
    const rows = await env.DB.prepare("SELECT user_id FROM note_tags WHERE note_id = 'n-1'").all<{ user_id: string }>();
    expect(rows.results).toEqual([{ user_id: 'sub-brian' }]);
  });

  it('splits large files into batches', async () => {
    const jar = await signIn(h, new Jar());
    const many = Array.from({ length: MAX_BATCH + 7 }, (_, i) => ({ id: `bulk-${i}`, rawText: `Bulk ${i}\n\n:bulk` }));
    expect(await doImport(jar, many)).toMatchObject({ notes: MAX_BATCH + 7, skipped: 0 });
    expect(await notes(jar, '?tag=bulk')).toHaveLength(MAX_BATCH + 7);
  });

  it('refuses invalid files with a detail, and files over 5 MB', async () => {
    const jar = await signIn(h, new Jar());
    for (const file of [
      { notes: 'nope' },
      { notes: [{ title: 'no rawText' }] },
      { notes: [], foods: [{ name: 'x', quantity: 1, protein: 1, calories: 1, carbs: 1, date: 'bad' }] },
      { notes: [], foodTargets: { protein: 'lots' } },
      { notes: [{ id: '', rawText: 'x' }] },
      42,
    ]) {
      const res = await sendJson(h, jar, 'POST', '/api/import', file);
      expect(res.status, JSON.stringify(file)).toBe(400);
      expect(await res.json()).toMatchObject({ error: 'invalid', detail: expect.any(String) });
    }
    const big = await sendJson(h, jar, 'POST', '/api/import', [{ rawText: 'x'.repeat(5 * 1024 * 1024) }]);
    expect(big.status).toBe(413);
    // Over the 64 KB of other routes, under 5 MB, is fine here.
    expect((await sendJson(h, jar, 'POST', '/api/import', [{ rawText: 'x'.repeat(100 * 1024) }])).status).toBe(200);
  });
});

describe('importedEatenAt', () => {
  it.each([
    ['2026-11-24T14:00:00.000Z', '2026-11-24', '2026-11-24T14:00:00.000Z'],
    ['2026-11-25T05:59:59.000Z', '2026-11-24', '2026-11-25T05:59:59.000Z'],
    ['2026-11-25T06:00:00.000Z', '2026-11-24', null],
    ['2026-11-24T05:59:00.000Z', '2026-11-24', null],
  ])('createdAt %s, date %s → %s (America/Chicago)', (createdAt, date, expected) => {
    expect(importedEatenAt({ date }, createdAt, 'America/Chicago')).toBe(expected);
  });
});
