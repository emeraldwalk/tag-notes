import { Hono } from 'hono';
import type { AppEnv } from './app';
import { type GlucoseReading, glucoseStatus, insertReadings, readGlucose } from './glucose';
import { jsonError } from './http';

const MAX_INGEST_BYTES = 256 * 1024;
const MAX_INGEST_READINGS = 500;
const FUTURE_SLACK_MS = 5 * 60_000;
const MAX_RANGE_MS = 31 * 86_400_000;
const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/** An ISO 8601 time with a zone, as UTC to the second; null otherwise. */
export function normalizeIso(value: unknown): string | null {
  if (typeof value !== 'string' || !ISO_WITH_ZONE.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(Math.floor(ms / 1000) * 1000).toISOString().replace('.000Z', 'Z');
}

/** Bearer token check in constant time (hashing both sides first, so lengths don't leak). */
export async function tokenMatches(header: string | null, token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const digest = (v: string) => crypto.subtle.digest('SHA-256', new TextEncoder().encode(v));
  const [a, b] = await Promise.all([digest(header ?? ''), digest(`Bearer ${token}`)]);
  return crypto.subtle.timingSafeEqual(a, b);
}

const invalid = (detail: string) => Response.json({ error: 'invalid', detail }, { status: 400 });

export interface GlucoseRouteDeps {
  db: D1Database;
  haToken: string | undefined;
  ownerUserId: string;
}

/** `POST /api/ingest/glucose`: Home Assistant (or another push source) with a bearer token. No session. */
export function glucoseIngest(deps: GlucoseRouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.post('/glucose', async (c) => {
    if (!(await tokenMatches(c.req.header('Authorization') ?? null, deps.haToken))) return jsonError(401, 'unauthenticated');
    if (c.req.header('Content-Type')?.split(';')[0]?.trim() !== 'application/json') return jsonError(415, 'json_required');
    if (Number(c.req.header('Content-Length') ?? 0) > MAX_INGEST_BYTES) return jsonError(413, 'too_large');
    const text = await c.req.text();
    if (new TextEncoder().encode(text).byteLength > MAX_INGEST_BYTES) return jsonError(413, 'too_large');
    if (!deps.ownerUserId) return jsonError(503, 'no_owner_user_id');

    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return invalid('Body is not valid JSON.');
    }
    const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    if (b.source !== 'ha') return invalid('source must be "ha".');
    if (!Array.isArray(b.readings) || b.readings.length < 1 || b.readings.length > MAX_INGEST_READINGS) {
      return invalid(`readings must be a list of 1 to ${MAX_INGEST_READINGS} items.`);
    }
    const latest = Date.now() + FUTURE_SLACK_MS;
    const readings: GlucoseReading[] = [];
    for (const [i, item] of b.readings.entries()) {
      const r = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
      const ts = normalizeIso(r.ts);
      if (!ts || Date.parse(ts) > latest) return invalid(`readings[${i}].ts must be an ISO 8601 time with a zone, not in the future.`);
      if (!Number.isInteger(r.mgDl) || (r.mgDl as number) < 20 || (r.mgDl as number) > 600) {
        return invalid(`readings[${i}].mgDl must be a whole number from 20 to 600.`);
      }
      if (r.trend !== undefined && r.trend !== null && (!Number.isInteger(r.trend) || (r.trend as number) < 1 || (r.trend as number) > 5)) {
        return invalid(`readings[${i}].trend must be 1 to 5.`);
      }
      readings.push({ ts, mgDl: r.mgDl as number, trend: (r.trend as number | undefined) ?? null, source: 'ha', kind: 'current' });
    }
    const inserted = await insertReadings(deps.db, deps.ownerUserId, readings, new Date());
    return c.json({ inserted, duplicates: readings.length - inserted });
  });
  return app;
}

/** Signed-in reads, mounted inside `/api` (the session middleware has run). */
export function glucoseApi(deps: GlucoseRouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.get('/', async (c) => {
    const from = normalizeIso(c.req.query('from'));
    const to = normalizeIso(c.req.query('to'));
    if (!from || !to) return invalid('from and to must be ISO 8601 times with a zone.');
    const span = Date.parse(to) - Date.parse(from);
    if (span <= 0 || span > MAX_RANGE_MS) return invalid('to must be after from, at most 31 days later.');
    const readings = await readGlucose(deps.db, c.var.session.sub, from, to);
    return c.json({ readings }, 200, { 'Cache-Control': 'no-store' });
  });
  app.get('/status', async (c) => c.json(await glucoseStatus(deps.db, c.var.session.sub), 200, { 'Cache-Control': 'no-store' }));
  return app;
}
