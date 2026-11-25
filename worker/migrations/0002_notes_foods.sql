-- Plan 8: notes, food entries and food targets move from the browser's IndexedDB to D1. Every row carries the IdP sub.
CREATE TABLE notes (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  raw_text   TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  tags       TEXT NOT NULL,          -- JSON array of strings, as parseNoteText returns
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX notes_by_user ON notes (user_id, created_at);
CREATE TABLE note_tags (             -- for listTags / ?tag=; rewritten with the note
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  tag     TEXT NOT NULL,
  PRIMARY KEY (note_id, tag)
);
CREATE INDEX note_tags_by_tag ON note_tags (user_id, tag);

CREATE TABLE foods (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  name       TEXT NOT NULL,
  serving_size TEXT,                 -- free text, "1 cup"; optional
  quantity   REAL NOT NULL,
  protein    REAL NOT NULL,          -- per unit of quantity, as today
  calories   REAL NOT NULL,
  carbs      REAL NOT NULL,
  date       TEXT NOT NULL,          -- YYYY-MM-DD local date it counts towards
  eaten_at   TEXT,                   -- UTC ISO 8601; NULL = time unknown (imported)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX foods_by_date ON foods (user_id, date);

CREATE TABLE food_targets (
  user_id  TEXT PRIMARY KEY,
  protein  REAL NOT NULL,
  calories REAL NOT NULL
);
