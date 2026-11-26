// A daily budget for bulk imports (migration 0006). The Workers free plan allows 100,000 rows written per day for the
// whole Cloudflare account, shared with the family apps and the IdP; on 2026-11-26 one large import here used it all
// and they stopped saving (and signing in) until the reset. Imports now stop at a share of it and say to finish
// another day. Each import is idempotent by id, so importing the same file again carries on.
import { jsonError } from './http';

/** Rows written by imports per UTC day: a quarter of the account's daily limit. */
export const IMPORT_BUDGET_ROWS = 25_000;

const day = (now: Date) => now.toISOString().slice(0, 10);

/** Today's import rows so far. */
export async function importRowsToday(db: D1Database, now = new Date()): Promise<number> {
  const row = await db.prepare('SELECT rows FROM import_budget WHERE day = ?').bind(day(now)).first<{ rows: number }>();
  return row?.rows ?? 0;
}

/** The 429 to send when today's budget is used up, else null. */
export async function importBudgetRefusal(db: D1Database, now = new Date()): Promise<Response | null> {
  return (await importRowsToday(db, now)) >= IMPORT_BUDGET_ROWS ? jsonError(429, 'import_budget') : null;
}

/** Rows D1 says these results wrote (index rows included), falling back to rows changed. */
export function rowsWritten(results: D1Result[]): number {
  return results.reduce((n, r) => n + (r.meta.rows_written ?? r.meta.changes ?? 0), 0);
}

/** Adds `rows` to today's count (one more row written, and old days pruned now and then). */
export async function spendImportBudget(db: D1Database, rows: number, now = new Date()): Promise<void> {
  if (rows <= 0) return;
  const today = day(now);
  await db.batch([
    db.prepare('INSERT INTO import_budget (day, rows) VALUES (?, ?) ON CONFLICT (day) DO UPDATE SET rows = rows + excluded.rows').bind(today, rows),
    db.prepare('DELETE FROM import_budget WHERE day < ?').bind(day(new Date(now.getTime() - 7 * 86_400_000))),
  ]);
}
