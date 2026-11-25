# 08 — Server storage

- [ ] Migration `0002_notes_foods.sql`
- [ ] Notes, foods, food targets and import APIs in the Worker
- [ ] The Worker serves the PWA (built with base `/`), sign-in in front of it
- [ ] HTTP `NoteStore` / `FoodStore` and async food targets in the PWA; IndexedDB stores removed
- [ ] Meal time (`eatenAt`) on food entries: Food form and history
- [ ] PWA manifest and service worker for the new home (`Tracker`, scope `/`, `/api` and `/auth` never cached)
- [ ] Tests
- [ ] Owner: push; migrate (export → import); then retire GitHub Pages and rename the repo (steps below)

## Goal

The app runs at `https://tracker.ingles.place`, signed in, with its data in D1. Everything from the GitHub Pages app
comes across through plan 6's file. Food entries record when they were eaten, which glucose reports need. Online
only: without a connection, saving shows an error and nothing is lost from the form (offline is a later
nice-to-have).

## Existing touchpoints

| Path | Role / change |
| --- | --- |
| `worker/src/index.ts` + router | New `/api` routes below; serves the PWA's assets. |
| `worker/wrangler.jsonc` | `assets: { directory: "../pwa/dist", binding: "ASSETS", not_found_handling: "single-page-application", run_worker_first: true }`. |
| `worker/package.json` | `build`: build the PWA (`npm run build -w tracker-pwa` with `VITE_BASE_PATH=/`), then `wrangler deploy --dry-run`; `deploy` likewise builds the PWA before `wrangler deploy`. |
| `pwa/vite.config.ts` | Base from `VITE_BASE_PATH` (already). Manifest name `Tracker`, short name `Tracker`, description updated; Workbox `navigateFallbackDenylist` adds `/^\/api\//`, `/^\/auth\//`; no runtime caching of `/api`. The `/preview/` special case goes when GitHub Pages does. |
| `pwa/src/lib/notes/store-instance.ts`, `pwa/src/lib/foods/store-instance.ts` | Export the HTTP stores. |
| `pwa/src/lib/notes/store.ts`, `pwa/src/lib/foods/store.ts`, `pwa/src/lib/db.ts` | IndexedDB implementations deleted with their tests and `fake-indexeddb` (git history has them if offline comes back). |
| `pwa/src/lib/foods/targets.ts` | `getFoodTargets` / `setFoodTargets` become async API calls. `todayDateKey` stays. |
| `pwa/src/lib/notes/parse.ts` | `parseNoteText` is used by the Worker too: one source file, imported by both workspaces (relative import or a `pwa` export), not copied. |
| `pwa/src/lib/export.ts` (plan 6) | Export All builds the file from the API data; Import posts the file to `/api/import`. |
| `pwa/src/routes/Food.tsx`, `FoodHistory.tsx`, `Settings.tsx` | Async targets; meal time field; history shows times. |
| `.github/workflows/deploy.yml` | Deleted in the retirement step (last commit of this plan, after the owner confirms migration). |

## Contracts

### Migration `worker/migrations/0002_notes_foods.sql`

```sql
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
```

D1 enforces foreign keys; deletes of a note also delete its `note_tags` rows.

### Types (PWA)

`Note`, `ImportableNote`, `NoteStore` unchanged. `FoodEntry` (which already has `servingSize?: string`) gains `eatenAt?: string` (UTC ISO; absent = unknown).
`FoodStore.create` / `update` take `eatenAt` too. Targets:

```ts
export function getFoodTargets(): Promise<FoodTargets>;   // DEFAULT_FOOD_TARGETS when the server has none
export function setFoodTargets(t: FoodTargets): Promise<void>;
```

### API (all signed in; the session's `sub` scopes every query; JSON; errors `{ "error": code }`)

| Route | Body / query | Response |
| --- | --- | --- |
| `GET /api/notes` | `?tag=` optional | `{ notes: Note[] }` newest first |
| `GET /api/notes/:id` | | `{ note }` or `404 not_found` |
| `POST /api/notes` | `{ rawText }` | `201 { note }` (server parses with `parseNoteText`) |
| `PUT /api/notes/:id` | `{ rawText }` | `{ note }` / `404` |
| `DELETE /api/notes/:id` | | `204` / `404` |
| `GET /api/tags` | | `{ tags: string[] }` sorted |
| `GET /api/foods` | `?date=YYYY-MM-DD` optional | `{ foods: FoodEntry[] }` newest first (by `eatenAt`, then `createdAt`) |
| `GET /api/foods/recent` | | `{ foods: FoodEntry[] }`: newest entry per distinct lowercased trimmed name |
| `POST /api/foods` | `FoodEntry` minus `id`, `createdAt` | `201 { food }` |
| `PUT /api/foods/:id` | same | `{ food }` / `404` |
| `DELETE /api/foods/:id` | | `204` / `404` |
| `GET /api/food-targets` | | `{ targets: FoodTargets \| null }` |
| `PUT /api/food-targets` | `FoodTargets` | `{ targets }` |
| `POST /api/import` | plan 6's export file (v1, v2 or bare array) | `{ notes: n, foods: n, targets: boolean }` |

