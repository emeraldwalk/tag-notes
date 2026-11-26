import { type Context, Hono } from 'hono';
import { parseNoteText } from '../../pwa/src/lib/notes/parse';
import type { Note } from '../../pwa/src/lib/notes/types';
import type { AppEnv } from './app';
import { guardedInsert, type InsertGuard, invalid, readJson } from './body';
import { jsonError } from './http';

interface NoteRow {
  id: string;
  raw_text: string;
  title: string;
  body: string;
  tags: string;
  created_at: string;
  updated_at: string;
}

const COLUMNS = 'n.id, n.raw_text, n.title, n.body, n.tags, n.created_at, n.updated_at';
const ORDER = 'ORDER BY n.updated_at DESC, n.created_at DESC';

export const toNote = (r: NoteRow): Note => ({
  id: r.id,
  rawText: r.raw_text,
  title: r.title,
  body: r.body,
  tags: JSON.parse(r.tags) as string[],
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/**
 * Statements that rewrite a note's `note_tags` from its `tags` column, only if the note is this user's. Run after
 * the note's insert or update, in the same batch.
 */
export function rewriteTags(db: D1Database, userId: string, noteId: string): D1PreparedStatement[] {
  return [
    db.prepare('DELETE FROM note_tags WHERE note_id = ? AND user_id = ?').bind(noteId, userId),
    db
      .prepare(
        `INSERT OR IGNORE INTO note_tags (note_id, user_id, tag)
         SELECT n.id, n.user_id, j.value FROM notes n, json_each(n.tags) j WHERE n.id = ? AND n.user_id = ?`,
      )
      .bind(noteId, userId),
  ];
}

/** The statements that write one note and its tags (`POST /api/notes`, and accepting a note proposal under a guard). */
export function noteInsert(db: D1Database, userId: string, note: Note, guard?: InsertGuard): D1PreparedStatement[] {
  return [
    guardedInsert(
      db,
      'notes',
      ['id', 'user_id', 'raw_text', 'title', 'body', 'tags', 'created_at', 'updated_at'],
      [note.id, userId, note.rawText, note.title, note.body, JSON.stringify(note.tags), note.createdAt, note.updatedAt],
      guard,
    ),
    ...rewriteTags(db, userId, note.id),
  ];
}

const nowIso = () => new Date().toISOString();

async function rawTextFrom(c: Context<AppEnv>): Promise<string | Response> {
  const read = await readJson(c);
  if (read instanceof Response) return read;
  const body = read.value as { rawText?: unknown } | null;
  if (!body || typeof body !== 'object' || typeof body.rawText !== 'string') return invalid('rawText must be a string.');
  return body.rawText;
}

/** `/api/notes` and `/api/tags`, mounted inside `/api` (the session middleware has run). */
export function notesApi(db: D1Database): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const noStore = { 'Cache-Control': 'no-store' };

  app.get('/notes', async (c) => {
    const sub = c.var.session.sub;
    const tag = c.req.query('tag');
    const stmt = tag
      ? db
          .prepare(`SELECT ${COLUMNS} FROM notes n JOIN note_tags t ON t.note_id = n.id WHERE t.user_id = ? AND t.tag = ? ${ORDER}`)
          .bind(sub, tag.trim().toLowerCase())
      : db.prepare(`SELECT ${COLUMNS} FROM notes n WHERE n.user_id = ? ${ORDER}`).bind(sub);
    const { results } = await stmt.all<NoteRow>();
    return c.json({ notes: results.map(toNote) }, 200, noStore);
  });

  app.get('/notes/:id', async (c) => {
    const row = await db
      .prepare(`SELECT ${COLUMNS} FROM notes n WHERE n.id = ? AND n.user_id = ?`)
      .bind(c.req.param('id'), c.var.session.sub)
      .first<NoteRow>();
    return row ? c.json({ note: toNote(row) }, 200, noStore) : jsonError(404, 'not_found');
  });

  app.post('/notes', async (c) => {
    const rawText = await rawTextFrom(c);
    if (rawText instanceof Response) return rawText;
    const sub = c.var.session.sub;
    const now = nowIso();
    const note: Note = { id: crypto.randomUUID(), rawText, ...parseNoteText(rawText), createdAt: now, updatedAt: now };
    await db.batch(noteInsert(db, sub, note));
    return c.json({ note }, 201, noStore);
  });

  app.put('/notes/:id', async (c) => {
    const rawText = await rawTextFrom(c);
    if (rawText instanceof Response) return rawText;
    const sub = c.var.session.sub;
    const id = c.req.param('id');
    const parsed = parseNoteText(rawText);
    const [updated] = await db.batch([
      db
        .prepare('UPDATE notes SET raw_text = ?, title = ?, body = ?, tags = ?, updated_at = ? WHERE id = ? AND user_id = ?')
        .bind(rawText, parsed.title, parsed.body, JSON.stringify(parsed.tags), nowIso(), id, sub),
      ...rewriteTags(db, sub, id),
    ]);
    if (!updated?.meta.changes) return jsonError(404, 'not_found');
    const row = await db.prepare(`SELECT ${COLUMNS} FROM notes n WHERE n.id = ? AND n.user_id = ?`).bind(id, sub).first<NoteRow>();
    return row ? c.json({ note: toNote(row) }, 200, noStore) : jsonError(404, 'not_found');
  });

  app.delete('/notes/:id', async (c) => {
    const sub = c.var.session.sub;
    const id = c.req.param('id');
    const [, deleted] = await db.batch([
      db.prepare('DELETE FROM note_tags WHERE note_id = ? AND user_id = ?').bind(id, sub),
      db.prepare('DELETE FROM notes WHERE id = ? AND user_id = ?').bind(id, sub),
    ]);
    return deleted?.meta.changes ? c.body(null, 204) : jsonError(404, 'not_found');
  });

  app.get('/tags', async (c) => {
    const { results } = await db
      .prepare('SELECT DISTINCT tag FROM note_tags WHERE user_id = ?')
      .bind(c.var.session.sub)
      .all<{ tag: string }>();
    const tags = results.map((r) => r.tag).sort((a, b) => a.localeCompare(b));
    return c.json({ tags }, 200, noStore);
  });

  return app;
}
