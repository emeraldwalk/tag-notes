// LibreLinkUp, the unofficial follower API behind Abbott's LibreLinkUp app (plan 14). Request shapes are from
// timoschlueter/nightscout-librelink-up (src/index.ts, last version bump 2025-10-02) and the community gist
// khskekec/6c13ba01b10d3018d816706a32ae8ab2. Undocumented, so expect changes.

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface LluConfig {
  region: string; // "us", "eu", "de", ...
  version: string; // the app version LibreView expects in the `version` header, e.g. "4.16.0"
  email: string;
  password: string;
  patientId?: string;
}

export interface LluSession {
  host: string;
  token: string;
  tokenExpires: number; // epoch seconds
  accountId: string;
}

export interface LluReading {
  ts: string; // UTC ISO 8601, Z
  mgDl: number;
  trend: number | null;
  kind: 'current' | 'historic';
}

/** A failure with a short code for `llu_state.last_error`; `retryAfterS` set for rate limits. */
export class LluError extends Error {
  constructor(
    readonly code: string,
    readonly retryAfterS?: number,
  ) {
    super(code);
    this.name = 'LluError';
  }
}

const USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU OS 17_4.1 like Mac OS X) AppleWebKit/536.26 (KHTML, like Gecko) Version/17.4.1 Mobile/10A5355d Safari/8536.25';

export const hostFor = (region: string) => `https://api-${region.toLowerCase()}.libreview.io`;

function headers(config: LluConfig, session?: LluSession): Record<string, string> {
  const h: Record<string, string> = {
    'User-Agent': USER_AGENT,
    'Content-Type': 'application/json;charset=UTF-8',
    Accept: 'application/json',
    product: 'llu.ios',
    version: config.version,
  };
  if (session) {
    h.Authorization = `Bearer ${session.token}`;
    h['account-id'] = session.accountId;
  }
  return h;
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Turns a non-OK response into an LluError: rate limits carry Retry-After (seconds), others their status. */
function failure(res: Response): LluError {
  if (res.status === 429 || res.status === 430) {
    const after = Number(res.headers.get('Retry-After'));
    return new LluError('rate_limited', Number.isFinite(after) && after > 0 ? after : undefined);
  }
  return new LluError(`http_${res.status}`);
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await res.json();
    if (body && typeof body === 'object') return body as Record<string, unknown>;
  } catch {
    // fall through
  }
  throw new LluError('bad_response');
}

const record = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

/** Signs in, following one region redirect. Never logs or returns the password. */
export async function login(fetch: Fetch, config: LluConfig): Promise<LluSession> {
  let host = hostFor(config.region);
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(`${host}/llu/auth/login`, {
      method: 'POST',
      headers: headers(config),
      body: JSON.stringify({ email: config.email, password: config.password }),
    });
    if (!res.ok) throw failure(res);
    const body = await readJson(res);
    if (body.status !== 0) throw new LluError('login_failed');
    const data = record(body.data);
    if (data.redirect === true && typeof data.region === 'string') {
      host = hostFor(data.region);
      continue;
    }
    const ticket = record(data.authTicket);
    const userId = record(data.user).id;
    if (typeof ticket.token !== 'string' || typeof ticket.expires !== 'number' || typeof userId !== 'string') {
      throw new LluError('login_failed');
    }
    return { host, token: ticket.token, tokenExpires: ticket.expires, accountId: await sha256Hex(userId) };
  }
  throw new LluError('redirect_loop');
}

async function getData(fetch: Fetch, config: LluConfig, session: LluSession, path: string): Promise<unknown> {
  const res = await fetch(`${session.host}${path}`, { headers: headers(config, session) });
  if (res.status === 401) throw new LluError('unauthorized');
  if (!res.ok) throw failure(res);
  const body = await readJson(res);
  if (body.status !== undefined && body.status !== 0) throw new LluError('bad_status');
  return body.data;
}

export async function patientId(fetch: Fetch, config: LluConfig, session: LluSession): Promise<string> {
  const data = await getData(fetch, config, session, '/llu/connections');
  const list = Array.isArray(data) ? data.map(record) : [];
  const match = config.patientId ? list.find((c) => c.patientId === config.patientId) : list[0];
  if (!match || typeof match.patientId !== 'string') throw new LluError('no_connection');
  return match.patientId;
}

/**
 * LibreView's `FactoryTimestamp` ("11/24/2026 1:38:50 PM", UTC) as ISO 8601. Parsed by hand: `new Date(str)` reads
 * it as local time and differs by runtime. Null when it doesn't match.
 */
export function parseFactoryTimestamp(text: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2}):(\d{2}) ([AP]M)$/i.exec(text.trim());
  if (!m) return null;
  const [, mo, d, y, h, mi, s, ampm] = m as unknown as [string, string, string, string, string, string, string, string];
  let hour = Number(h) % 12;
  if (ampm.toUpperCase() === 'PM') hour += 12;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), hour, Number(mi), Number(s)));
  if (date.getUTCMonth() !== Number(mo) - 1 || date.getUTCDate() !== Number(d) || Number(h) > 12 || Number(h) < 1) {
    return null;
  }
  return date.toISOString().replace('.000Z', 'Z');
}

function reading(item: unknown, kind: LluReading['kind']): LluReading | null {
  const r = record(item);
  const ts = typeof r.FactoryTimestamp === 'string' ? parseFactoryTimestamp(r.FactoryTimestamp) : null;
  const mgDl = typeof r.ValueInMgPerDl === 'number' ? Math.round(r.ValueInMgPerDl) : null;
  if (!ts || mgDl === null) return null;
  const trend = kind === 'current' && typeof r.TrendArrow === 'number' && r.TrendArrow >= 1 && r.TrendArrow <= 5 ? r.TrendArrow : null;
  return { ts, mgDl, trend, kind };
}

/** The latest reading (`current`) and about the last 12 hours of 15-minute points (`historic`). */
export async function graph(fetch: Fetch, config: LluConfig, session: LluSession, patient: string): Promise<LluReading[]> {
  const data = record(await getData(fetch, config, session, `/llu/connections/${encodeURIComponent(patient)}/graph`));
  const out: LluReading[] = [];
  for (const item of Array.isArray(data.graphData) ? data.graphData : []) {
    const r = reading(item, 'historic');
    if (r) out.push(r);
  }
  const current = reading(record(data.connection).glucoseMeasurement, 'current');
  if (current) out.push(current);
  return out;
}
