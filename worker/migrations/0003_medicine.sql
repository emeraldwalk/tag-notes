-- Plan 16: medicine log. A medicine is something on the list; a dose is one time something was taken.
CREATE TABLE medicines (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  name         TEXT NOT NULL,          -- "Metformin"
  default_dose TEXT,                   -- free text, "500 mg"
  active       INTEGER NOT NULL DEFAULT 1,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  UNIQUE (user_id, name)
);

CREATE TABLE doses (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL,
  medicine_id    TEXT REFERENCES medicines(id) ON DELETE SET NULL,
  medicine_name  TEXT NOT NULL,        -- copied at logging time, so history survives renames and deletes
  dose           TEXT,                 -- free text; defaults to the medicine's default_dose
  taken_at       TEXT NOT NULL,        -- UTC ISO 8601
  note           TEXT,                 -- e.g. the converted note's raw text
  source         TEXT NOT NULL,        -- 'tap' | 'manual' | 'note' | 'voice'
  created_at     TEXT NOT NULL
);
CREATE INDEX doses_by_time ON doses (user_id, taken_at);
