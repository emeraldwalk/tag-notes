import { type Context, Hono } from 'hono';
import { InvalidExportFileError, parseFoodEntry, parseFoodTargets } from '../../pwa/src/lib/export';
import type { FoodEntry, FoodTargets, ImportableFoodEntry } from '../../pwa/src/lib/foods/types';
import type { AppEnv } from './app';
import { guardedInsert, type InsertGuard, invalid, readJson, toIso } from './body';
import { jsonError } from './http';

export interface FoodRow {
  id: string;
  name: string;
  serving_size: string | null;
  quantity: number;
  protein: number;
  calories: number;
  carbs: number;
  date: string;
  eaten_at: string | null;
  created_at: string;
}

const COLUMNS = 'id, name, serving_size, quantity, protein, calories, carbs, date, eaten_at, created_at';
/** Newest first: by when it was eaten, else when it was logged. */
const ORDER = 'ORDER BY COALESCE(eaten_at, created_at) DESC, created_at DESC';
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
/** Recent foods are a list of chips to tap; enough for anyone's repertoire, bounded for CPU. */
const RECENT_LIMIT = 200;

export function toFood(r: FoodRow): FoodEntry {
  const food: FoodEntry = {
    id: r.id,
    name: r.name,
    quantity: r.quantity,
    protein: r.protein,
    calories: r.calories,
    carbs: r.carbs,
    date: r.date,
    createdAt: r.created_at,
  };
  if (r.serving_size !== null) food.servingSize = r.serving_size;
  if (r.eaten_at !== null) food.eatenAt = r.eaten_at;
  return food;
}

/** A food entry to write: `date` is its local day, `eatenAt` UTC ISO or null. */
export interface FoodInsert {
  name: string;
  servingSize?: string | null;
  quantity: number;
  protein: number;
  calories: number;
  carbs: number;
  date: string;
  eatenAt: string | null;
}

/** The INSERT for one food entry (`POST /api/foods`, and accepting a food proposal under a guard), returning its row. */
export function foodInsert(db: D1Database, userId: string, id: string, f: FoodInsert, now: string, guard?: InsertGuard): D1PreparedStatement {
  return guardedInsert(
    db,
    'foods',
    ['id', 'user_id', 'name', 'serving_size', 'quantity', 'protein', 'calories', 'carbs', 'date', 'eaten_at', 'created_at', 'updated_at'],
    [id, userId, f.name, f.servingSize ?? null, f.quantity, f.protein, f.calories, f.carbs, f.date, f.eatenAt, now, now],
    guard,
    COLUMNS,
  );
}

/** A request body as a food entry; `id` and `createdAt` in it are ignored. */
async function foodFrom(c: Context<AppEnv>): Promise<ImportableFoodEntry | Response> {
  const read = await readJson(c);
  if (read instanceof Response) return read;
  try {
    return parseFoodEntry(read.value, 'Food');
  } catch (err) {
    if (err instanceof InvalidExportFileError) return invalid(err.message);
    throw err;
  }
}

/** `/api/foods` and `/api/food-targets`, mounted inside `/api`. */
export function foodsApi(db: D1Database): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const noStore = { 'Cache-Control': 'no-store' };

  app.get('/foods', async (c) => {
    const sub = c.var.session.sub;
    const date = c.req.query('date');
    if (date !== undefined && !DATE_KEY.test(date)) return invalid('date must be YYYY-MM-DD.');
    const stmt = date
      ? db.prepare(`SELECT ${COLUMNS} FROM foods WHERE user_id = ? AND date = ? ${ORDER}`).bind(sub, date)
      : db.prepare(`SELECT ${COLUMNS} FROM foods WHERE user_id = ? ${ORDER}`).bind(sub);
    const { results } = await stmt.all<FoodRow>();
    return c.json({ foods: results.map(toFood) }, 200, noStore);
  });

  app.get('/foods/recent', async (c) => {
    const { results } = await db
      .prepare(
        `SELECT ${COLUMNS} FROM (
           SELECT *, ROW_NUMBER() OVER (PARTITION BY lower(trim(name)) ORDER BY created_at DESC) AS rn
           FROM foods WHERE user_id = ?
         ) WHERE rn = 1 ORDER BY created_at DESC LIMIT ${RECENT_LIMIT}`,
      )
      .bind(c.var.session.sub)
      .all<FoodRow>();
    return c.json({ foods: results.map(toFood) }, 200, noStore);
  });

  app.post('/foods', async (c) => {
    const input = await foodFrom(c);
    if (input instanceof Response) return input;
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const row = await foodInsert(db, c.var.session.sub, id, { ...input, eatenAt: toIso(input.eatenAt) }, now).first<FoodRow>();
    return c.json({ food: toFood(row!) }, 201, noStore);
  });

  app.put('/foods/:id', async (c) => {
    const input = await foodFrom(c);
    if (input instanceof Response) return input;
    const row = await db
      .prepare(
        `UPDATE foods SET name = ?, serving_size = ?, quantity = ?, protein = ?, calories = ?, carbs = ?, date = ?, eaten_at = ?,
         updated_at = ? WHERE id = ? AND user_id = ? RETURNING ${COLUMNS}`,
      )
      .bind(input.name, input.servingSize ?? null, input.quantity, input.protein, input.calories, input.carbs, input.date,
        toIso(input.eatenAt), new Date().toISOString(), c.req.param('id'), c.var.session.sub)
      .first<FoodRow>();
    return row ? c.json({ food: toFood(row) }, 200, noStore) : jsonError(404, 'not_found');
  });

  app.delete('/foods/:id', async (c) => {
    const res = await db.prepare('DELETE FROM foods WHERE id = ? AND user_id = ?').bind(c.req.param('id'), c.var.session.sub).run();
    return res.meta.changes ? c.body(null, 204) : jsonError(404, 'not_found');
  });

  app.get('/food-targets', async (c) => {
    const row = await db.prepare('SELECT protein, calories FROM food_targets WHERE user_id = ?').bind(c.var.session.sub).first<FoodTargets>();
    return c.json({ targets: row ? { protein: row.protein, calories: row.calories } : null }, 200, noStore);
  });

  app.put('/food-targets', async (c) => {
    const read = await readJson(c);
    if (read instanceof Response) return read;
    let targets: FoodTargets;
    try {
      targets = parseFoodTargets(read.value);
    } catch (err) {
      if (err instanceof InvalidExportFileError) return invalid(err.message);
      throw err;
    }
    await upsertTargets(db, c.var.session.sub, targets).run();
    return c.json({ targets }, 200, noStore);
  });

  return app;
}

export const upsertTargets = (db: D1Database, userId: string, t: FoodTargets) =>
  db
    .prepare(
      `INSERT INTO food_targets (user_id, protein, calories) VALUES (?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET protein = excluded.protein, calories = excluded.calories`,
    )
    .bind(userId, t.protein, t.calories);
