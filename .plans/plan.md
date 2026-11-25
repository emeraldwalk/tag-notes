# Tracker — Plan Index

Tag Notes is becoming **Tracker**: one personal app at `https://tracker.ingles.place` for notes (medicine taken, how
I feel), food, and the health data behind blood sugar highs (glucose, sleep, exercise). Entries can be typed, dictated
on the phone or watch, or spoken in the kitchen; the app works out what was meant using food data, and I approve it.

This replaces the earlier standalone plan in `/workspaces/tools/health-tracker` (Pi 5 + Bun + SQLite + Tailscale),
decided 2026-11-24. The goals carried over; the hosting didn't.

## Direction (decided 2026-11-24)

```
 iPhone / Watch                                   Cloudflare (free plan)
 ┌───────────────────────────┐                    ┌────────────────────────────────────┐
 │ Tracker PWA ──────────────┼── IdP cookie ─────▶│ tracker Worker (tracker.ingles.place)│
 │ Siri Shortcut: dictate ───┼── bearer token ───▶│  ├─ static PWA                     │
 │ Health samples Shortcut ──┼── bearer token ───▶│  ├─ /api (notes, food, entries)    │
 └───────────────────────────┘                    │  ├─ /api/ingest/* (raw text, samples)│
 Kitchen: ReSpeaker → HA Assist ─ bearer token ──▶│  ├─ parse agent (LLM + food tools) │
   (STT via family-mail dash-10's Whisper shim)   │  ├─ cron: LibreLinkUp poller       │
                                                  │  └─ D1                             │
                                                  └────────────────────────────────────┘
```

- **One app, this repo.** The existing SolidJS PWA (notes, food log, targets, recent foods) is the base. It moves from
  GitHub Pages and IndexedDB to a Cloudflare Worker with D1 at `tracker.ingles.place`. Its own Worker, not part of
  the Ingles Place monorepo (`/workspaces/tools/family-mail`), but reusing its pieces where they fit.
- **Data control, not self-hosting**, was the requirement. Cloudflare is fine.
- **Sign-in:** the family IdP (`https://auth.emeraldwalk.com`) through `@emeraldwalk/idp-client` (its README:
  `/workspaces/tools/idp/packages/idp-client/README.md`). Personal app: one user for now, but rows carry the IdP
  user id so others could be added.
- **Non-browser sources** (Siri Shortcuts, Home Assistant) use per-source bearer tokens, checked in constant time,
  like family-mail's `HA_INGEST_TOKEN` (`apps/dashboard/src/worker/sensors.ts` `tokenMatches`). The IdP has no API
  tokens.
- **Raw text first.** Every typed, dictated or spoken entry is saved verbatim with a timestamp before anything
  interprets it. Capture channels only ever send text; none of them need to know about food. Notes already work this
  way (`rawText` → parsed title/body/tags).
- **Voice reuse:** the kitchen path rides family-mail's dash-10 pipeline (ReSpeaker → HA Assist → Whisper on Workers
  AI). HA matches a prefix sentence (e.g. "(I ate|I had|log) {text}", "I took my {text}") and a `rest_command`
  posts the raw text here. No LLM routing in HA; interpretation happens in this app.
- **Parse agent:** runs in the Worker, turns a raw entry into *proposed* food entries (or notes) using tools: my
  recent/approved foods first, then USDA FoodData Central, then Open Food Facts. Proposals need approval; approved
  foods resolve repeat meals automatically. Model set by config (provider, base URL, model id, key) and recorded on
  each proposal. Default: a Workers AI model on the free allowance; any OpenAI-compatible endpoint is a config swap.
  Whether `@mariozechner/pi-ai` / `pi-agent-core` run on Workers is unverified; a plain tool-calling loop is fine too.
- **Free plan: 10 ms CPU per request and cron run.** Waiting on fetch doesn't count. Keep tool results small (page
  sizes, field filters), and do heavy work in the browser: Apple Health `export.zip` backfill and report maths.
