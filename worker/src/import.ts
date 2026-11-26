import { Hono } from 'hono';
import { InvalidExportFileError, parseExportFile } from '../../pwa/src/lib/export';
import type { ImportableFoodEntry } from '../../pwa/src/lib/foods/types';
import { parseNoteText } from '../../pwa/src/lib/notes/parse';
import type { ImportableNote } from '../../pwa/src/lib/notes/types';
import type { AppEnv } from './app';
import { invalid, localDate, MAX_IMPORT_BYTES, readJson, toIso } from './body';
import { importBudgetRefusal, rowsWritten, spendImportBudget } from './budget';
import { upsertTargets } from './foods';
import { rewriteTags } from './notes';

/** D1 batch size (plan 8): at most this many statements per `db.batch`. */
export const MAX_BATCH = 100;
const MAX_ID_LENGTH = 200;

export interface ImportResult {
  notes: number;
  foods: number;
  targets: boolean;
  medicines: number;
  doses: number;
  rawEntries: number;
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

/**
 * Runs statement groups in batches of at most `MAX_BATCH`, never splitting a group; returns each group's first result.
 * Every result also goes in `all`, for the import budget.
 */
async function runGroups(db: D1Database, groups: D1PreparedStatement[][], all: D1Result[]): Promise<D1Result[]> {
  const firsts: D1Result[] = [];
  let batch: D1PreparedStatement[] = [];
  let starts: number[] = [];
  const flush = async () => {
    if (batch.length === 0) return;
    const results = await db.batch(batch);
    all.push(...results);
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

/**
 * `POST /api/import`: plan 6's export file (v2, v1 or a bare array of notes), upserted by id for this user, in the
 * order notes, foods, targets, medicines, doses (plan 16), raw entries (plan 9).
 */
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
    const badMedicine = bundle.medicines.findIndex((m) => badId(m.id));
    if (badMedicine >= 0) return invalid(`Medicine at index ${badMedicine} has an invalid "id".`);
    const badDose = bundle.doses.findIndex((d) => badId(d.id) || badId(d.medicineId));
    if (badDose >= 0) return invalid(`Dose at index ${badDose} has an invalid "id" or "medicineId".`);
    const badEntry = bundle.rawEntries.findIndex((e) => badId(e.id) || badId(e.outcomeId));
    if (badEntry >= 0) return invalid(`Raw entry at index ${badEntry} has an invalid "id" or "outcomeId".`);

    // A share of the account's daily D1 writes (budget.ts): past it, the rest waits for another day.
    const refused = await importBudgetRefusal(db);
    if (refused) return refused;
    const written: D1Result[] = [];
    try {
      return await save(c.var.session.sub, bundle, written);
    } finally {
      await spendImportBudget(db, rowsWritten(written)).catch(() => undefined);
    }
  });

