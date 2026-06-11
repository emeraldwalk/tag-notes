# Plan 3: App Shell, Routing, and Bottom Navigation

## Checklist

- [x] Add `@solidjs/router` dependency
- [x] Define routes: `/`, `/notes`, `/notes/:id`
- [x] Build `BottomNav` component (iOS-style tab bar)
- [x] Wire up `App.tsx` as the shell: router outlet + persistent `BottomNav`
- [x] Add placeholder route components (real content comes from plans 4 & 5)
- [x] Verify build, lint, typecheck pass and routes navigate correctly

## Context

Depends on **plan 1** (the `pwa/` scaffold must exist with a working Vite +
Solid build). Does not depend on plan 2 — this plan only sets up navigation
structure and placeholder screens; plans 4 and 5 fill in the real content
later using `NoteStore` from plan 2.

## Routes

| Path | Component | Owner plan |
| --- | --- | --- |
| `/` | `Home` | 4 (placeholder here) |
| `/notes` | `List` | 5 (placeholder here) |
| `/notes/:id` | `NoteEditor` | 5 (placeholder here) |

Use `@solidjs/router`'s `Router` / `Route` (hash or path routing — prefer
path routing with the SPA fallback that `vite-plugin-pwa`'s `generateSW`
already handles via its default navigateFallback; if path routing causes
issues with the dev server or PWA precache, hash routing is an acceptable
fallback — note which was chosen and why in a brief code comment only if
non-obvious).

## Files to create/modify

```
pwa/src/
  App.tsx                    # modify: becomes the shell
  routes/
    Home.tsx                 # placeholder: <div>Home</div>
    List.tsx                 # placeholder: <div>List</div>
    NoteEditor.tsx            # placeholder: <div>Note {params.id}</div>
  components/
    BottomNav.tsx
    BottomNav.module.css (or equivalent styling approach)
```

## BottomNav

An iOS-style bottom tab bar, fixed to the bottom of the viewport, safe-area
aware (`env(safe-area-inset-bottom)` padding for notched devices — relevant
since this is a PWA that may run standalone on iOS).

Two tabs for now:

- **Home** (`/`) — icon + label, e.g. "New" or "Home" with a pencil/plus icon
- **List** (`/notes`) — icon + label, e.g. "Notes" with a list icon

Use `@solidjs/router`'s `useLocation` (or `A` component's active-link
styling) to highlight the active tab. `/notes/:id` should highlight the
"List" tab as active (it's a child of that flow).

Icons: inline SVG is fine (no icon library dependency needed) — simple
geometric shapes are acceptable; this can be visually refined later.

## App.tsx

```tsx
// shape, not literal code:
<Router root={Shell}>
  <Route path="/" component={Home} />
  <Route path="/notes" component={List} />
  <Route path="/notes/:id" component={NoteEditor} />
</Router>
```

Where `Shell` renders `props.children` (the matched route) above
`<BottomNav />`, with layout that reserves space for the fixed bottom bar
(e.g. `padding-bottom` on the scrollable content area equal to the nav bar's
height).

## Placeholder route components

Each placeholder should render enough to confirm routing works:

- `Home.tsx`: `<div>Home (note entry — plan 4)</div>`
- `List.tsx`: `<div>List (notes + tags — plan 5)</div>`
- `NoteEditor.tsx`: read `:id` via `useParams()` and render
  `<div>Note editor for {params.id} (plan 5)</div>`

## Verification

From `pwa/`:

1. `npm install` (after adding `@solidjs/router`)
2. `npm run build`
3. `npm run lint`
4. `npx tsc --noEmit`
5. `npm run dev` — manually confirm (via the `run` skill / browser) that:
   - The bottom nav is visible and fixed at the bottom on a mobile viewport
     size
   - Tapping each tab navigates and updates the active-tab styling
   - Visiting `/notes/abc123` directly renders the NoteEditor placeholder
     with `id = "abc123"` and the List tab shows as active
