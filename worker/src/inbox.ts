import { Hono } from 'hono';
import { isIsoWithZone, MAX_RAW_ENTRY_TEXT } from '../../pwa/src/lib/export';
import type { IngestToken, RawEntry, RawEntryFilter, RawEntryOutcomeKind, RawEntryStatus } from '../../pwa/src/lib/inbox/types';
import { parseNoteText } from '../../pwa/src/lib/notes/parse';
import type { Note } from '../../pwa/src/lib/notes/types';
import type { AppEnv } from './app';
import { invalid, readJson, toIso } from './body';
import { jsonError } from './http';
import { rewriteTags } from './notes';

/** Longest raw entry, after trimming (plan 9; the export file's limit too). */
export const MAX_ENTRY_TEXT = MAX_RAW_ENTRY_TEXT;
/** Largest `POST /api/ingest/text` body. */
export const MAX_INGEST_TEXT_BYTES = 16 * 1024;
export const MAX_TOKEN_NAME = 40;
const FUTURE_SLACK_MS = 5 * 60_000;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const SAVED_PREVIEW = 60;
const STATUSES: readonly RawEntryStatus[] = ['new', 'done', 'dismissed'];
const noStore = { 'Cache-Control': 'no-store' };

export interface RawEntryRow {
  id: string;
  text: string;
  source: string;
  occurred_at: string;
  received_at: string;
  status: string;
  outcome_kind: string | null;
  outcome_id: string | null;
  updated_at: string;
}

interface TokenRow {
  id: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

const ENTRY_COLUMNS = 'id, text, source, occurred_at, received_at, status, outcome_kind, outcome_id, updated_at';
const TOKEN_COLUMNS = 'id, name, created_at, last_used_at, revoked_at';

export function toRawEntry(r: RawEntryRow): RawEntry {
  const entry: RawEntry = {
    id: r.id,
    text: r.text,
    source: r.source,
    occurredAt: r.occurred_at,
    receivedAt: r.received_at,
    status: r.status as RawEntryStatus,
    updatedAt: r.updated_at,
  };
  if (r.outcome_kind !== null) entry.outcomeKind = r.outcome_kind as RawEntryOutcomeKind;
  if (r.outcome_id !== null) entry.outcomeId = r.outcome_id;
  return entry;
}

function toToken(r: TokenRow): IngestToken {
  const token: IngestToken = { id: r.id, name: r.name, createdAt: r.created_at };
  if (r.last_used_at !== null) token.lastUsedAt = r.last_used_at;
  if (r.revoked_at !== null) token.revokedAt = r.revoked_at;
  return token;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const isRawEntryStatus = (value: unknown): value is RawEntryStatus =>
  typeof value === 'string' && (STATUSES as readonly string[]).includes(value);

/** Hex SHA-256 of a token: what `ingest_tokens.token_hash` holds. */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** A new token: `trk_` and 32 random bytes as base64url. */
export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const b64 = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `trk_${b64}`;
}

type Parsed = { ok: true; text: string; occurredAt: string } | { ok: false; detail: string };

/** `{ text, occurredAt? }` from either the ingest route or the Inbox box. */
function parseEntryBody(body: unknown, now: string): Parsed {
  if (!isRecord(body)) return { ok: false, detail: 'Body must be an object.' };
  const raw = body['text'];
  if (typeof raw !== 'string') return { ok: false, detail: 'text must be a string.' };
  const text = raw.trim();
  if (text.length === 0 || text.length > MAX_ENTRY_TEXT) return { ok: false, detail: `text must be 1–${MAX_ENTRY_TEXT} characters.` };
  const when = body['occurredAt'];
  if (when === undefined || when === null || when === '') return { ok: true, text, occurredAt: now };
  if (!isIsoWithZone(when)) return { ok: false, detail: 'occurredAt must be an ISO 8601 time with a zone.' };
  const occurredAt = toIso(when)!;
  if (Date.parse(occurredAt) > Date.parse(now) + FUTURE_SLACK_MS) return { ok: false, detail: 'occurredAt is in the future.' };
  return { ok: true, text, occurredAt };
}

const insertEntry = (db: D1Database, e: { id: string; userId: string; text: string; source: string; tokenId: string | null; occurredAt: string; now: string }) =>
  db
    .prepare(
      `INSERT INTO raw_entries (id, user_id, text, source, token_id, occurred_at, received_at, status, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'new', ?)`,
    )
    .bind(e.id, e.userId, e.text, e.source, e.tokenId, e.occurredAt, e.now, e.now);

/** `POST /api/ingest/text`: a capture source (Siri Shortcut, Home Assistant) with its bearer token. No session. */
export function textIngest(db: D1Database): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.post('/text', async (c) => {
    const header = c.req.header('Authorization') ?? '';
    const presented = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    // A hash lookup: the token is 256 random bits, so nothing secret is compared in JS.
    const token = presented
      ? await db
          .prepare('SELECT id, user_id, name FROM ingest_tokens WHERE token_hash = ? AND revoked_at IS NULL')
          .bind(await hashToken(presented))
          .first<{ id: string; user_id: string; name: string }>()
      : null;
    if (!token) return jsonError(401, 'unauthenticated');
    if (c.req.header('Content-Type')?.split(';')[0]?.trim() !== 'application/json') return jsonError(415, 'json_required');
    const read = await readJson(c, MAX_INGEST_TEXT_BYTES);
    if (read instanceof Response) return read;
    const now = new Date().toISOString();
    const parsed = parseEntryBody(read.value, now);
    if (!parsed.ok) return invalid(parsed.detail);

    const id = crypto.randomUUID();
    await db.batch([
      insertEntry(db, { id, userId: token.user_id, text: parsed.text, source: token.name, tokenId: token.id, occurredAt: parsed.occurredAt, now }),
      db.prepare('UPDATE ingest_tokens SET last_used_at = ? WHERE id = ?').bind(now, token.id),
    ]);
    const preview = parsed.text.length > SAVED_PREVIEW ? `${parsed.text.slice(0, SAVED_PREVIEW - 1)}…` : parsed.text;
    return c.json({ id, saved: `Saved: ${preview}` }, 201, noStore);
  });
  return app;
}