  async function save(sub: string, bundle: ReturnType<typeof parseExportFile>, written: D1Result[]): Promise<Response> {
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
    const noteResults = await runGroups(db, noteGroups, written);

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
    const foodResults = await runGroups(db, foodGroups, written);

    if (bundle.foodTargets) written.push(await upsertTargets(db, sub, bundle.foodTargets).run());

    // Medicines: names are unique per user (case-insensitively), so one whose name is already another of this
    // user's medicines (or earlier in the file) is merged into it rather than inserted. Its doses link by name.
    let mergedMedicines = 0;
    let medicineResults: D1Result[] = [];
    if (bundle.medicines.length > 0) {
      const { results: existing } = await db
        .prepare('SELECT id, lower(name) AS key FROM medicines WHERE user_id = ?')
        .bind(sub)
        .all<{ id: string; key: string }>();
      const idByName = new Map(existing.map((m) => [m.key, m.id]));
      const medicineGroups: D1PreparedStatement[][] = [];
      for (const m of bundle.medicines) {
        const id = m.id ?? crypto.randomUUID();
        const key = m.name.toLowerCase();
        const holder = idByName.get(key);
        if (holder !== undefined && holder !== id) {
          mergedMedicines++;
          continue;
        }
        idByName.set(key, id);
        medicineGroups.push([
          db
            .prepare(
              `INSERT INTO medicines (id, user_id, name, default_dose, active, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT (id) DO UPDATE SET name = excluded.name, default_dose = excluded.default_dose, active = excluded.active,
                 sort_order = excluded.sort_order, created_at = excluded.created_at
               WHERE medicines.user_id = excluded.user_id`,
            )
            .bind(id, sub, m.name, m.defaultDose ?? null, m.active ? 1 : 0, m.sortOrder, toIso(m.createdAt) ?? now),
        ]);
      }
      medicineResults = await runGroups(db, medicineGroups, written);
    }

    // Doses: `medicineId` links to this user's medicine with that id, else (merged above, or in another chunk) the
    // one with the dose's name; otherwise none. Never to another user's.
    const doseGroups = bundle.doses.map((d) => [
      db
        .prepare(
          `INSERT INTO doses (id, user_id, medicine_id, medicine_name, dose, taken_at, note, source, created_at)
           VALUES (?1, ?2,
             CASE WHEN ?3 IS NULL THEN NULL ELSE COALESCE(
               (SELECT id FROM medicines WHERE id = ?3 AND user_id = ?2),
               (SELECT id FROM medicines WHERE user_id = ?2 AND lower(name) = lower(?4))) END,
             ?4, ?5, ?6, ?7, ?8, ?9)
           ON CONFLICT (id) DO UPDATE SET medicine_id = excluded.medicine_id, medicine_name = excluded.medicine_name,
             dose = excluded.dose, taken_at = excluded.taken_at, note = excluded.note, source = excluded.source,
             created_at = excluded.created_at
           WHERE doses.user_id = excluded.user_id`,
        )
        .bind(d.id ?? crypto.randomUUID(), sub, d.medicineId ?? null, d.medicineName, d.dose ?? null, toIso(d.takenAt),
          d.note ?? null, d.source, toIso(d.createdAt) ?? now),
    ]);
    const doseResults = await runGroups(db, doseGroups, written);

    // Raw entries (plan 9): restored as they were; the token that posted one isn't in the file, so a new row has none
    // and an existing row keeps its own.
    const entryGroups = bundle.rawEntries.map((e) => {
      const occurredAt = toIso(e.occurredAt)!;
      return [
        db
          .prepare(
            `INSERT INTO raw_entries (id, user_id, text, source, token_id, occurred_at, received_at, status, outcome_kind, outcome_id, updated_at)
             VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (id) DO UPDATE SET text = excluded.text, source = excluded.source, occurred_at = excluded.occurred_at,
               received_at = excluded.received_at, status = excluded.status, outcome_kind = excluded.outcome_kind,
               outcome_id = excluded.outcome_id, updated_at = excluded.updated_at
             WHERE raw_entries.user_id = excluded.user_id`,
          )
          .bind(e.id ?? crypto.randomUUID(), sub, e.text, e.source, occurredAt, toIso(e.receivedAt) ?? occurredAt, e.status,
            e.outcomeKind ?? null, e.outcomeId ?? null, toIso(e.updatedAt) ?? now),
      ];
    });
    const entryResults = await runGroups(db, entryGroups, written);

    const notes = noteResults.filter((r) => r.meta.changes > 0).length;
    const foods = foodResults.filter((r) => r.meta.changes > 0).length;
    const medicinesSaved = medicineResults.filter((r) => r.meta.changes > 0).length;
    const doses = doseResults.filter((r) => r.meta.changes > 0).length;
    const rawEntries = entryResults.filter((r) => r.meta.changes > 0).length;
    const result: ImportResult = {
      notes,
      foods,
      targets: Boolean(bundle.foodTargets),
      medicines: medicinesSaved + mergedMedicines,
      doses,
      rawEntries,
      skipped: noteResults.length - notes + (foodResults.length - foods) + (medicineResults.length - medicinesSaved) + (doseResults.length - doses)
        + (entryResults.length - rawEntries),
    };
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  }
  return app;
}
