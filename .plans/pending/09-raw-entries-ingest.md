# 9 — Raw entries + ingest

- [ ] Migration `0004_raw_entries.sql`
- [ ] Ingest tokens: API + Settings → Capture sources (create, show once, revoke)
- [ ] `POST /api/ingest/text` (bearer token, no session)
- [ ] Raw entries API (list, add from the app, make note, mark done / dismiss, delete)
- [ ] Inbox tab: capture box, new entries, actions, done / dismissed list
- [ ] Export All / import carry `rawEntries`
- [ ] README: Siri Shortcut (phone and watch) and `curl` example
- [ ] Tests
- [ ] Owner: push, create a "Siri" token, build the Shortcut, live checks

## Goal

Anything I say or type to Tracker is kept word for word, with its time, before anything tries to understand it.
Siri on the phone or watch ("Hey Siri, Tracker") dictates a sentence and posts it here; Home Assistant's kitchen
voice (plan 12) will post the same way. Until the parse agent (plan 10) exists, the Inbox is where I read these and
turn each into a note, or log it myself and mark it done.

## Existing touchpoints

| Path | Role / change |
| --- | --- |
| `worker/src/app.ts` | Mount the ingest route next to `glucoseIngest` under `/api/ingest` (before the session middleware); mount the session routes below on `api`. |
| `worker/src/glucoseRoutes.ts` | `tokenMatches` / `HA_INGEST_TOKEN` stay as they are (glucose only). Reuse `normalizeIso` if useful. |
| `worker/src/body.ts` | `readJson`, `invalid`, `toIso`: same body limits and error shape as plan 8. |
| `worker/src/notes.ts` | Read: how a note row and its tags are written (`parseNoteText`, `rewriteTags`); "make note" writes one the same way, with the entry's time. |
| `worker/src/import.ts`, `pwa/src/lib/export.ts`, `pwa/src/lib/backup.ts` | Export file gains an optional `rawEntries` array (version stays 2); import upserts it by id, never another user's; chunked like the other rows. |
| `pwa/src/App.tsx` | Route `/inbox`. |
| `pwa/src/components/BottomNav.tsx` | A fifth tab, "Inbox", first (left of Notes), with a count of `new` entries. |
| `pwa/src/routes/Settings.tsx` | "Capture sources" section (ingest tokens). |
| `pwa/src/lib/api.ts` | All PWA calls go through `api()`, as in plan 8. |
| `README.md` | New "Capture (plan 9)" section under Deploying, beside "Glucose (plan 14)". |

## Contracts

### Migration `worker/migrations/0004_raw_entries.sql`

```sql
CREATE TABLE ingest_tokens (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,          -- entries posted with this token belong to this user
  name         TEXT NOT NULL,          -- "Siri", "Kitchen"; copied onto entries as their source
  token_hash   TEXT NOT NULL UNIQUE,   -- hex SHA-256 of the full token; the token itself is never stored
  created_at   TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at   TEXT,
  UNIQUE (user_id, name)
);

CREATE TABLE raw_entries (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  text         TEXT NOT NULL,          -- verbatim, never edited
  source       TEXT NOT NULL,          -- 'app' for the Inbox box, else the token's name at the time
  token_id     TEXT,                   -- the ingest token used, if any (kept after revoke)
  occurred_at  TEXT NOT NULL,          -- UTC ISO 8601: when it was said (sender's time, else received_at)
  received_at  TEXT NOT NULL,          -- UTC ISO 8601: when the Worker got it
  status       TEXT NOT NULL DEFAULT 'new',  -- 'new' | 'done' | 'dismissed'
  outcome_kind TEXT,                   -- 'note' when made into a note here; plan 10 adds others
  outcome_id   TEXT,                   -- that row's id
  updated_at   TEXT NOT NULL
);
CREATE INDEX raw_entries_by_status ON raw_entries (user_id, status, occurred_at);
```

### Tokens

- Format: `trk_` + 32 random bytes as base64url (no padding). Shown once, at creation; only the hash is kept.
- Check: SHA-256 of the presented token, looked up by `token_hash` with `revoked_at IS NULL`. The token is high
  entropy, so a hash lookup is the constant-time check (no comparison of secrets in JS).
- Never logged, never in an error message, never exported.

### Ingest route (no session)

`POST /api/ingest/text`

- Headers: `Authorization: Bearer trk_…`, `Content-Type: application/json`.
- Body: `{ "text": string, "occurredAt"?: string }`. `text` is trimmed; 1–4000 characters after trimming.
  `occurredAt` is ISO 8601 with a zone, not more than 5 minutes in the future; absent or empty → received time.
- Responses:
  - `201 { "id": string, "saved": "Saved: <first 60 chars of text>" }` (Shortcuts shows `saved` as the result).
  - `401 unauthenticated` (missing, unknown or revoked token), `415 json_required`, `413 too_large` (body over
    16 KB), `400 invalid` with `detail`.
- Effect: one `raw_entries` row (`status 'new'`, `source` = token name, `token_id`), and the token's `last_used_at`
  set, in one batch.

### Session API (signed in, scoped to the session's user, errors as plan 8)

