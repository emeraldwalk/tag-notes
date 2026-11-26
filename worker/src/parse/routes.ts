import { Hono } from 'hono';
import { InvalidExportFileError, isIsoWithZone, MAX_RAW_ENTRY_TEXT, parseFoodEntry } from '../../../pwa/src/lib/export';
import type { ProposalData } from '../../../pwa/src/lib/inbox/types';
import { parseNoteText } from '../../../pwa/src/lib/notes/parse';
import type { Note } from '../../../pwa/src/lib/notes/types';
import type { AppEnv } from '../app';
import { invalid, localDate, MAX_BODY_BYTES, toIso } from '../body';
import { foodInsert } from '../foods';
import { jsonError } from '../http';
import { type RawEntryRow, toRawEntry } from '../inbox';
import { doseInsert } from '../meds';
import { noteInsert } from '../notes';
import { LATEST_RUN_SQL, type Parser, toProposal } from './run';

const noStore = { 'Cache-Control': 'no-store' };
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const ENTRY_COLUMNS = 'id, text, source, occurred_at, received_at, status, outcome_kind, outcome_id, updated_at';

interface ProposalJoinRow {
  id: string;
  run_id: string;
  raw_entry_id: string;
  status: string;
  outcome_id: string | null;
  data: string;
  occurred_at: string;
}

/** An optional JSON body: empty is `{}`. A Response for 413 / 400. */
async function optionalBody(text: string): Promise<Record<string, unknown> | Response> {
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) return jsonError(413, 'too_large');
  if (text.trim() === '') return {};
  try {
    const value: unknown = JSON.parse(text);
    return isRecord(value) ? value : invalid('Body must be an object.');
  } catch {
    return invalid('Body is not valid JSON.');
  }
}

