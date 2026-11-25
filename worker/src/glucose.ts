import { type Fetch, graph, type LluConfig, LluError, type LluReading, type LluSession, login, patientId } from './llu';

export type GlucoseSource = 'llu' | 'ha' | 'csv';
export type GlucoseKind = 'current' | 'historic' | 'scan';

export interface GlucoseReading {
  ts: string;
  mgDl: number;
  trend: number | null;
  source: GlucoseSource;
  kind: GlucoseKind;
}

export interface LluStatus {
  lastRunAt: string | null;
  lastOkAt: string | null;
  lastError: string | null;
  backoffUntil: string | null;
}

export interface GlucoseStatus {
  lastReading: { ts: string; mgDl: number; trend: number | null } | null;
  llu: LluStatus;
}

interface StateRow {
  host: string | null;
  token: string | null;
  token_expires: number | null;
  account_id: string | null;
  patient_id: string | null;
  last_run_at: string | null;
  last_ok_at: string | null;
  last_error: string | null;
  backoff_until: string | null;
}

/** Re-sign in this long before the token's stated expiry. */
const TOKEN_MARGIN_S = 3600;
/** Wait after a rate limit without Retry-After. */
const RATE_LIMIT_BACKOFF_S = 30 * 60;
/** Wait after a refused sign-in, so a wrong password doesn't hit LibreView every 5 minutes and lock the account. */
const LOGIN_FAILED_BACKOFF_S = 60 * 60;
/** D1 allows 100 bound parameters per statement; 7 columns each → 14 rows per INSERT. */
const ROWS_PER_INSERT = 14;

const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

/** Stores readings for one user, ignoring ones already stored (same user, source and time). */
export async function insertReadings(db: D1Database, userId: string, readings: GlucoseReading[], now: Date): Promise<number> {
  if (readings.length === 0) return 0;
  const created = iso(now);
  const statements: D1PreparedStatement[] = [];
  for (let i = 0; i < readings.length; i += ROWS_PER_INSERT) {
    const chunk = readings.slice(i, i + ROWS_PER_INSERT);
    const values = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(', ');
    const params = chunk.flatMap((r) => [userId, r.ts, r.mgDl, r.trend, r.source, r.kind, created]);
    statements.push(
      db.prepare(`INSERT OR IGNORE INTO glucose_readings (user_id, ts, mg_dl, trend, source, kind, created_at) VALUES ${values}`).bind(...params),
    );
  }
  const results = await db.batch(statements);
  return results.reduce((n, r) => n + (r.meta.changes ?? 0), 0);
}

async function readState(db: D1Database): Promise<StateRow> {
  const row = await db.prepare('SELECT * FROM llu_state WHERE id = 1').first<StateRow>();
  if (!row) throw new Error('llu_state row missing; run the D1 migrations');
  return row;
}

async function writeState(db: D1Database, fields: Partial<StateRow>): Promise<void> {
  const keys = Object.keys(fields) as (keyof StateRow)[];
  if (keys.length === 0) return;
  await db
    .prepare(`UPDATE llu_state SET ${keys.map((k, i) => `${k} = ?${i + 1}`).join(', ')} WHERE id = 1`)
    .bind(...keys.map((k) => fields[k] ?? null))
    .run();
}

export interface PollDeps {
  db: D1Database;
  fetch: Fetch;
  /** Null when the LibreLinkUp secrets aren't set (for example on the Home Assistant fallback). */
  config: LluConfig | null;
  ownerUserId: string;
  now?: Date;
}

export type PollResult = { ok: true; inserted: number } | { ok: false; error: string } | { skipped: 'backoff' };

/** One cron run: sign in if needed, read the graph, store new readings, record how it went. */
export async function pollLibreLinkUp(deps: PollDeps): Promise<PollResult> {
  const now = deps.now ?? new Date();
  const nowS = Math.floor(now.getTime() / 1000);
  const state = await readState(deps.db);
  if (state.backoff_until && Date.parse(state.backoff_until) > now.getTime()) return { skipped: 'backoff' };
  if (!deps.config) {
    await writeState(deps.db, { last_run_at: iso(now), last_error: 'not_configured' });
    return { ok: false, error: 'not_configured' };
  }
  if (!deps.ownerUserId) {
    await writeState(deps.db, { last_run_at: iso(now), last_error: 'no_owner_user_id' });
    return { ok: false, error: 'no_owner_user_id' };
  }
  const config = deps.config;
  const update: Partial<StateRow> = { last_run_at: iso(now) };

  const signIn = async (): Promise<LluSession> => {
    const session = await login(deps.fetch, config);
    Object.assign(update, { host: session.host, token: session.token, token_expires: session.tokenExpires, account_id: session.accountId });
    return session;
  };

  try {
    let session: LluSession =
      state.host && state.token && state.account_id && (state.token_expires ?? 0) - nowS > TOKEN_MARGIN_S
        ? { host: state.host, token: state.token, tokenExpires: state.token_expires ?? 0, accountId: state.account_id }
        : await signIn();
    let readings: LluReading[];
    let patient = state.patient_id;
    try {
      patient ??= await patientId(deps.fetch, config, session);
      readings = await graph(deps.fetch, config, session, patient);
    } catch (err) {
      if (!(err instanceof LluError && err.code === 'unauthorized')) throw err;
      session = await signIn();
      patient = await patientId(deps.fetch, config, session);
      readings = await graph(deps.fetch, config, session, patient);
    }
    update.patient_id = patient;
    const inserted = await insertReadings(
      deps.db,
      deps.ownerUserId,
      readings.map((r) => ({ ...r, source: 'llu' as const })),
      now,
    );
    Object.assign(update, { last_ok_at: iso(now), last_error: null, backoff_until: null });
    await writeState(deps.db, update);
    return { ok: true, inserted };
  } catch (err) {
    const code = err instanceof LluError ? err.code : 'network';
    update.last_error = code;
    if (code === 'rate_limited') {
      const wait = (err as LluError).retryAfterS ?? RATE_LIMIT_BACKOFF_S;
      update.backoff_until = iso(new Date(now.getTime() + wait * 1000));
    } else if (code === 'login_failed') {
      update.backoff_until = iso(new Date(now.getTime() + LOGIN_FAILED_BACKOFF_S * 1000));
      Object.assign(update, { token: null, token_expires: null });
    }
    await writeState(deps.db, update);
    return { ok: false, error: code };
  }
}

export async function readGlucose(db: D1Database, userId: string, from: string, to: string): Promise<GlucoseReading[]> {
  const { results } = await db
    .prepare(
      `SELECT ts, mg_dl AS mgDl, trend, source, kind FROM glucose_readings
       WHERE user_id = ?1 AND ts >= ?2 AND ts < ?3 ORDER BY ts, source`,
    )
    .bind(userId, from, to)
    .all<GlucoseReading>();
  return results;
}

export async function glucoseStatus(db: D1Database, userId: string): Promise<GlucoseStatus> {
  const [last, state] = await Promise.all([
    db
      .prepare('SELECT ts, mg_dl AS mgDl, trend FROM glucose_readings WHERE user_id = ?1 ORDER BY ts DESC LIMIT 1')
      .bind(userId)
      .first<{ ts: string; mgDl: number; trend: number | null }>(),
    readState(db),
  ]);
  return {
    lastReading: last ?? null,
    llu: { lastRunAt: state.last_run_at, lastOkAt: state.last_ok_at, lastError: state.last_error, backoffUntil: state.backoff_until },
  };
}
