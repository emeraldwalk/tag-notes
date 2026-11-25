# 16 — Medicine log

- [x] Migration `0003_medicine.sql`
- [x] Medicines and doses APIs; convert-notes API
- [x] Meds tab: one-tap "taken" per medicine, time adjust, undo; history
- [x] Manage medicines (Settings)
- [x] Convert `meds`-tagged notes (Settings)
- [x] Tests
- [ ] Owner: push, set up medicines, convert old notes, live checks

## Goal

Taking a medicine is one tap, recorded with the time, so reports (plan 15) can line it up with glucose. The medicine
notes logged so far (tag `meds`) become structured entries. Voice ("I took my …") comes with the parse agent
(plan 10), which proposes doses through this plan's API.

## Existing touchpoints

| Path | Role / change |
| --- | --- |
| `worker/src` router | New routes below. |
| `pwa/src/App.tsx` | Routes `/meds`, `/meds/history`. |
| `pwa/src/components/BottomNav.tsx` | A fourth tab, "Meds", between Food and Settings. |
| `pwa/src/routes/Settings.tsx` | "Medicines" section (manage list) and "Convert medicine notes". |
| `pwa/src/lib/notes/*` | Read only: the conversion lists notes by tag through the existing `NoteStore.listByTag('meds')`. |
| Export (plan 6 / 8) | Export All gains `medicines` and `doses` arrays; `/api/import` accepts them (version stays 2; both optional). |

## Contracts

### Migration `worker/migrations/0003_medicine.sql`

```sql
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
```

### Types

```ts
export interface Medicine { id: string; name: string; defaultDose?: string; active: boolean; sortOrder: number; createdAt: string }
export interface Dose {
  id: string; medicineId?: string; medicineName: string; dose?: string;
  takenAt: string; note?: string; source: 'tap' | 'manual' | 'note' | 'voice'; createdAt: string;
}
```

### API (signed in, scoped to the session's user, errors as plan 8)

| Route | Body / query | Response |
| --- | --- | --- |
| `GET /api/medicines` | | `{ medicines }` by `sortOrder`, then name; inactive included |
| `POST /api/medicines` | `{ name, defaultDose? }` | `201 { medicine }`; `409 duplicate_name` |
| `PUT /api/medicines/:id` | `{ name?, defaultDose?, active?, sortOrder? }` | `{ medicine }` |
| `DELETE /api/medicines/:id` | | `204`; its doses keep `medicineName` |
| `GET /api/doses` | `?from=&to=` ISO, ≤ 92 days | `{ doses }` newest first |
| `POST /api/doses` | `{ medicineId?, medicineName?, dose?, takenAt?, note?, source }` | `201 { dose }`; `medicineName` from the medicine when `medicineId` given; one of the two required; `takenAt` defaults to now |
| `PUT /api/doses/:id` | `{ dose?, takenAt?, note? }` | `{ dose }` |
| `DELETE /api/doses/:id` | | `204` |
| `POST /api/doses/convert-notes` | `{ groups: [ { noteIds: string[], medicineId: string } ] }` | `{ converted: n, skipped: n }` |

`convert-notes`, for each note (the session user's, still tagged `meds`, else `skipped`): one dose with that
medicine, `takenAt` = the note's `createdAt`, `dose` = the medicine's default, `note` = the note's `rawText`,
`source 'note'`; then the note is deleted. All in one D1 batch per request, so a failure leaves notes in place.

### Screens

- **Meds** (`/meds`): today's doses at the top (time, name, dose). Below, a button per active medicine: tap logs
  "now" and shows an Undo for a few seconds; a long press or a "…" opens a sheet to change time or dose before
  saving. "Log something else" for a one-off name. Link to History.
- **History** (`/meds/history`): doses by day, newest first; tap one to edit time/dose/note or delete.
- **Settings → Medicines:** add, rename, set default dose, reorder, deactivate (hidden from the Meds buttons, kept
  for history).
- **Settings → Convert medicine notes:** lists `meds`-tagged notes grouped by their title (lowercased, trimmed), with
  count and date range. Each group picks a medicine (existing, "new medicine named <title>", or skip). Confirm runs
  `convert-notes`. Shown only while such notes exist.

## Concept boundaries

- A **medicine** is something on my list; a **dose** is one time I took something. Doses can exist without a
  medicine (one-offs, deleted medicines).
- `source 'note'` is for converted notes; plan 10's parse agent uses `'voice'` for doses it proposes and I approve.
- The `meds` tag stays a normal tag: new notes with it aren't converted automatically (the convert screen shows them).

## Tests

Routes signed out / signed in and cross-user isolation; duplicate medicine name; dose defaults (name, dose, time);
medicine delete keeps doses; convert-notes happy path, a note of another user or without the tag skipped, notes
deleted only on success; range limit; export/import round trip of medicines and doses.

## Validation (owner)

1. Add your medicines; tap one on the Meds tab; it shows under today with the time; Undo removes it.
2. Change a dose's time from History.
3. Convert the `meds` notes: counts match; the notes are gone from Notes; the doses show on their original days.

## Implementation notes (2026-11-25)

- **`GET /api/doses` with no `from`/`to`** answers every dose (as `GET /api/foods` does), for Export All. With a
  range, both are required, `to` after `from`, at most 92 days; otherwise `400 invalid`. History loads 92-day windows
  back from today ("Load earlier").
- **Medicine names** are unique per user case-insensitively in the API (`409 duplicate_name` on add and rename);
  names and doses are trimmed, at most 200 characters. New medicines go to the end of the list (`sortOrder` max + 1).
- **`POST /api/doses`:** `medicineId` must be one of the user's medicines (`400 invalid` otherwise). `dose` absent →
  the medicine's default; `dose: null` → none (the sheet sends null when its pre-filled default is cleared).
- **`convert-notes`** takes at most 50 notes per request (two statements each, one batch of ≤ 100, as plan 8); the
  PWA splits larger conversions into several requests, each all-or-nothing. Every `medicineId` must be the user's
  (else `400`, nothing converted). Per note, the dose is inserted only while the note is the user's and still tagged
  `meds`, and the note is deleted under the same condition; a repeated note id converts once. "New medicine named
  <title>" creates the medicine first (reusing one of the same name if it already exists).
- **Import** (`/api/import`) runs medicines then doses after targets, and answers `medicines` and `doses` counts too.
  A medicine whose name (any case) is already another of the user's medicines, or earlier in the file, is merged
  rather than inserted (counted under `medicines`, not `skipped`). A dose's `medicineId` links to the user's medicine
  with that id, else the user's medicine with the dose's `medicineName`, else none; never another user's.
  `backup.ts` chunks notes, foods, medicines and doses in that order (200 rows per request).
- Types: `pwa/src/lib/meds/types.ts` (shared with the Worker, types only). Validation for files lives in `export.ts`
  (`parseMedicine`, `parseDose`, `isDoseSource`, `medicineName`); the Worker's routes use those helpers.
- UI: the dose sheet is a `<dialog>` (`DoseSheet`), used for "…" / long press (500 ms) on a medicine, "Log something
  else", and editing in History (with Delete). Undo shows for 6 s after a tap or a sheet log.

## Owner steps

1. Push. The deploy applies migration `0003_medicine.sql` to the remote D1.
2. Settings → Medicines: add your medicines (default doses), in the order you want the buttons.
3. Meds tab: validation steps 1–2 below.
4. Settings → Convert medicine notes: pick a medicine per group, Convert; validation step 3.
5. Optionally `wrangler tail` while converting a large group: CPU per `convert-notes` request against 10 ms.
