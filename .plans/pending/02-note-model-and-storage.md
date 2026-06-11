# Plan 2: Note Model, Parsing, and Storage

## Checklist

- [ ] Define shared `Note`/`ParsedNote`/`NoteStore` types
- [ ] Implement text parser (title/body/tags extraction)
- [ ] Implement `NoteStore` backed by IndexedDB
- [ ] Write unit tests for the parser (edge cases below)
- [ ] Write unit tests for the store (CRUD + tag indexing)

## Context

This plan has **no dependency on plan 1** beyond living inside `pwa/src/`.
If plan 1 hasn't landed yet, create the files under `pwa/src/lib/notes/`
anyway — they're plain TypeScript with no Solid/Vite-specific imports except
a test runner. If `pwa/` doesn't exist yet when this plan starts, coordinate
with plan 1's structure (same `pwa/` root, `src/lib/notes/` subpath) rather
than creating a separate package.

This module is the foundation every UI plan (3-5) builds on. Get the types
and `NoteStore` interface exactly right — they are the contract.

## Files to create

```
pwa/src/lib/notes/
  types.ts
  parse.ts
  parse.test.ts
  store.ts
  store.test.ts
```

Use whatever test runner is configured for `pwa/` (Vitest is the natural
choice alongside Vite — add it as a devDependency and a `test` script in
`pwa/package.json` if not already present; coordinate with plan 1's
`package.json` rather than creating a conflicting one).

## types.ts

```ts
export interface ParsedNote {
  title: string;
  body: string;
  tags: string[];
}

export interface Note extends ParsedNote {
  id: string;
  rawText: string;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

export interface NoteStore {
  list(): Promise<Note[]>;
  get(id: string): Promise<Note | undefined>;
  create(rawText: string): Promise<Note>;
  update(id: string, rawText: string): Promise<Note>;
  remove(id: string): Promise<void>;
  listTags(): Promise<string[]>;
  listByTag(tag: string): Promise<Note[]>;
}
```

## parse.ts

Export `parseNoteText(rawText: string): ParsedNote`.

### Format

```text
some title

body of note

potential multi-lines, etc.

:tag 1, tag 2, tag-three
```

### Rules

1. Split `rawText` into lines.
2. **Title**: the first non-empty (non-whitespace-only) line, trimmed. If
   every line is empty/whitespace, `title` is `""`.
3. **Tag line detection**: look at the *last* line of `rawText` (after
   splitting on `\n`, before any trimming of the overall text — but the line
   itself is checked after trimming leading/trailing whitespace from that
   line). If that trimmed last line starts with `:`, it is the tag line.
   - Tags are everything after the leading `:`, split on `,`, each entry
     trimmed and lowercased, empty entries discarded, duplicates removed
     (preserve first-seen order).
   - Example: `:tag 1, tag 2, tag-three` → `["tag 1", "tag 2", "tag-three"]`
     (note: spaces within a tag are preserved — only the comma-delimited
     segments are trimmed of *surrounding* whitespace, not internal spaces).
4. **Body**: everything between the title line and the tag line (if any),
   trimmed of leading/trailing blank lines/whitespace as a whole block, but
   internal blank lines/formatting preserved. If there's no tag line, body is
   everything after the title line, trimmed the same way. If there's no
   content after the title (with or without a tag line), `body` is `""`.

### Edge cases to handle (write tests for each)

- Empty string input → `{ title: "", body: "", tags: [] }`.
- Only a title, no body, no tags.
- Title + body, no tag line.
- Title + body + tag line.
- Title + tag line only (no body) — body should be `""`, not whitespace.
- A line starting with `:` that is *not* the last line — must NOT be treated
  as a tag line (it's just body content).
- Last line is exactly `:` (colon, nothing else) → tags is `[]` (empty
  segments discarded), and that line is still stripped from the body.
- Tag line with extra whitespace around commas: `: a ,  b ,c` → `["a", "b",
  "c"]`.
- Duplicate tags: `:foo, foo, FOO` → `["foo"]` (case-insensitive dedup,
  lowercased).
- Trailing newline(s) after the tag line, or trailing blank lines before a
  tag line — parser should be robust to both.

## store.ts

Export a factory, e.g. `createIndexedDbNoteStore(): NoteStore` (or a class —
agent's choice), implementing `NoteStore` from `types.ts` using the browser
`indexedDB` API directly (no extra dependency needed — `idb` is fine too if
it simplifies things, but keep it small).

### Database design

- One database (e.g. `tag-notes`), one object store `notes`, keyed by `id`.
- Store the full `Note` object as the record value.
- Create an index on a `tags` field for `listByTag` — but `tags: string[]`
  can't be indexed directly as a multiEntry value unless the index is created
  with `{ multiEntry: true }`. Use a `multiEntry` index on `tags` so each tag
  string in the array gets its own index entry pointing at the note.
- `listTags()` can either maintain a separate tag-count structure or simply
  iterate all notes and collect distinct tags — for expected note volumes
  (personal notes app), a full scan via `list()` + `Set` dedup is acceptable
  and simpler. Prefer simplicity unless it's trivial to do better with the
  multiEntry index (e.g. `IDBObjectStore.index('tags').openKeyCursor()` with
  dedup).

### Method behaviors

- `create(rawText)`: parse `rawText`, generate `id` via `crypto.randomUUID()`,
  set `createdAt` and `updatedAt` to `new Date().toISOString()`, persist, and
  return the resulting `Note`.
- `update(id, rawText)`: re-parse `rawText`, look up the existing note (throw
  or reject if not found — agent's choice on exact error type, but document
  it), preserve `id` and `createdAt`, set `updatedAt` to now, persist, return
  the updated `Note`.
- `remove(id)`: delete the record. No error if it doesn't exist.
- `list()`: return all notes, sorted by `updatedAt` descending (most recently
  updated first) — this ordering matters for plan 5's list view.
- `get(id)`: return the note or `undefined`.
- `listTags()`: distinct tags across all notes, sorted alphabetically.
- `listByTag(tag)`: notes containing `tag` (exact match against the
  lowercased tag), sorted by `updatedAt` descending.

### Testing IndexedDB in Node/Vitest

`indexedDB` is not available in plain Node. Use `fake-indexeddb` (add as a
devDependency) and import its auto-setup
(`import 'fake-indexeddb/auto'`) at the top of `store.test.ts`, or configure
it in a Vitest setup file. Confirm whichever approach is chosen actually runs
via `npm test`.

## Verification

- `npm test` (or equivalent) passes for both `parse.test.ts` and
  `store.test.ts`.
- `npx tsc --noEmit` passes (or whatever the project-wide check is from plan
  1, once both plans have landed).
