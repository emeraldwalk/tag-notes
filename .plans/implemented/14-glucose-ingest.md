# 14 — Glucose ingest

- [x] Migration `0001_glucose.sql`
- [x] LibreLinkUp client (login, region redirect, cached token, connections, graph) and timestamp parsing
- [x] Cron every 5 minutes storing readings; poll status recorded
- [x] `POST /api/ingest/glucose` (bearer token) — the fallback path and any other push source
- [x] `GET /api/glucose` and `GET /api/glucose/status` (signed in); placeholder page shows the last reading
- [x] Tests
- [x] README: secrets, the Libre follower setup, the fallback
- [ ] Owner: follower account, secrets, `OWNER_USER_ID`, push, live checks — **first check decides LLU vs fallback**

## Implementation notes (2026-11-24)

- A refused sign-in (`login_failed`) also pauses polling for an hour and drops the cached token, so a wrong password
  doesn't retry every 5 minutes and lock the follower account.
- `OWNER_USER_ID` empty makes the cron record `no_owner_user_id` and the ingest route answer `503`, rather than
  storing readings under no one.
- The HA fallback's config is already written, in `docs/home-assistant.md`, so switching needs no code.

## Goal

Glucose readings collect in D1 every 5 minutes from plan 7 onward, so there's live data while the rest is built.
History before that comes later from LibreView CSV (plan 17); LibreView keeps it, so nothing is lost by waiting.

## Background: the LibreLinkUp API (unofficial)

Researched 2026-11-24 from `timoschlueter/nightscout-librelink-up` (`src/index.ts`,
`src/constants/llu-api-endpoints.ts`; last version bump 2025-10-02) and the community gist
`khskekec/6c13ba01b10d3018d816706a32ae8ab2`. Undocumented; expect changes.

- Hosts: `https://api-{region}.libreview.io` (`us`, `eu`, `eu2`, `de`, `fr`, `ca`, `au`, `ap`, `ae`, `jp`, `la`).
- `POST /llu/auth/login`, JSON `{ "email", "password" }`. Headers: `product: llu.ios`, `version: 4.16.0`,
  `Content-Type: application/json;charset=UTF-8`, a mobile Safari `User-Agent`, `Accept-Encoding: gzip`.
- Login answers `{ status: 0, data: { user: { id }, authTicket: { token, expires (epoch s), duration } } }`, or
  `{ status: 0, data: { redirect: true, region: "us" } }` (no token): log in again on that region's host.
  `status` ≠ 0 is a failure (e.g. bad credentials, `status: 2`).
- Then every call: `Authorization: Bearer <token>` and `account-id: <lowercase hex SHA-256 of user.id>` (raw id →
  `AccountIdMismatch`). Same `product`/`version`/`User-Agent` headers.
- `GET /llu/connections` → `data[]`; take `patientId` of the first (or the one matching `LLU_PATIENT_ID` if set).
- `GET /llu/connections/{patientId}/graph` → `data.connection.glucoseMeasurement` (latest, ~1-minute) and
  `data.graphData[]` (about the last 12 hours, 15-minute points). Each item: `FactoryTimestamp` (UTC, as
  `"11/24/2026 1:38:50 PM"`), `Timestamp` (local, same format), `ValueInMgPerDl`, `TrendArrow` (1–5; latest only).
- Rate limits: 429/430, sometimes `Retry-After`; lockouts reported after hammering. The reference client polls every
  5 minutes.
- **Risk:** the reference client customises TLS ciphers and keeps cookies to get past Cloudflare bot checks in front
  of LibreView. A Worker can't change its TLS fingerprint. Whether LibreView blocks Worker requests is unknown until
  the first live run; that's this plan's first validation step.

## Contracts

### Migration `worker/migrations/0001_glucose.sql`

```sql
CREATE TABLE glucose_readings (
  user_id    TEXT    NOT NULL,           -- IdP sub
  ts         TEXT    NOT NULL,           -- UTC, ISO 8601 with Z, to the second
  mg_dl      INTEGER NOT NULL,
  trend      INTEGER,                    -- LLU TrendArrow 1–5, NULL when unknown
  source     TEXT    NOT NULL,           -- 'llu' | 'ha' | 'csv'
  kind       TEXT    NOT NULL,           -- 'current' (latest) | 'historic' (graph / CSV historic) | 'scan'
  created_at TEXT    NOT NULL,
  PRIMARY KEY (user_id, source, ts)
);
CREATE INDEX glucose_by_time ON glucose_readings (user_id, ts);

CREATE TABLE llu_state (                 -- one row, id = 1
  id               INTEGER PRIMARY KEY CHECK (id = 1),
  host             TEXT,                 -- e.g. https://api-us.libreview.io after any redirect
  token            TEXT,
  token_expires    INTEGER,              -- epoch s
  account_id       TEXT,                 -- SHA-256 hex of user.id
  patient_id       TEXT,
  last_run_at      TEXT,
  last_ok_at       TEXT,
  last_error       TEXT,                 -- short code + HTTP status, e.g. 'http_403', 'login_failed', 'rate_limited'
  backoff_until    TEXT                  -- skip runs until then (429/430/lockout)
);
```

Inserts are `INSERT OR IGNORE` on the primary key, so overlapping graph windows don't duplicate.

### Config (`wrangler.jsonc`)

- `triggers: { crons: ["*/5 * * * *"] }`. (Free plan: 5 cron triggers per account; family-mail's Workers may use some.
  The owner confirms one is free.)
- `vars`: `LLU_REGION: "us"`, `LLU_VERSION: "4.16.0"`, `OWNER_USER_ID: "<sub from plan 7's page>"` (the readings'
  `user_id`; the cron has no session).