- **Glucose:** cron poller on the unofficial LibreLinkUp API; LibreView CSV for backfill and as the fallback.
- **Sleep and exercise:** Apple Watch via Apple Health; a Shortcuts automation posts new samples.

## Ready to Implement

Implement in this order, on `main`.

| # | Plan | Depends on | Needs from the owner |
| - | ---- | ---------- | -------------------- |
| 14 | [Glucose ingest](pending/14-glucose-ingest.md) | 7 | LibreLinkUp follower account, secrets, `OWNER_USER_ID`; first live run decides LibreLinkUp vs the HA fallback |
| 6 | [Full export / import](pending/06-full-export-import.md) | — | Push (GitHub Pages), export a file from the installed app |
| 8 | [Server storage](pending/08-server-storage.md) | 6, 7 | Import the file; later retire GitHub Pages and rename the repo |
| 16 | [Medicine log](pending/16-medicine-log.md) | 8 | Set up medicines, convert `meds` notes |

## Not Ready

| # | Plan | Description | Blocked on |
| - | ---- | ----------- | ---------- |
| 17 | Glucose CSV backfill | LibreView CSV export parsed in the browser (Settings), posted in batches as `source 'csv'` readings; history from before plan 14 | 8; a sample export to pin down the columns and date format |
| 9 | Raw entries + ingest | `raw_entries` table and inbox UI; `POST /api/ingest/text` with per-source bearer tokens; Siri Shortcut (dictate → POST) documented | 8 |
| 10 | Parse agent | Background parse of raw entries into proposals (food entries; medicine doses through plan 16's API); model config; proposals record their model | 9, 16; default model picked by testing real entries |
| 11 | Food tools + approval | Recent/approved foods, USDA FDC and Open Food Facts as agent tools; approve / correct proposals in the Food UI; approved items become reusable foods | 10 |
| 12 | Kitchen voice | HA custom sentences + `rest_command` posting raw text to plan 9's route; docs for the HA side | 9; family-mail dash-10 phase 1 live |
| 13 | Health ingest | Shortcuts automation → sample ingest route; `export.zip` backfill parsed in the browser | 8; confirm Shortcuts can read the sample types needed |
| 15 | Reports | Daily timeline overlay, per-meal glucose response, sleep / exercise correlations, medicine timing | 11, 13, 14, 16, 17 |

## Decisions (owner, 2026-11-24)

- **Offline:** nice to have, not required. Online-only first.
- **Medicine:** structured entries (plan 16), not tagged notes.
- **Repo:** renamed to `tracker` (owner renames the GitHub repo and the local folder; `pwa/package.json`'s name,
  the README and the GitHub Pages base path follow).
- **Free plan only**, as in family-mail: no paid Workers features.
- **Order:** 7, then 14 so glucose collects early, then 6 and 8, then the rest in table order.
- **Deploys:** Workers Builds from `main` (as family-mail). Claude commits; the owner pushes and holds the Cloudflare
  credentials.
- **Sessions:** 30 days idle, 30 days at most (the IdP re-signs in silently while its own session lasts).
- **Glucose fallback:** if LibreView blocks the Worker, Home Assistant polls LibreLinkUp and pushes readings here.
- **Medicine notes** use the tag `meds`.
- **Repo rename** happens after plan 8's migration, not before (it moves the GitHub Pages path).

## Completed

| # | Plan | Status |
| - | ---- | ------ |
| 1 | [pwa-scaffold.md](implemented/01-pwa-scaffold.md) | ✅ Done |
| 2 | [note-model-and-storage.md](implemented/02-note-model-and-storage.md) | ✅ Done |
| 3 | [app-shell-and-routing.md](implemented/03-app-shell-and-routing.md) | ✅ Done |
| 4 | [home-note-entry.md](implemented/04-home-note-entry.md) | ✅ Done |
| 5 | [list-and-tag-filter-and-editor.md](implemented/05-list-and-tag-filter-and-editor.md) | ✅ Done |
| 7 | [Worker, D1, sign-in, deploy](implemented/07-worker-d1-sign-in-deploy.md) | ✅ Done (code); owner setup and live checks pending |

The food log (Food, Food History, targets in Settings, editing an entry, serving size, the Refresh app button) was
built without a plan and is on `main` (PRs #2–#5, and the `claude/gifted-pasteur-ok1yl7` merge on 2026-11-24).

---

## Current PWA architecture (plans 1–5)

### Project layout

All app code lives under `pwa/` at the repo root (sibling to `.claude/`,
`.devcontainer/`, etc.), matching the structure referenced in
`.claude/skills/solidjs/solidjs-pwa-notes.md`. That doc's package versions,
tsconfig caveats, and PWA asset notes apply — but its file *paths* point at a
different repo (`iot-garden`) and must not be reused literally.

```
pwa/
  src/
    App.tsx
    index.tsx
    routes/
      Home.tsx
      List.tsx
      NoteEditor.tsx     # plan 5: view/edit a single existing note
    components/
      BottomNav.tsx
      NoteTextEditor.tsx # plan 4: shared textarea + parsed-preview, used by Home and NoteEditor
    lib/
      notes/
        parse.ts        # plan 2
        types.ts         # plan 2
        store.ts          # plan 2 (storage interface + IndexedDB impl)
    notes.css (or per-component CSS modules, per scaffold conventions)
```

### Shared data contracts (plan 2 owns these, plans 3-5 consume them)

```ts
// pwa/src/lib/notes/types.ts

export interface ParsedNote {
  title: string;
  body: string;        // full text minus the trailing tag line, trimmed
  tags: string[];       // lowercased, trimmed, de-duplicated; [] if none
}

export interface Note extends ParsedNote {
  id: string;           // generated, e.g. crypto.randomUUID()
  rawText: string;       // exactly what the user typed, unmodified
  createdAt: string;     // ISO 8601
  updatedAt: string;     // ISO 8601
}

export interface NoteStore {
  list(): Promise<Note[]>;
  get(id: string): Promise<Note | undefined>;
  create(rawText: string): Promise<Note>;
  update(id: string, rawText: string): Promise<Note>;
  remove(id: string): Promise<void>;
  listTags(): Promise<string[]>;          // distinct tags across all notes, sorted
  listByTag(tag: string): Promise<Note[]>;
}
```

### Note text format (plan 2 implements parsing of this)

```text
some title

body of note

potential multi-lines, etc.

:tag 1, tag 2, tag-three
```

- First non-empty line is the title.
- Everything after the title, up to (but not including) an optional trailing
  tag line, is the body.
- The tag line is optional. It is identified as the **last line** of the text
  if and only if that line starts with `:`. If present, the rest of that line
  is split on commas to produce tags (trimmed, lowercased).
- If the last line does not start with `:`, there are no tags and the entire
  remainder (after the title) is the body.
- `rawText` always stores the original input verbatim, regardless of parsing.

### Routing

- `/` — Home (new note entry).
- `/notes` — List (browse + filter by tag).
- `/notes/:id` — NoteEditor (view/edit an existing note, reached by tapping a
  note in the list).

### Cross-plan naming notes

- "Home" route = **new** note entry (single textarea + save, always starts
  blank). "List" route = browse notes with tag filtering. "NoteEditor" route
  = open an existing note (by id) for viewing/editing. Do not introduce
  alternate names for these without updating this index.
- Home and NoteEditor share a `NoteTextEditor` component (plan 4) that wraps
  the textarea + parsed title/tag preview + save action. Home uses it in
  "create" mode (empty initial text, calls `store.create`); NoteEditor uses
  it in "edit" mode (pre-filled with `note.rawText`, calls `store.update`).
- `NoteStore` is the only storage abstraction the UI talks to. UI code must
  not call `indexedDB` directly — this keeps storage swappable per the
  original requirements.
- Bottom navigation component is `BottomNav` — plan 3 owns it, plans 4/5 just
  render inside the route outlet it wraps. NoteEditor (`/notes/:id`) is
  reached via navigation from List, not via a tab — but still renders within
  the same shell/outlet so the bottom nav stays visible.
