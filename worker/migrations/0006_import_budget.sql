-- Rows written by bulk imports (backup import, LibreView CSV) per UTC day. D1's free-plan daily limit is per Cloudflare
-- account and shared by every app on it; on 2026-11-26 an import here used it all up and other apps' writes (and the
-- IdP's sign-ins) failed until 00:00 UTC. Imports stop at a share of it (budget.ts) and finish on a later day.
CREATE TABLE import_budget (
  day  TEXT    PRIMARY KEY,   -- UTC date, YYYY-MM-DD (D1's limits reset at 00:00 UTC)
  rows INTEGER NOT NULL       -- D1's rows_written, summed over the day's import requests
);