/** Plan 10's routes: parse an entry, try a text, accept or reject proposals. Mounted inside `/api`. */
export function parseApi(db: D1Database, parser: Parser, timeZone: string): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  const entryWithParse = async (userId: string, entryId: string) => {
    const row = await db.prepare(`SELECT ${ENTRY_COLUMNS} FROM raw_entries WHERE id = ? AND user_id = ?`).bind(entryId, userId).first<RawEntryRow>();
    if (!row) return null;
    const [entry] = await parser.attach(userId, [toRawEntry(row)]);
    return entry!;
  };

  /** Files the entry when its latest run has nothing left to decide and something was accepted. */
  const fileIfDecided = (userId: string, entryId: string, runId: string, now: string) =>
    db
      .prepare(
        `UPDATE raw_entries SET status = 'done', outcome_kind = 'proposals', outcome_id = ?1, updated_at = ?2
         WHERE id = ?3 AND user_id = ?4 AND outcome_kind IS NULL
           AND NOT EXISTS (SELECT 1 FROM proposals WHERE run_id = ?1 AND status = 'proposed')
           AND EXISTS (SELECT 1 FROM proposals WHERE run_id = ?1 AND status = 'accepted')`,
      )
      .bind(runId, now, entryId, userId);

  const getProposal = (userId: string, id: string) =>
    db
      .prepare(
        `SELECT p.id, p.run_id, p.raw_entry_id, p.status, p.outcome_id, p.data, e.occurred_at
         FROM proposals p JOIN raw_entries e ON e.id = p.raw_entry_id WHERE p.id = ? AND p.user_id = ?`,
      )
      .bind(id, userId)
      .first<ProposalJoinRow>();

  /** Marks a proposal decided, only while it's proposed, from the entry's latest run, and the entry isn't filed. */
  const claim = (userId: string, p: ProposalJoinRow, status: 'accepted' | 'rejected', outcomeId: string | null, now: string) =>
    db
      .prepare(
        `UPDATE proposals SET status = ?, outcome_id = ?, decided_at = ?
         WHERE id = ? AND user_id = ? AND status = 'proposed' AND run_id = ${LATEST_RUN_SQL}
           AND EXISTS (SELECT 1 FROM raw_entries WHERE id = ? AND outcome_kind IS NULL)`,
      )
      .bind(status, outcomeId, now, p.id, userId, p.raw_entry_id, p.raw_entry_id);

  const decided = async (userId: string, p: ProposalJoinRow) => {
    const row = await getProposal(userId, p.id);
    return { proposal: toProposal(row!), entry: await entryWithParse(userId, p.raw_entry_id) };
  };

  app.get('/parse/models', (c) => c.json(parser.listModels(), 200, noStore));

  app.post('/parse/try', async (c) => {
    const body = await optionalBody(await c.req.text());
    if (body instanceof Response) return body;
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (text.length === 0 || text.length > MAX_RAW_ENTRY_TEXT) return invalid(`text must be 1–${MAX_RAW_ENTRY_TEXT} characters.`);
    if (typeof body.model !== 'string' || !parser.findModel(body.model)) return invalid('model must be one of PARSE_MODELS.');
    let occurredAt = new Date().toISOString();
    if (body.occurredAt !== undefined && body.occurredAt !== null && body.occurredAt !== '') {
      if (!isIsoWithZone(body.occurredAt)) return invalid('occurredAt must be an ISO 8601 time with a zone.');
      occurredAt = toIso(body.occurredAt)!;
    }
    const result = await parser.tryText(c.var.session.sub, text, occurredAt, body.model);
    return c.json(result, 200, noStore);
  });

  app.post('/raw-entries/:id/parse', async (c) => {
    const body = await optionalBody(await c.req.text());
    if (body instanceof Response) return body;
    if (body.model !== undefined && typeof body.model !== 'string') return invalid('model must be a string.');
    const sub = c.var.session.sub;
    const result = await parser.parseNow(sub, c.req.param('id'), body.model as string | undefined);
    if (!result.ok) {
      if (result.code === 'not_found') return jsonError(404, 'not_found');
      if (result.code === 'unknown_model') return invalid('model must be one of PARSE_MODELS.');
      return jsonError(409, result.code);
    }
    return c.json({ entry: await entryWithParse(sub, c.req.param('id')) }, 200, noStore);
  });

  app.post('/proposals/:id/accept', async (c) => {
    const body = await optionalBody(await c.req.text());
    if (body instanceof Response) return body;
    const sub = c.var.session.sub;
    const p = await getProposal(sub, c.req.param('id'));
    if (!p) return jsonError(404, 'not_found');
    if (p.status !== 'proposed') return jsonError(409, 'already_decided');
    const data = JSON.parse(p.data) as ProposalData;
    if (body.food !== undefined && data.kind !== 'food') return invalid('food is only for food proposals.');

    const now = new Date().toISOString();
    const outcomeId = crypto.randomUUID();
    // The row is written only if the claim in the same batch held, so two taps make one row.
    const guard = { sql: "EXISTS (SELECT 1 FROM proposals WHERE id = ? AND status = 'accepted' AND outcome_id = ?)", params: [p.id, outcomeId] };
    let writes: D1PreparedStatement[];

    if (data.kind === 'food') {
      // The time is the one captured from the entry, whenever the numbers are added.
      const base = data.status === 'known' ? data : undefined;
      if (!base && body.food === undefined) return invalid('A new food needs its numbers: food { name, servingSize?, quantity, protein, calories, carbs }.');
      const date = localDate(data.eatenAt, timeZone);
      let food;
      try {
        food = parseFoodEntry(body.food !== undefined ? { ...(isRecord(body.food) ? body.food : {}), date, eatenAt: data.eatenAt } : { ...base, date }, 'food');
      } catch (err) {
        if (err instanceof InvalidExportFileError) return invalid(err.message);
        throw err;
      }
      if (!(food.quantity > 0)) return invalid('food has an invalid "quantity" (expected a number > 0).');
      writes = [
        foodInsert(db, sub, outcomeId, { ...food, name: food.name.trim(), servingSize: food.servingSize?.trim() || null, eatenAt: data.eatenAt }, now, guard),
      ];
    } else if (data.kind === 'dose') {
      // The medicine may have been deleted since the proposal was made: then it's logged by name only.
      const medicine = data.medicineId
        ? await db.prepare('SELECT id FROM medicines WHERE id = ? AND user_id = ?').bind(data.medicineId, sub).first<{ id: string }>()
        : null;
      const entry = await db.prepare('SELECT text FROM raw_entries WHERE id = ?').bind(p.raw_entry_id).first<{ text: string }>();
      writes = [
        doseInsert(
          db,
          {
            id: outcomeId,
            userId: sub,
            medicineId: medicine?.id ?? null,
            medicineName: data.medicineName,
            dose: data.dose ?? null,
            takenAt: data.takenAt,
            note: entry?.text ?? null,
            source: 'inbox',
            createdAt: now,
          },
          guard,
        ),
      ];
    } else {
      const note: Note = { id: outcomeId, rawText: data.text, ...parseNoteText(data.text), createdAt: p.occurred_at, updatedAt: p.occurred_at };
      writes = noteInsert(db, sub, note, guard);
    }

    const [claimed] = await db.batch([claim(sub, p, 'accepted', outcomeId, now), ...writes, fileIfDecided(sub, p.raw_entry_id, p.run_id, now)]);
    if (!claimed?.meta.changes) return jsonError(409, 'already_decided');
    return c.json(await decided(sub, p), 200, noStore);
  });

  app.post('/proposals/:id/reject', async (c) => {
    const sub = c.var.session.sub;
    const p = await getProposal(sub, c.req.param('id'));
    if (!p) return jsonError(404, 'not_found');
    const now = new Date().toISOString();
    const [claimed] = await db.batch([claim(sub, p, 'rejected', null, now), fileIfDecided(sub, p.raw_entry_id, p.run_id, now)]);
    if (!claimed?.meta.changes) return jsonError(409, 'already_decided');
    return c.json(await decided(sub, p), 200, noStore);
  });

  return app;
}