- Secrets: `LLU_EMAIL`, `LLU_PASSWORD` (the follower account), `HA_INGEST_TOKEN`.
- With `LLU_EMAIL` unset the cron does nothing (records `last_error: 'not_configured'`), so the fallback path can run
  alone.

### Poll (`scheduled` handler)

1. Skip if `backoff_until` is in the future.
2. Use the cached token unless missing or within 1 hour of `token_expires`; otherwise log in (following one region
   redirect) and store host, token, expiry, account id.
3. `patient_id` from `/llu/connections` when not cached.
4. `/graph`: store `graphData[]` as `kind 'historic'` and `glucoseMeasurement` as `kind 'current'`, source `'llu'`,
   `ts` from `FactoryTimestamp` parsed **as UTC** by explicit parsing of `M/D/YYYY h:mm:ss AM|PM` (not `new Date(str)`,
   which reads it as local time and varies by runtime).
5. On 401 once: drop the token, log in, retry once. On 429/430: set `backoff_until` from `Retry-After`, else 30 min.
   Any other failure: record `last_error`, keep the token. Never log the password, token or email.
6. Record `last_run_at`, and `last_ok_at` on success.

CPU: one login every ~180 days, then two small JSON responses per run (well under 10 ms). Measure with `wrangler tail`.

### `POST /api/ingest/glucose`

Bearer `HA_INGEST_TOKEN`, compared in constant time (as family-mail's `tokenMatches` in
`apps/dashboard/src/worker/sensors.ts`); `401 {"error":"unauthenticated"}` without it.

```json
{ "readings": [ { "ts": "2026-11-24T19:38:50Z", "mgDl": 112, "trend": 3 } ], "source": "ha" }
```

- `readings` 1…500 items; `ts` ISO 8601 with offset or `Z`, not in the future by more than 5 minutes; `mgDl` integer
  20…600; `trend` optional 1…5; `source` `"ha"` (only value accepted for now). Stored as `kind 'current'` for the
  user `OWNER_USER_ID`.
- → `200 { "inserted": n, "duplicates": m }`; `400 {"error":"invalid", "detail": "..."}`; `415` non-JSON; `413` over
  256 KB.

### Signed-in reads

- `GET /api/glucose?from=<ISO>&to=<ISO>` → `{ "readings": [ { "ts", "mgDl", "trend", "source", "kind" } ] }`, the
  session user's rows, `from` ≤ `ts` < `to`, sorted by `ts`; range at most 31 days (`400` otherwise). When two
  sources have the same minute, return both; reports decide.
- `GET /api/glucose/status` → `{ "lastReading": { "ts", "mgDl", "trend" } | null, "llu": { "lastRunAt", "lastOkAt",
  "lastError", "backoffUntil" } }` (no token or ids).
- Plan 7's placeholder page shows the last reading and the LLU status.

## Concept boundaries

- **`source`** is where a reading came from; **`kind`** is what sort of reading it is. Don't merge them.
- **`HA_INGEST_TOKEN`** is this Worker's own secret with the same name as family-mail's dashboard secret; they should
  be different values. Plan 12 (kitchen voice) reuses this one.
- `llu_state` is operational state, not user data; it has no `user_id`.

## Fallback: Home Assistant polls, Tracker receives (owner's choice, 2026-11-24)

If validation step 1 shows LibreView refusing the Worker (403, a Cloudflare challenge page, or repeated connection
errors): unset `LLU_EMAIL` (or delete the secret), and in HA install a LibreLinkUp integration from HACS (pick the most
maintained one at the time; check it supports the follower login), then an automation on its glucose sensor's state
change calling a `rest_command` that posts one reading to `POST /api/ingest/glucose` with `ts` = the sensor's
`last_changed` (or the integration's own timestamp attribute if it has one). Document the HA config in
`docs/home-assistant.md` (new file) with the `secrets.yaml` header pattern family-mail's dashboard docs use. HA's
config repo is `/workspaces/iot/home-assistant-config`; the owner adds it there.

## Tests (`worker/test/glucose.test.ts`)

All with `fetch` faked (no network):

- Login with region redirect → second login on the new host; `account-id` header is the SHA-256 of the user id.
- Cached token reused; token near expiry → new login; 401 → one re-login and retry.
- Graph response stored; a second run with overlapping points adds no duplicates; `FactoryTimestamp` parsing for AM,
  PM, 12 AM and 12 PM, single- and double-digit month/day.
- 429 with and without `Retry-After` → `backoff_until`; next run skipped.
- `LLU_EMAIL` unset → no fetch, `not_configured`.
- Ingest: wrong/missing token 401, bad bodies 400, duplicates counted, 413/415.
- Reads: signed-out 401, range limit, another user's rows not returned.

## Owner steps

1. **Follower account:** a separate LibreView account (different email) for LibreLinkUp. In the Libre 3 app: Share →
   Connected apps → LibreLinkUp → invite that email; accept in the LibreLinkUp app once, and accept its terms there.
2. `OWNER_USER_ID` in `wrangler.jsonc` from plan 7's page (commit), and `LLU_REGION` if not US.
3. From `worker/`: `npx wrangler secret put LLU_EMAIL`, `LLU_PASSWORD`, `HA_INGEST_TOKEN`
   (`openssl rand -base64 32`).
4. Push.

## Validation (owner, after the push)

1. **Decides the path:** within 10 minutes, plan 7's page shows a last reading matching the Libre app (±1 reading),
   and `llu.lastError` is empty. If it shows `http_403` or similar, switch to the fallback above.
2. After an hour: a `current` reading about every 5 minutes and `historic` points every 15, no gaps beyond 15 minutes; no `rate_limited`.
3. `wrangler tail tracker --format json`: cron CPU per run, against 10 ms. Record in the README.
4. Ingest with a wrong token → 401 in `wrangler tail`.
