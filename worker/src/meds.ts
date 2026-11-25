import { Hono } from 'hono';
import { isDoseSource, isIsoWithZone, MAX_MEDICINE_TEXT, medicineName } from '../../pwa/src/lib/export';
import type { ConvertResult, Dose, DoseSource, Medicine } from '../../pwa/src/lib/meds/types';
import type { AppEnv } from './app';
import { invalid, readJson, toIso } from './body';
import { jsonError } from './http';

export interface MedicineRow {
  id: string;
  name: string;
  default_dose: string | null;
  active: number;
  sort_order: number;
  created_at: string;
}

export interface DoseRow {
  id: string;
  medicine_id: string | null;
  medicine_name: string;
  dose: string | null;
  taken_at: string;
  note: string | null;
  source: string;
  created_at: string;
}

const MEDICINE_COLUMNS = 'id, name, default_dose, active, sort_order, created_at';
const DOSE_COLUMNS = 'id, medicine_id, medicine_name, dose, taken_at, note, source, created_at';
const MEDICINE_ORDER = 'ORDER BY sort_order, name COLLATE NOCASE, created_at';
const DOSE_ORDER = 'ORDER BY taken_at DESC, created_at DESC';
/** Longest range `GET /api/doses` answers (plan 16). */
export const MAX_RANGE_DAYS = 92;
/** Notes per `convert-notes` request: two statements each, all in one D1 batch (≤ 100 statements, as plan 8). */
export const MAX_CONVERT_NOTES = 50;
/** The tag converted notes must still carry. */
export const MEDS_TAG = 'meds';
const MAX_NOTE_LENGTH = 20_000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function toMedicine(r: MedicineRow): Medicine {
  const medicine: Medicine = { id: r.id, name: r.name, active: r.active !== 0, sortOrder: r.sort_order, createdAt: r.created_at };
  if (r.default_dose !== null) medicine.defaultDose = r.default_dose;
  return medicine;
}

export function toDose(r: DoseRow): Dose {
  const dose: Dose = { id: r.id, medicineName: r.medicine_name, takenAt: r.taken_at, source: r.source as DoseSource, createdAt: r.created_at };
  if (r.medicine_id !== null) dose.medicineId = r.medicine_id;
  if (r.dose !== null) dose.dose = r.dose;
  if (r.note !== null) dose.note = r.note;
  return dose;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

type Field<T> = { ok: true; value: T } | { ok: false; detail: string };

/** An optional free-text field: absent → undefined; `null` or blank → null (cleared); else trimmed. */
function optionalText(body: Record<string, unknown>, key: string, max: number): Field<string | null | undefined> {
  const value = body[key];
  if (value === undefined) return { ok: true, value: undefined };
  if (value === null) return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false, detail: `${key} must be a string.` };
  if (value.length > max) return { ok: false, detail: `${key} must be at most ${max} characters.` };
  const trimmed = value.trim();
  return { ok: true, value: trimmed === '' ? null : trimmed };
}

/** An optional timestamp with a zone, as UTC ISO; absent → undefined. */
function optionalTime(body: Record<string, unknown>, key: string): Field<string | undefined> {
  const value = body[key];
  if (value === undefined) return { ok: true, value: undefined };
  if (!isIsoWithZone(value)) return { ok: false, detail: `${key} must be an ISO 8601 time with a zone.` };
  return { ok: true, value: toIso(value)! };
}

const nameTaken = (db: D1Database, userId: string, name: string, exceptId: string | null) =>
  db
    .prepare('SELECT 1 AS x FROM medicines WHERE user_id = ? AND lower(name) = lower(?) AND (? IS NULL OR id != ?)')
    .bind(userId, name, exceptId, exceptId)
    .first();

