# Plan 4: Home Route — Note Entry + Shared Note Editor Component

## Checklist

- [x] Build `NoteTextEditor` shared component (textarea + parsed preview + save)
- [x] Implement `Home` route using `NoteTextEditor` in "create" mode
- [x] Wire `NoteTextEditor` to `NoteStore` from plan 2
- [x] Verify build, lint, typecheck pass and manual create flow works

## Context

Depends on **plan 2** (`NoteStore`, `parseNoteText`, types) and **plan 3**
(routing shell, `Home` placeholder to replace). Plan 5 (List + NoteEditor)
depends on this plan's `NoteTextEditor` component — make sure its props
contract (below) is stable before plan 5 starts, or coordinate if both are
in flight.

## NoteTextEditor component

`pwa/src/components/NoteTextEditor.tsx`

A reusable component used by both `Home` (create mode) and `NoteEditor`
(edit mode, plan 5).

### Props

```ts
interface NoteTextEditorProps {
  initialText: string;       // "" for new notes, note.rawText for editing
  onSave: (rawText: string) => Promise<void>;
  onDelete?: () => Promise<void>;  // present only in edit mode (plan 5)
  saveLabel?: string;         // e.g. "Save" vs "Save Changes" — optional
}
```

### Behavior

- A single `<textarea>` bound to the current text, large enough to be the
  primary content of the screen (e.g. `flex: 1`, full width, comfortable
  padding, monospace or normal font — agent's choice, prioritize
  readability).
- Below or above the textarea, render a live preview derived from
  `parseNoteText(text())`:
  - Show the extracted **title** (or a placeholder like "Untitled" if empty)
  - Show extracted **tags** as small pill/chip elements (or "no tags" if
    empty)
  - This preview updates reactively as the user types (use a Solid
    `createMemo` over the textarea's signal).
- A **Save** button:
  - Disabled when the parsed title is empty (no point saving a blank note) —
    or, if simpler and acceptable, disabled when `text().trim() === ""`.
  - Calls `props.onSave(text())` and awaits it.
  - On success in **create mode** (Home), clear the textarea so the user can
    immediately start a new note.
  - On success in **edit mode** (NoteEditor, plan 5), no need to clear —
    `onSave` resolving is sufficient (plan 5 decides what happens next, e.g.
    navigate back to the list).
- If `props.onDelete` is provided, render a **Delete** button/action (styling
  can be visually distinct, e.g. a destructive color) that calls
  `props.onDelete()` when activated. Home does not pass `onDelete`.

### Styling notes

- Mobile-first: this is a PWA primarily used on phones. The textarea should
  take up most of the vertical space above the bottom nav.
- Keep styling approach consistent with whatever plan 1/3 established (CSS
  modules, plain CSS files, etc.) — check `pwa/src/` for the established
  pattern before introducing a new one.

## Home route

`pwa/src/routes/Home.tsx`

- Get a `NoteStore` instance. Plan 2 doesn't specify *where* the singleton
  store instance lives — if it doesn't already exist, create
  `pwa/src/lib/notes/store-instance.ts` exporting a single shared
  `createIndexedDbNoteStore()` instance for the whole app to import. (Plan 5
  will reuse this same instance — check for it before creating a duplicate.)
- Render `<NoteTextEditor initialText="" onSave={...} />` where `onSave`
  calls `store.create(rawText)`.
- After a successful save, in addition to `NoteTextEditor` clearing its own
  textarea, consider a brief visual confirmation (e.g. a transient "Saved"
  message) — optional polish, not required for the plan to be complete.

## Verification

From `pwa/`:

1. `npm run build`
2. `npm run lint`
3. `npx tsc --noEmit`
4. `npm run dev` — manually confirm (via the `run` skill / browser):
   - Typing a note in the format below shows "My Title" as the parsed title
     and `["work", "idea"]` as tags in the live preview:
     ```
     My Title

     Some body text here.

     :work, idea
     ```
   - Pressing Save clears the textarea
   - Reloading the page and checking IndexedDB (via browser devtools
     Application tab) shows the note persisted with correct `title`, `body`,
     `tags`, `rawText`, `createdAt`, `updatedAt`, and a generated `id`