| Route | Body / query | Response |
| --- | --- | --- |
| `GET /api/ingest-tokens` | | `{ tokens: [ { id, name, createdAt, lastUsedAt?, revokedAt? } ] }`, newest first; never the hash |
| `POST /api/ingest-tokens` | `{ name }` (1–40 chars, trimmed) | `201 { token: {…as above}, secret: "trk_…" }`; `409 duplicate_name` |
| `DELETE /api/ingest-tokens/:id` | | `204`; sets `revoked_at` (the row stays so entries keep their source) |
| `GET /api/raw-entries` | `?status=new\|done\|dismissed\|all` (default `new`), `&before=<iso>`, `&limit=` (default 50, max 200) | `{ entries }` newest `occurredAt` first, before `before` if given |
| `GET /api/raw-entries/count` | | `{ new: number }` |
| `POST /api/raw-entries` | `{ text, occurredAt? }` | `201 { entry }`; `source 'app'` |
| `PUT /api/raw-entries/:id` | `{ status: 'new'\|'done'\|'dismissed' }` | `{ entry }`; `text` cannot be changed |
| `POST /api/raw-entries/:id/note` | | `201 { note, entry }`: a note with `rawText` = the entry's text and `createdAt` = `updatedAt` = its `occurredAt`; the entry becomes `done` with `outcome_kind 'note'`. `409 already_filed` if it already has an outcome. One batch. |
| `DELETE /api/raw-entries/:id` | | `204` |

```ts
// pwa/src/lib/inbox/types.ts (shared with the Worker, types only)
export type RawEntryStatus = 'new' | 'done' | 'dismissed';
export interface RawEntry {
  id: string; text: string; source: string; occurredAt: string; receivedAt: string;
  status: RawEntryStatus; outcomeKind?: 'note'; outcomeId?: string; updatedAt: string;
}
export interface IngestToken { id: string; name: string; createdAt: string; lastUsedAt?: string; revokedAt?: string }
```

Export file: `rawEntries?: RawEntry[]` (without `token_id`). Import upserts by id (never another user's, counted in
`skipped`), and the import response gains `rawEntries: number`.

### Screens

- **Inbox** (`/inbox`): a text box ("Say or type anything") with Save → `POST /api/raw-entries`. Below, `new`
  entries newest first: text, time (today: time only; else date and time), source. Per entry: **Note** (make
  note; then a link to it), **Done** (I handled it elsewhere, e.g. logged the food myself), **Dismiss**, and Delete
  behind a confirm. A "Done and dismissed" view lists the rest with "Move back to Inbox", loading earlier pages.
- **BottomNav:** "Inbox" first, showing the `new` count when above zero. The count loads on app start and refreshes
  after Inbox actions and when the app comes back to the foreground (`visibilitychange`).
- **Settings → Capture sources:** list of tokens (name, created, last used, revoked). Add: name → shows the secret
  once with a Copy button and "You won't see this again". Revoke behind a confirm.

## Concept boundaries

- A **raw entry** is text as received; a **note** is the existing notes feature. Making a note copies the text; the
  raw entry stays (as `done`) and is never edited. Typing on the Notes tab still creates notes directly, not entries.
- **Ingest tokens** (D1, per source, created in Settings) are not `HA_INGEST_TOKEN` (a Worker secret, glucose push
  only, plan 14). Leave the glucose route alone.
- `/api/ingest/*` is the token-authenticated prefix; `/api/raw-entries` and `/api/ingest-tokens` are session routes.
- `status` is mine (new / done / dismissed). Parsing state (plan 10) gets its own columns or table later; don't add
  placeholders for it here.
- Nothing in this plan interprets text: no food, dose or tag detection.

## Siri Shortcut (README)

Document a Shortcut named "Tracker" (so "Hey Siri, Tracker" runs it), shown on Apple Watch:

1. **Dictate Text** (stop listening: after pause).
2. **Get Contents of URL**: `https://tracker.ingles.place/api/ingest/text`, Method POST, Headers
   `Authorization: Bearer <token>`, Request Body JSON with `text` = Dictated Text.
3. **Get Dictionary Value** `saved` from the result → **Show Result** (Siri speaks it).

Plus a `curl` example for testing, with the token in an environment variable, not inline.

## Tests

Ingest: no token, unknown token, revoked token → 401; wrong content type; body too large; empty / too long text;
`occurredAt` in the future, without a zone, absent; the entry belongs to the token's user, has the token's name as
source and `last_used_at` is set. Tokens: created secret works once stored, the list never returns the hash or
secret, duplicate name, revoke. Entries: signed out 401s, cross-user isolation on every route, status filter and
`before` paging, count, make note (time and text, entry done, second call `409`), status changes, delete. Export /
import round trip of `rawEntries`.

## Validation (owner)

1. Settings → Capture sources → add "Siri"; copy the secret into the Shortcut.
2. "Hey Siri, Tracker" on the phone, then on the watch: Siri answers "Saved: …"; both show in the Inbox with the
   right time and source "Siri", and the tab count goes up.
3. Type an entry in the Inbox box; make it a note: the note shows in Notes at the entry's time.
4. Mark one Done and one Dismissed; both move to "Done and dismissed"; move one back.
5. Revoke the token; the Shortcut gets 401. Create a new one and update the Shortcut.
6. `wrangler tail` while posting: CPU per `POST /api/ingest/text` well under 10 ms.

## Owner steps

1. Push. The deploy applies `0004_raw_entries.sql` to the remote D1.
2. Validation above (build the Shortcut from the README).
