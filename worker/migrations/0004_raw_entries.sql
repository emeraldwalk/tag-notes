-- Plan 9: raw entries (text as received, from the Inbox box, Siri or Home Assistant) and the per-source tokens that
-- post them. Tokens are stored only as a SHA-256 hash.
CREATE TABLE ingest_tokens (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,          -- entries posted with this token belong to this user
  name         TEXT NOT NULL,          -- "Siri", "Kitchen"; copied onto entries as their source
  token_hash   TEXT NOT NULL UNIQUE,   -- hex SHA-256 of the full token; the token itself is never stored
  created_at   TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at   TEXT
);
-- Names are unique among a user's active tokens (any case), so a revoked "Siri" can be replaced by a new "Siri".
CREATE UNIQUE INDEX ingest_tokens_active_name ON ingest_tokens (user_id, lower(name)) WHERE revoked_at IS NULL;

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