/** `/api/raw-entries` and `/api/ingest-tokens`, mounted inside `/api` (the session middleware has run). */
export function inboxApi(db: D1Database): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  const getEntry = (userId: string, id: string) =>
    db.prepare(`SELECT ${ENTRY_COLUMNS} FROM raw_entries WHERE id = ? AND user_id = ?`).bind(id, userId).first<RawEntryRow>();

  app.get('/raw-entries', async (c) => {
    const status = (c.req.query('status') ?? 'new') as RawEntryFilter;
    if (status !== 'all' && !isRawEntryStatus(status)) return invalid('status must be new, done, dismissed or all.');
    const beforeRaw = c.req.query('before');
    const before = beforeRaw === undefined ? null : toIso(beforeRaw);
    if (beforeRaw !== undefined && before === null) return invalid('before must be an ISO 8601 time.');
    // With `beforeId` too, the page continues exactly after that entry (ties on the same time are ordered by id).
    const beforeId = c.req.query('beforeId') ?? null;
    if (beforeId !== null && before === null) return invalid('beforeId needs before.');
    const limitRaw = c.req.query('limit');
    const limit = limitRaw === undefined ? DEFAULT_LIMIT : Number(limitRaw);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) return invalid(`limit must be 1–${MAX_LIMIT}.`);

    const { results } = await db
      .prepare(
        `SELECT ${ENTRY_COLUMNS} FROM raw_entries
         WHERE user_id = ?1 AND (?2 = 'all' OR status = ?2)
           AND (?3 IS NULL OR occurred_at < ?3 OR (?5 IS NOT NULL AND occurred_at = ?3 AND id < ?5))
         ORDER BY occurred_at DESC, id DESC LIMIT ?4`,
      )
      .bind(c.var.session.sub, status, before, limit, beforeId)
      .all<RawEntryRow>();
    return c.json({ entries: results.map(toRawEntry) }, 200, noStore);
  });

  app.get('/raw-entries/count', async (c) => {
    const row = await db
      .prepare("SELECT COUNT(*) AS n FROM raw_entries WHERE user_id = ? AND status = 'new'")
      .bind(c.var.session.sub)
      .first<{ n: number }>();
    return c.json({ new: row?.n ?? 0 }, 200, noStore);
  });

  app.post('/raw-entries', async (c) => {
    const read = await readJson(c);
    if (read instanceof Response) return read;
    const now = new Date().toISOString();
    const parsed = parseEntryBody(read.value, now);
    if (!parsed.ok) return invalid(parsed.detail);
    const sub = c.var.session.sub;
    const id = crypto.randomUUID();
    await insertEntry(db, { id, userId: sub, text: parsed.text, source: 'app', tokenId: null, occurredAt: parsed.occurredAt, now }).run();
    const row = await getEntry(sub, id);
    return c.json({ entry: toRawEntry(row!) }, 201, noStore);
  });

  app.put('/raw-entries/:id', async (c) => {
    const read = await readJson(c);
    if (read instanceof Response) return read;
    const body = read.value;
    if (!isRecord(body) || !isRawEntryStatus(body['status'])) return invalid('status must be new, done or dismissed.');
    if (Object.keys(body).some((k) => k !== 'status')) return invalid('Only status can be changed.');
    const sub = c.var.session.sub;
    const id = c.req.param('id');
    const res = await db
      .prepare('UPDATE raw_entries SET status = ?, updated_at = ? WHERE id = ? AND user_id = ?')
      .bind(body['status'], new Date().toISOString(), id, sub)
      .run();
    if (!res.meta.changes) return jsonError(404, 'not_found');
    return c.json({ entry: toRawEntry((await getEntry(sub, id))!) }, 200, noStore);
  });

  app.post('/raw-entries/:id/note', async (c) => {
    const sub = c.var.session.sub;
    const row = await getEntry(sub, c.req.param('id'));
    if (!row) return jsonError(404, 'not_found');
    if (row.outcome_kind !== null) return jsonError(409, 'already_filed');

    const now = new Date().toISOString();
    const note: Note = { id: crypto.randomUUID(), rawText: row.text, ...parseNoteText(row.text), createdAt: row.occurred_at, updatedAt: row.occurred_at };
    // The entry is claimed first and only while it has no outcome; the note is written only if that claim held, so
    // two taps make one note.
    const [claimed] = await db.batch([
      db
        .prepare("UPDATE raw_entries SET status = 'done', outcome_kind = 'note', outcome_id = ?, updated_at = ? WHERE id = ? AND user_id = ? AND outcome_kind IS NULL")
        .bind(note.id, now, row.id, sub),
      db
        .prepare(
          `INSERT INTO notes (id, user_id, raw_text, title, body, tags, created_at, updated_at)
           SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM raw_entries WHERE id = ? AND user_id = ? AND outcome_id = ?)`,
        )
        .bind(note.id, sub, note.rawText, note.title, note.body, JSON.stringify(note.tags), note.createdAt, note.updatedAt, row.id, sub, note.id),
      ...rewriteTags(db, sub, note.id),
    ]);
    if (!claimed?.meta.changes) return jsonError(409, 'already_filed');
    return c.json({ note, entry: toRawEntry((await getEntry(sub, row.id))!) }, 201, noStore);
  });

  app.delete('/raw-entries/:id', async (c) => {
    const res = await db.prepare('DELETE FROM raw_entries WHERE id = ? AND user_id = ?').bind(c.req.param('id'), c.var.session.sub).run();
    return res.meta.changes ? c.body(null, 204) : jsonError(404, 'not_found');
  });

  app.get('/ingest-tokens', async (c) => {
    const { results } = await db
      .prepare(`SELECT ${TOKEN_COLUMNS} FROM ingest_tokens WHERE user_id = ? ORDER BY created_at DESC`)
      .bind(c.var.session.sub)
      .all<TokenRow>();
    return c.json({ tokens: results.map(toToken) }, 200, noStore);
  });

  app.post('/ingest-tokens', async (c) => {
    const read = await readJson(c);
    if (read instanceof Response) return read;
    const body = read.value;
    const name = isRecord(body) && typeof body['name'] === 'string' ? body['name'].trim() : '';
    if (name.length === 0 || name.length > MAX_TOKEN_NAME) return invalid(`name must be 1–${MAX_TOKEN_NAME} characters.`);
    const sub = c.var.session.sub;
    const secret = newToken();
    const row = await db
      .prepare(
        `INSERT INTO ingest_tokens (id, user_id, name, token_hash, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT DO NOTHING
         RETURNING ${TOKEN_COLUMNS}`,
      )
      .bind(crypto.randomUUID(), sub, name, await hashToken(secret), new Date().toISOString())
      .first<TokenRow>();
    if (!row) return jsonError(409, 'duplicate_name');
    return c.json({ token: toToken(row), secret }, 201, noStore);
  });

  app.delete('/ingest-tokens/:id', async (c) => {
    const res = await db
      .prepare('UPDATE ingest_tokens SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ? AND user_id = ?')
      .bind(new Date().toISOString(), c.req.param('id'), c.var.session.sub)
      .run();
    return res.meta.changes ? c.body(null, 204) : jsonError(404, 'not_found');
  });

  return app;
}
