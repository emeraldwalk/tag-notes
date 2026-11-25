import { Hono } from 'hono';
import { InvalidExportFileError, parseExportFile } from '../../pwa/src/lib/export';
import type { ImportableFoodEntry } from '../../pwa/src/lib/foods/types';
import { parseNoteText } from '../../pwa/src/lib/notes/parse';
import type { ImportableNote } from '../../pwa/src/lib/notes/types';
import type { AppEnv } from './app';
import { invalid, localDate, MAX_IMPORT_BYTES, readJson, toIso } from './body';
import { upsertTargets } from './foods';
import { rewriteTags } from './notes';

/** D1 batch size (plan 8): at most this many statements per `db.batch`. */
export const MAX_BATCH = 100;
const MAX_ID_LENGTH = 200;

export interface ImportResult {
  notes: number;
  foods: number;
  targets: boolean;
  /** Rows whose id is another user's: left alone. */
  skipped: number;
}

/**
 * `eatenAt` for an imported food: its own when the file has one (an export from this app), else `createdAt` when
 * that falls on the entry's `date` in the owner's zone (it was logged as it was eaten), else unknown.
 */
export function importedEatenAt(food: Pick<ImportableFoodEntry, 'eatenAt' | 'date'>, createdAt: string, timeZone: string): string | null {
  if (food.eatenAt) return toIso(food.eatenAt);
  return localDate(createdAt, timeZone) === food.date ? createdAt : null;
}

const badId = (id: string | undefined) => id !== undefined && (id.length === 0 || id.length > MAX_ID_LENGTH);

/** Runs statement groups in batches of at most `MAX_BATCH`, never splitting a group; returns each group's first result. */
async function runGroups(db: D1Database, groups: D1PreparedStatement[][]): Promise<D1Result[]> {
  const firsts: D1Result[] = [];
  let batch: D1PreparedStatement[] = [];
  let starts: number[] = [];
  const flush = async () => {
    if (batch.length === 0) return;
    const results = await db.batch(batch);
    for (const at of starts) firsts.push(results[at]!);
    batch = [];
    starts = [];
  };
  for (const group of groups) {
    if (batch.length + group.length > MAX_BATCH) await flush();
    starts.push(batch.length);
    batch.push(...group);
  }
  await flush();
  return firsts;
}

/** `POST /api/import`: plan 6's export file (v2, v1 or a bare array of notes), upserted by id for this user. */
export function importApi(db: D1Database, timeZone: string): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.post('/', async (c) => {
    const read = await readJson(c, MAX_IMPORT_BYTES);
    if (read instanceof Response) return read;
    let bundle;
    try {
      // parseExportFile takes text; re-serializing is cheaper to maintain than a second parser for objects.
      bundle = parseExportFile(JSON.stringify(read.value));
    } catch (err) {
      if (err instanceof InvalidExportFileError) return invalid(err.message);
      throw err;
    }
    const bad = bundle.notes.findIndex((n) => badId(n.id));
    if (bad >= 0) return invalid(`Note at index ${bad} has an invalid "id".`);
    const badFood = bundle.foods.findIndex((f) => badId(f.id));
    if (badFood >= 0) return invalid(`Food at index ${badFood} has an invalid "id".`);

    const sub = c.var.session.sub;
    const now = new Date().toISOString();

    const noteGroups = bundle.notes.map((n: ImportableNote) => {
      const id = n.id ?? crypto.randomUUID();
      const parsed = parseNoteText(n.rawText);
      const createdAt = toIso(n.createdAt) ?? now;
      const updatedAt = toIso(n.updatedAt) ?? createdAt;
      return [
        db
          .prepare(
            `INSERT INTO notes (id, user_id, raw_text, title, body, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (id) DO UPDATE SET raw_text = excluded.raw_text, title = excluded.title, body = excluded.body,
               tags = excluded.tags, created_at = excluded.created_at, updated_at = excluded.updated_at
             WHERE notes.user_id = excluded.user_id`,
          )
          .bind(id, sub, n.rawText, parsed.title, parsed.body, JSON.stringify(parsed.tags), createdAt, updatedAt),
        ...rewriteTags(db, sub, id),
      ];
    });
    const noteResults = await runGroups(db, noteGroups);

    const foodGroups = bundle.foods.map((f) => {
      const createdAt = toIso(f.createdAt) ?? now;
      return [
        db
          .prepare(
            `INSERT INTO foods (id, user_id, name, serving_size, quantity, protein, calories, carbs, date, eaten_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (id) DO UPDATE SET name = excluded.name, serving_size = excluded.serving_size, quantity = excluded.quantity,
               protein = excluded.protein, calories = excluded.calories, carbs = excluded.carbs, date = excluded.date,
               eaten_at = excluded.eaten_at, created_at = excluded.created_at, updated_at = excluded.updated_at
             WHERE foods.user_id = excluded.user_id`,
          )
          .bind(f.id ?? crypto.randomUUID(), sub, f.name, f.servingSize ?? null, f.quantity, f.protein, f.calories, f.carbs, f.date,
            importedEatenAt(f, createdAt, timeZone), createdAt, now),
      ];
    });
    const foodResults = await runGroups(db, foodGroups);

    if (bundle.foodTargets) await upsertTargets(db, sub, bundle.foodTargets).run();

    const notes = noteResults.filter((r) => r.meta.changes > 0).length;
    const foods = foodResults.filter((r) => r.meta.changes > 0).length;
    const result: ImportResult = {
      notes,
      foods,
      targets: Boolean(bundle.foodTargets),
      skipped: noteResults.length - notes + (foodResults.length - foods),
    };
    return c.json(result, 200, { 'Cache-Control': 'no-store' });
  });
  return app;
}
