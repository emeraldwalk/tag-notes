// The daily import budget (budget.ts): imports stop at a share of the account's D1 writes, so a large import can't
// stop the other apps and the IdP from saving, as it did on 2026-11-26.
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { IMPORT_BUDGET_ROWS, importRowsToday } from '../src/budget';
import { clearData, Jar, send, sendJson, signIn, useHarness } from './harness';

const h = useHarness();
beforeEach(clearData);

const today = () => new Date().toISOString().slice(0, 10);
const file = (notes: { id: string; rawText: string }[]) => ({ app: 'tag-notes', version: 2, exportedAt: '2026-11-26T12:00:00.000Z', notes });
const readings = [
  { ts: '2026-11-20T10:00:00Z', mgDl: 100, kind: 'historic' },
  { ts: '2026-11-20T10:15:00Z', mgDl: 105, kind: 'historic' },
];

describe('the daily import budget', () => {
  it('counts what imports write, and costs nothing for a file already imported', async () => {
    const jar = await signIn(h, new Jar());
    const notes = [
      { id: 'b-1', rawText: 'One\n\n:a, b' },
      { id: 'b-2', rawText: 'Two\n\n:a' },
    ];
    expect((await sendJson(h, jar, 'POST', '/api/import', file(notes))).status).toBe(200);
    const afterNotes = await importRowsToday(env.DB);
    expect(afterNotes).toBeGreaterThan(0);

    expect((await sendJson(h, jar, 'POST', '/api/glucose/import', { readings })).status).toBe(200);
    const afterGlucose = await importRowsToday(env.DB);
    expect(afterGlucose).toBeGreaterThan(afterNotes);
    // Readings already stored write nothing.
    expect((await sendJson(h, jar, 'POST', '/api/glucose/import', { readings })).status).toBe(200);
    expect(await importRowsToday(env.DB)).toBe(afterGlucose);

    // The same notes again: the notes themselves are upserted, but their unchanged tags aren't rewritten.
    expect((await sendJson(h, jar, 'POST', '/api/import', file(notes))).status).toBe(200);
    const again = (await importRowsToday(env.DB)) - afterGlucose;
    expect(again).toBeLessThan(afterNotes);
    const tags = await env.DB.prepare("SELECT note_id, tag FROM note_tags WHERE note_id LIKE 'b-%' ORDER BY note_id, tag").all();
    expect(tags.results).toEqual([
      { note_id: 'b-1', tag: 'a' },
      { note_id: 'b-1', tag: 'b' },
      { note_id: 'b-2', tag: 'a' },
    ]);

    // A changed note drops a tag it no longer has.
    expect((await sendJson(h, jar, 'POST', '/api/import', file([{ id: 'b-1', rawText: 'One\n\n:b' }]))).status).toBe(200);
    const b1 = await env.DB.prepare("SELECT tag FROM note_tags WHERE note_id = 'b-1'").all();
    expect(b1.results).toEqual([{ tag: 'b' }]);
  });

  it('refuses imports once used up, and leaves everything else working', async () => {
    const jar = await signIn(h, new Jar());
    await env.DB.prepare('INSERT INTO import_budget (day, rows) VALUES (?, ?)').bind(today(), IMPORT_BUDGET_ROWS).run();

    const backup = await sendJson(h, jar, 'POST', '/api/import', file([{ id: 'b-3', rawText: 'Three' }]));
    expect(backup.status).toBe(429);
    expect(await backup.json()).toEqual({ error: 'import_budget' });
    const csv = await sendJson(h, jar, 'POST', '/api/glucose/import', { readings });
    expect(csv.status).toBe(429);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM notes WHERE id = 'b-3'").first<{ n: number }>())!.n).toBe(0);

    // A day's budget is its own: yesterday's use doesn't count.
    await env.DB.prepare('UPDATE import_budget SET day = ?').bind('2000-01-01').run();
    expect((await sendJson(h, jar, 'POST', '/api/import', file([{ id: 'b-3', rawText: 'Three' }]))).status).toBe(200);

    // Ordinary saves never count against it.
    expect((await send(h, jar, '/api/notes')).status).toBe(200);
  });
});
