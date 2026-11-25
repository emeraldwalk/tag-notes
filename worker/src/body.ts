import type { Context } from 'hono';
import { jsonError } from './http';

/** Request body limits (plan 8): the import takes a whole export file, everything else is one row. */
export const MAX_BODY_BYTES = 64 * 1024;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

/** `400 invalid` with a human-readable `detail`. */
export const invalid = (detail: string) =>
  Response.json({ error: 'invalid', detail }, { status: 400, headers: { 'Cache-Control': 'no-store' } });

/** The JSON body, or the error response to send: `413 too_large` over `limit`, `400 invalid` if it isn't JSON. */
export async function readJson(c: Context, limit = MAX_BODY_BYTES): Promise<{ value: unknown } | Response> {
  if (Number(c.req.header('Content-Length') ?? 0) > limit) return jsonError(413, 'too_large');
  const text = await c.req.text();
  // Each UTF-16 unit is at least one byte, so only measure when it could be over.
  if (text.length > limit / 3 && new TextEncoder().encode(text).byteLength > limit) return jsonError(413, 'too_large');
  try {
    return { value: JSON.parse(text) };
  } catch {
    return invalid('Body is not valid JSON.');
  }
}

/** YYYY-MM-DD of an instant in an IANA time zone. */
export function localDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

/** A parseable timestamp as `toISOString()` (UTC, milliseconds), or null. */
export function toIso(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}