- Validation as plan 6's parse rules; `eatenAt` must be ISO 8601 with offset or `Z`. `400 invalid` with a `detail`.
- Import upserts by id in D1 batches (≤ 100 statements each), in the order notes, foods, targets. An id that exists
  under **another** user is skipped and counted as `skipped`, never overwritten. Imported foods get `eatenAt` =
  their `createdAt` when `createdAt`'s date in `TZ_NAME` equals the entry's `date`, else none.
- Body limit 5 MB on `/api/import`, 64 KB elsewhere (`413`).
- PWA fetch wrapper: on `401`, go to `/auth/login?returnTo=<current path>`; other errors surface in the screen's
  existing status area.

### Serving

- `/auth/*` and `/api/*` → the Worker's handlers. Other paths: signed out → 302 to login with `returnTo`; signed in →
  `env.ASSETS.fetch(request)` (SPA fallback to `index.html`). Exception: `manifest.webmanifest`, icons and `sw.js`
  are served without a session (iOS fetches the manifest and icons without cookies when adding to the home screen).
- Plan 7's placeholder page goes; `/api/me`, and plan 14's glucose status move to Settings (a small "Glucose"
  section showing the last reading and poll status).

### Meal time in the UI

- Food form: a time field defaulting to now (local), with the date as today; editing shows the entry's time, or empty
  when unknown. Saving sends `eatenAt` in UTC; `date` stays the local date the entry counts towards.
- Today's list and Food History show the time (`h:mm a`) before each entry; unknown times show nothing.

## Concept boundaries

- **`date`** is the day an entry counts towards for daily totals; **`eatenAt`** is the clock time for glucose. They
  can disagree (a late snack logged against yesterday); don't derive one from the other after creation.
- Note `id`s and food `id`s are client-visible UUIDs; the server makes them for new rows (`crypto.randomUUID()`), and
  keeps imported ones.
- "Import" in Settings now means the server import; there's no local import any more.

## Tests

Worker: each route signed out (401) and signed in; one user can't read, change, delete or import over another's rows;
`?tag=` and `/api/tags` after create, update (tags change) and delete; recent foods; import of v1, v2 and a bare
array, with the `eatenAt` rule (same day, different day, time zone edge near midnight in America/Chicago); 400/413.
Signed-out page request → login redirect; manifest without a session → 200.
PWA: the HTTP stores against a faked `fetch` (shapes, 401 redirect).

## Owner steps

1. Push. Open `https://tracker.ingles.place`, sign in, Add to Home Screen.
2. Settings → Import → the file from plan 6 (re-export first if you've logged anything since). Check counts against
   the old app's.
3. Use it for a few days alongside the old home-screen icon (read-only habit), then tell Claude to retire GitHub Pages:
   Claude deletes `.github/workflows/deploy.yml` and the `/preview/` Workbox special case, and commits.
4. GitHub: Settings → Pages → unpublish; delete the `gh-pages` branch; remove the old home-screen icon.
5. **Then** rename the repo to `tracker` on GitHub, update the remote (`git remote set-url`), and rename the local
   folder. (Renaming earlier would move the Pages path from `/tag-notes/` and break the installed app before the
   data was out. The local folder name also keys this devcontainer's Claude settings volume, so session history
   there starts fresh.)
6. Push a commit and check that Workers Builds still builds. It identifies the repo by GitHub repo id, so a rename
   should carry over, but Cloudflare doesn't document it. If it doesn't: the Worker's Settings → Builds → disconnect,
   then connect the renamed repo with the same build and deploy commands. The live Worker keeps serving meanwhile.

## Validation (owner)

1. After import: note and food counts match; a few notes' tags filter correctly; today's totals match the old app.
2. Log a food with a time; it shows in history with that time; edit it.
3. Sign out and back in on the phone: lands back where you were.
4. Airplane mode: saving shows an error and the form keeps its text.
5. `wrangler tail`: CPU of `GET /api/notes` and the import, against 10 ms. If the import goes over with a large file,
   the PWA splits it into several requests.
