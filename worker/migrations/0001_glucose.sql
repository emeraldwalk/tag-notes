-- Plan 14: glucose readings from LibreLinkUp (cron), Home Assistant (push) and, later, LibreView CSV (plan 17).
CREATE TABLE glucose_readings (
  user_id    TEXT    NOT NULL,           -- IdP sub
  ts         TEXT    NOT NULL,           -- UTC, ISO 8601 with Z, to the second
  mg_dl      INTEGER NOT NULL,
  trend      INTEGER,                    -- LibreLinkUp TrendArrow 1-5, NULL when unknown
  source     TEXT    NOT NULL,           -- 'llu' | 'ha' | 'csv'
  kind       TEXT    NOT NULL,           -- 'current' | 'historic' | 'scan'
  created_at TEXT    NOT NULL,
  PRIMARY KEY (user_id, source, ts)
);
CREATE INDEX glucose_by_time ON glucose_readings (user_id, ts);

-- The LibreLinkUp poller's own state: one row, id = 1. Operational, not user data.
CREATE TABLE llu_state (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  host          TEXT,                    -- e.g. https://api-us.libreview.io, after any region redirect
  token         TEXT,
  token_expires INTEGER,                 -- epoch seconds
  account_id    TEXT,                    -- SHA-256 hex of the LibreLinkUp user id
  patient_id    TEXT,
  last_run_at   TEXT,
  last_ok_at    TEXT,
  last_error    TEXT,                    -- short code, e.g. 'http_403', 'login_failed', 'rate_limited'
  backoff_until TEXT                     -- skip runs until then
);
INSERT INTO llu_state (id) VALUES (1);
