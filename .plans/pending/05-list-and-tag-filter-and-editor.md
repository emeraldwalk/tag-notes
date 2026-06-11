# Plan 5: List Route, Tag Filtering, and Note Editor

## Checklist

- [ ] Implement `List` route: note titles + tag filter UI
- [ ] Implement `NoteEditor` route: view/edit an existing note via `NoteTextEditor`
- [ ] Wire tapping a note in the list to navigate to `/notes/:id`
- [ ] Wire `NoteEditor` save/delete back to `NoteStore`, with navigation on completion
- [ ] Verify build, lint, typecheck pass and manual list/filter/edit/delete flow works

## Context

Depends on **plan 2** (`NoteStore`, `listTags`, `listByTag`, `list`, `get`,
`update`, `remove`), **plan 3** (routing — `/notes` and `/notes/:id`
placeholders to replace), and **plan 4** (`NoteTextEditor` component and the
shared store instance at `pwa/src/lib/notes/store-instance.ts`).

## List route

`pwa/src/routes/List.tsx`

### Tag filter UI

- On mount (and whenever notes change), load distinct tags via
  `store.listTags()`.
- Render the tags as a horizontally-scrollable row (or wrapping group) of
  toggleable chips/buttons near the top of the screen.
- Selecting a tag filters the list to `store.listByTag(tag)`. Selecting it
  again (toggle off) returns to `store.list()` (all notes).
- Only single-tag selection is required (matches "filter on tags" from the
  original requirements) — multi-select is not required, but if trivial to
  support cleanly, a simple "select one tag at a time" model is preferred
  over building multi-tag AND/OR logic. Keep it simple: one active filter or
  none.
- If there are no tags at all (no notes have tags yet), don't render an empty
  filter row — or render it in a way that's clearly inert (agent's
  discretion).

### Note list

- Below the filter row, render the (possibly filtered) notes as a vertical
  list.
- Each row shows at minimum: the note's **title** (or "Untitled" if empty)
  and a secondary line with `updatedAt` formatted as a readable date/time
  (e.g. `toLocaleString()` or similar — no need for a date library).
- Optionally show the note's tags as small chips on the row too (nice for
  scanning, not required).
- If the list is empty (no notes, or no notes match the selected tag filter),
  show an empty-state message (e.g. "No notes yet" / "No notes with this
  tag").
- Each row is tappable and navigates to `/notes/:id` using that note's `id`
  (use `@solidjs/router`'s `useNavigate` or an `A` link).

### Reactivity

- The list should refresh when notes are created/updated/deleted elsewhere
  (e.g. user creates a note on Home, then switches to List). Since
  `NoteStore` is plain async/IndexedDB with no built-in reactivity, the
  simplest correct approach is to re-fetch (`store.list()` /
  `store.listTags()` / `store.listByTag()`) whenever the List route becomes
  visible — e.g. in `onMount` and also via `@solidjs/router`'s navigation
  lifecycle (re-run on each navigation *to* this route). A full
  app-wide reactive store is not required; re-fetching on navigation is
  sufficient and simpler.

## NoteEditor route

`pwa/src/routes/NoteEditor.tsx`

- Read `:id` from `useParams()`.
- On mount, `await store.get(id)`.
  - If found: render `<NoteTextEditor initialText={note.rawText} onSave={...} onDelete={...} />`.
  - If not found (e.g. bad id, deleted note): show a "Note not found" message
    with a way back to the list (e.g. an `A` link to `/notes`).
- `onSave`: calls `store.update(id, rawText)`. After it resolves, navigate
  back to `/notes` (use `useNavigate()`).
- `onDelete`: calls `store.remove(id)`. After it resolves, navigate back to
  `/notes`.
- Consider a simple confirmation step before delete (e.g.
  `window.confirm("Delete this note?")` is acceptable for a v1 — no need to
  build a custom modal).

## Verification

From `pwa/`:

1. `npm run build`
2. `npm run lint`
3. `npx tsc --noEmit`
4. `npm run dev` — manually confirm (via the `run` skill / browser):
   - Create 2-3 notes from Home with different/overlapping tags
   - Navigate to `/notes` — all notes appear, sorted most-recently-updated
     first, with correct titles and timestamps
   - Tag chips appear for tags used across those notes; selecting a tag
     filters the list to only matching notes; deselecting shows all again
   - Tapping a note navigates to `/notes/:id` and shows its full `rawText` in
     the editor, with the same live title/tag preview as Home
   - Editing the text and saving updates the note (verify `updatedAt`
     changes and `createdAt` does not) and returns to the list, reflecting
     the new title/order
   - Deleting a note removes it from the list and from IndexedDB
   - Visiting `/notes/some-bad-id` shows a "not found" state with a way back
     to the list
