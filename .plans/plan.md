# Tag Notes — Plan Index

A SolidJS PWA (no SolidStart) for capturing freeform text notes with embedded
title/tags, stored in IndexedDB, with an iOS-style bottom tab bar for
navigating between a note-entry "Home" route and a tag-filterable "List"
route. Notes can also be opened from the list and edited in place.

See [Architecture overview](#architecture-overview) below for the shared
contracts every sub-plan depends on.

## Ready to Implement

| # | Plan | Depends on |
| - | ---- | ---------- |
| 5 | [list-and-tag-filter-and-editor.md](pending/05-list-and-tag-filter-and-editor.md) | 2, 3, 4 |

## Not Ready (blocked on dependencies above)

| # | Plan | Depends on |
| - | ---- | ---------- |

## Completed

| # | Plan | Status |
| - | ---- | ------ |
| 1 | [pwa-scaffold.md](implemented/01-pwa-scaffold.md) | ✅ Done |
| 2 | [note-model-and-storage.md](implemented/02-note-model-and-storage.md) | ✅ Done |
| 3 | [app-shell-and-routing.md](implemented/03-app-shell-and-routing.md) | ✅ Done |
| 4 | [home-note-entry.md](implemented/04-home-note-entry.md) | ✅ Done |

---

## Architecture overview

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