/** `/api/medicines` and `/api/doses`, mounted inside `/api` (the session middleware has run). */
export function medsApi(db: D1Database): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const noStore = { 'Cache-Control': 'no-store' };

  const getMedicine = (userId: string, id: string) =>
    db.prepare(`SELECT ${MEDICINE_COLUMNS} FROM medicines WHERE id = ? AND user_id = ?`).bind(id, userId).first<MedicineRow>();

  app.get('/medicines', async (c) => {
    const { results } = await db
      .prepare(`SELECT ${MEDICINE_COLUMNS} FROM medicines WHERE user_id = ? ${MEDICINE_ORDER}`)
      .bind(c.var.session.sub)
      .all<MedicineRow>();
    return c.json({ medicines: results.map(toMedicine) }, 200, noStore);
  });

  app.post('/medicines', async (c) => {
    const read = await readJson(c);
    if (read instanceof Response) return read;
    const body = read.value;
    if (!isRecord(body)) return invalid('Body must be an object.');
    const name = medicineName(body['name']);
    if (name === undefined) return invalid(`name must be 1–${MAX_MEDICINE_TEXT} characters.`);
    const defaultDose = optionalText(body, 'defaultDose', MAX_MEDICINE_TEXT);
    if (!defaultDose.ok) return invalid(defaultDose.detail);

    const sub = c.var.session.sub;
    if (await nameTaken(db, sub, name, null)) return jsonError(409, 'duplicate_name');
    const row = await db
      .prepare(
        `INSERT INTO medicines (id, user_id, name, default_dose, active, sort_order, created_at)
         VALUES (?, ?, ?, ?, 1, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM medicines WHERE user_id = ?), ?)
         ON CONFLICT (user_id, name) DO NOTHING
         RETURNING ${MEDICINE_COLUMNS}`,
      )
      .bind(crypto.randomUUID(), sub, name, defaultDose.value ?? null, sub, new Date().toISOString())
      .first<MedicineRow>();
    // A racing add of the same name.
    if (!row) return jsonError(409, 'duplicate_name');
    return c.json({ medicine: toMedicine(row) }, 201, noStore);
  });

  app.put('/medicines/:id', async (c) => {
    const read = await readJson(c);
    if (read instanceof Response) return read;
    const body = read.value;
    if (!isRecord(body)) return invalid('Body must be an object.');
    const sub = c.var.session.sub;
    const id = c.req.param('id');

    let name: string | undefined;
    if (body['name'] !== undefined) {
      name = medicineName(body['name']);
      if (name === undefined) return invalid(`name must be 1–${MAX_MEDICINE_TEXT} characters.`);
    }
    const defaultDose = optionalText(body, 'defaultDose', MAX_MEDICINE_TEXT);
    if (!defaultDose.ok) return invalid(defaultDose.detail);
    const active = body['active'];
    if (active !== undefined && typeof active !== 'boolean') return invalid('active must be true or false.');
    const sortOrder = body['sortOrder'];
    if (sortOrder !== undefined && !Number.isInteger(sortOrder)) return invalid('sortOrder must be an integer.');

    const current = await getMedicine(sub, id);
    if (!current) return jsonError(404, 'not_found');
    if (name !== undefined && (await nameTaken(db, sub, name, id))) return jsonError(409, 'duplicate_name');

    const row = await db
      .prepare(
        `UPDATE medicines SET name = ?, default_dose = ?, active = ?, sort_order = ? WHERE id = ? AND user_id = ?
         RETURNING ${MEDICINE_COLUMNS}`,
      )
      .bind(
        name ?? current.name,
        defaultDose.value === undefined ? current.default_dose : defaultDose.value,
        active === undefined ? current.active : active ? 1 : 0,
        (sortOrder as number | undefined) ?? current.sort_order,
        id,
        sub,
      )
      .first<MedicineRow>();
    return row ? c.json({ medicine: toMedicine(row) }, 200, noStore) : jsonError(404, 'not_found');
  });

  app.delete('/medicines/:id', async (c) => {
    // Its doses keep `medicine_name`; the foreign key sets their `medicine_id` to NULL.
    const res = await db.prepare('DELETE FROM medicines WHERE id = ? AND user_id = ?').bind(c.req.param('id'), c.var.session.sub).run();
    return res.meta.changes ? c.body(null, 204) : jsonError(404, 'not_found');
  });

  app.get('/doses', async (c) => {
    const sub = c.var.session.sub;
    const fromQ = c.req.query('from');
    const toQ = c.req.query('to');
    if (fromQ === undefined && toQ === undefined) {
      // Every dose, for Export All (rows are small; as `GET /api/foods`).
      const { results } = await db.prepare(`SELECT ${DOSE_COLUMNS} FROM doses WHERE user_id = ? ${DOSE_ORDER}`).bind(sub).all<DoseRow>();
      return c.json({ doses: results.map(toDose) }, 200, noStore);
    }
    if (!isIsoWithZone(fromQ) || !isIsoWithZone(toQ)) return invalid('from and to must both be ISO 8601 times with a zone.');
    const from = toIso(fromQ)!;
    const to = toIso(toQ)!;
    const span = Date.parse(to) - Date.parse(from);
    if (span <= 0) return invalid('to must be after from.');
    if (span > MAX_RANGE_DAYS * DAY_MS) return invalid(`The range can be at most ${MAX_RANGE_DAYS} days.`);
    const { results } = await db
      .prepare(`SELECT ${DOSE_COLUMNS} FROM doses WHERE user_id = ? AND taken_at >= ? AND taken_at < ? ${DOSE_ORDER}`)
      .bind(sub, from, to)
      .all<DoseRow>();
    return c.json({ doses: results.map(toDose) }, 200, noStore);
  });

  app.post('/doses', async (c) => {
    const read = await readJson(c);
    if (read instanceof Response) return read;
    const body = read.value;
    if (!isRecord(body)) return invalid('Body must be an object.');
    const sub = c.var.session.sub;

    const source = body['source'];
    if (!isDoseSource(source)) return invalid('source must be one of tap, manual, note, voice.');
    const medicineId = body['medicineId'];
    if (medicineId !== undefined && medicineId !== null && typeof medicineId !== 'string') return invalid('medicineId must be a string.');
    const dose = optionalText(body, 'dose', MAX_MEDICINE_TEXT);
    if (!dose.ok) return invalid(dose.detail);
    const note = optionalText(body, 'note', MAX_NOTE_LENGTH);
    if (!note.ok) return invalid(note.detail);
    const takenAt = optionalTime(body, 'takenAt');
    if (!takenAt.ok) return invalid(takenAt.detail);

    let name: string | undefined;
    let doseText = dose.value ?? null;
    if (typeof medicineId === 'string') {
      const medicine = await getMedicine(sub, medicineId);
      if (!medicine) return invalid('medicineId is not one of your medicines.');
      name = medicine.name;
      if (dose.value === undefined) doseText = medicine.default_dose;
    } else {
      if (body['medicineName'] === undefined) return invalid('medicineId or medicineName is required.');
      name = medicineName(body['medicineName']);
      if (name === undefined) return invalid(`medicineName must be 1–${MAX_MEDICINE_TEXT} characters.`);
    }

    const now = new Date().toISOString();
    const row = await db
      .prepare(
        `INSERT INTO doses (id, user_id, medicine_id, medicine_name, dose, taken_at, note, source, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING ${DOSE_COLUMNS}`,
      )
      .bind(crypto.randomUUID(), sub, typeof medicineId === 'string' ? medicineId : null, name, doseText, takenAt.value ?? now,
        note.value ?? null, source, now)
      .first<DoseRow>();
    return c.json({ dose: toDose(row!) }, 201, noStore);
  });

  app.post('/doses/convert-notes', async (c) => {
    const read = await readJson(c);
    if (read instanceof Response) return read;
    const body = read.value;
    const groups = isRecord(body) ? body['groups'] : undefined;
    if (!Array.isArray(groups)) return invalid('groups must be an array.');
    const pairs: { noteId: string; medicineId: string }[] = [];
    for (const [index, group] of groups.entries()) {
      if (!isRecord(group) || typeof group['medicineId'] !== 'string' || !Array.isArray(group['noteIds'])
        || !group['noteIds'].every((id) => typeof id === 'string')) {
        return invalid(`Group at index ${index} needs a medicineId and an array of noteIds.`);
      }
      for (const noteId of group['noteIds'] as string[]) pairs.push({ noteId, medicineId: group['medicineId'] });
    }
    if (pairs.length > MAX_CONVERT_NOTES) return invalid(`At most ${MAX_CONVERT_NOTES} notes per request.`);
    if (pairs.length === 0) return c.json({ converted: 0, skipped: 0 } satisfies ConvertResult, 200, noStore);

    const sub = c.var.session.sub;
    const medicineIds = [...new Set(pairs.map((p) => p.medicineId))];
    const { results: owned } = await db
      .prepare(`SELECT id FROM medicines WHERE user_id = ? AND id IN (SELECT value FROM json_each(?))`)
      .bind(sub, JSON.stringify(medicineIds))
      .all<{ id: string }>();
    if (owned.length !== medicineIds.length) return invalid('A medicineId is not one of your medicines.');

    // Per note: a dose from it, only while it is this user's and still tagged; then the note (its tags cascade).
    // One batch, so a failure leaves every note in place. A repeated note id converts once (the note is gone).
    const now = new Date().toISOString();
    const statements = pairs.flatMap(({ noteId, medicineId }) => [
      db
        .prepare(
          `INSERT INTO doses (id, user_id, medicine_id, medicine_name, dose, taken_at, note, source, created_at)
           SELECT ?, n.user_id, m.id, m.name, m.default_dose, n.created_at, n.raw_text, 'note', ?
           FROM notes n
           JOIN note_tags t ON t.note_id = n.id AND t.user_id = n.user_id AND t.tag = ?
           JOIN medicines m ON m.id = ? AND m.user_id = n.user_id
           WHERE n.id = ? AND n.user_id = ?`,
        )
        .bind(crypto.randomUUID(), now, MEDS_TAG, medicineId, noteId, sub),
      db
        .prepare(
          `DELETE FROM notes WHERE id = ? AND user_id = ?
           AND EXISTS (SELECT 1 FROM note_tags t WHERE t.note_id = notes.id AND t.user_id = notes.user_id AND t.tag = ?)`,
        )
        .bind(noteId, sub, MEDS_TAG),
    ]);
    const results = await db.batch(statements);
    let converted = 0;
    for (let i = 0; i < results.length; i += 2) if (results[i]!.meta.changes > 0) converted++;
    return c.json({ converted, skipped: pairs.length - converted } satisfies ConvertResult, 200, noStore);
  });

  app.put('/doses/:id', async (c) => {
    const read = await readJson(c);
    if (read instanceof Response) return read;
    const body = read.value;
    if (!isRecord(body)) return invalid('Body must be an object.');
    const dose = optionalText(body, 'dose', MAX_MEDICINE_TEXT);
    if (!dose.ok) return invalid(dose.detail);
    const note = optionalText(body, 'note', MAX_NOTE_LENGTH);
    if (!note.ok) return invalid(note.detail);
    const takenAt = optionalTime(body, 'takenAt');
    if (!takenAt.ok) return invalid(takenAt.detail);

    // `?` flags say whether each field was sent, so an absent field keeps its value and `null` clears it.
    const row = await db
      .prepare(
        `UPDATE doses SET
           dose = CASE WHEN ? THEN ? ELSE dose END,
           taken_at = COALESCE(?, taken_at),
           note = CASE WHEN ? THEN ? ELSE note END
         WHERE id = ? AND user_id = ? RETURNING ${DOSE_COLUMNS}`,
      )
      .bind(dose.value !== undefined ? 1 : 0, dose.value ?? null, takenAt.value ?? null, note.value !== undefined ? 1 : 0,
        note.value ?? null, c.req.param('id'), c.var.session.sub)
      .first<DoseRow>();
    return row ? c.json({ dose: toDose(row) }, 200, noStore) : jsonError(404, 'not_found');
  });

  app.delete('/doses/:id', async (c) => {
    const res = await db.prepare('DELETE FROM doses WHERE id = ? AND user_id = ?').bind(c.req.param('id'), c.var.session.sub).run();
    return res.meta.changes ? c.body(null, 204) : jsonError(404, 'not_found');
  });

  return app;
}
