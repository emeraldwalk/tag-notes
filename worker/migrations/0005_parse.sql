-- Plan 10: the parse agent. A run is one model call for one raw entry; its proposals wait for me to accept or reject.
CREATE TABLE parse_runs (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  raw_entry_id  TEXT NOT NULL REFERENCES raw_entries(id) ON DELETE CASCADE,
  model         TEXT NOT NULL,          -- PARSE_MODELS id, e.g. 'llama-3.3-70b'
  model_ref     TEXT NOT NULL,          -- what was called: '<provider>/<model>'
  status        TEXT NOT NULL,          -- 'running' | 'done' | 'failed'
  error         TEXT,                   -- short code: 'timeout', 'http_429', 'bad_output', 'quota', ...
  output        TEXT,                   -- the model's raw answer, first 4000 chars
  input_tokens  INTEGER,
  output_tokens INTEGER,
  started_at    TEXT NOT NULL,
  finished_at   TEXT
);
CREATE INDEX parse_runs_by_entry ON parse_runs (raw_entry_id, started_at);

CREATE TABLE proposals (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  raw_entry_id TEXT NOT NULL REFERENCES raw_entries(id) ON DELETE CASCADE,
  run_id       TEXT NOT NULL REFERENCES parse_runs(id) ON DELETE CASCADE,
  position     INTEGER NOT NULL,        -- order within the run
  kind         TEXT NOT NULL,           -- 'food' | 'dose' | 'note'
  data         TEXT NOT NULL,           -- JSON ProposalData (pwa/src/lib/inbox/types.ts)
  status       TEXT NOT NULL DEFAULT 'proposed',  -- 'proposed' | 'accepted' | 'rejected'
  outcome_id   TEXT,                    -- the food entry / dose / note made on accept
  created_at   TEXT NOT NULL,
  decided_at   TEXT
);
CREATE INDEX proposals_by_run ON proposals (run_id, position);
