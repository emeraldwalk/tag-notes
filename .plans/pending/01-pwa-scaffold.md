# Plan 1: PWA Scaffold

## Checklist

- [ ] Create `pwa/` Vite + SolidJS + TypeScript project (no SolidStart)
- [ ] Configure `vite-plugin-pwa` with a static manifest
- [ ] Fix tsconfig (DOM only, no WebWorker conflict)
- [ ] Add lint config (oxlint) with `dist/`/`dev-dist/` ignored
- [ ] Add placeholder logo + generate PWA icon assets
- [ ] Update `index.html` with iOS PWA meta tags and correct icon paths
- [ ] Verify build, lint, and typecheck all pass
- [ ] Update root `.gitignore` for `pwa/` build artifacts

## Context

This is the foundational scaffold. Other plans build UI inside `pwa/src/`.
Read `.claude/skills/solidjs/solidjs-pwa-notes.md` for hard-won details —
package names, tsconfig pitfalls, PWA asset generator output — but note its
file *paths* reference a different repo (`iot-garden`). Apply the
*learnings*, not the literal paths.

## What to build

### Directory

Create `pwa/` at the repo root:

```
pwa/
  index.html
  package.json
  tsconfig.json
  vite.config.ts
  .oxlintrc.json
  public/
    manifest.webmanifest
    logo.svg
    (generated icons)
  src/
    index.tsx
    App.tsx
    index.css (or App.css — minimal global styles/reset)
```

### package.json

Use the versions confirmed in the skill notes as a starting point (verify
current availability on npm and adjust if a version is yanked):

- `solid-js`: `^1.9.x`
- `vite`: `^6.x`
- `vite-plugin-solid`: `^2.11.x`
- `vite-plugin-pwa`: `^0.21.x`
- `@vite-pwa/assets-generator`: `^0.2.x` (devDependency)
- `typescript`: `^5.8.x`
- `oxlint`: `^0.16.x` (devDependency)

Scripts needed:

- `dev` — `vite`
- `build` — `tsc -b && vite build` (or equivalent typecheck-then-build)
- `preview` — `vite preview`
- `lint` — `oxlint .`
- `generate-pwa-assets` — runs `@vite-pwa/assets-generator` against
  `public/logo.svg` with the `minimal-2023` preset

### vite.config.ts

- Import `solid` from `vite-plugin-solid`.
- Configure `VitePWA` with `registerType: 'autoUpdate'`, `manifest: false`
  (manifest served as a static file from `public/`), `devOptions: { enabled:
  true }`.
- Use bracket-notation env access (`process.env['NODE_ENV']`) anywhere
  `process.env.X` would trigger a strict-mode `possibly undefined` error.

### tsconfig.json

- `"lib": ["ESNext", "DOM"]` — do **not** add `"WebWorker"` (causes TS6200
  conflicts) and do **not** add `skipLibCheck` to work around it.
- Enable `strict: true`.
- This scaffold has no custom service worker, so no `tsconfig.sw.json` is
  needed.

### .oxlintrc.json

- Include `"typescript"` in plugins.
- Set `"ignorePatterns": ["dist/", "dev-dist/"]`.

### public/manifest.webmanifest

A static PWA manifest for an app named "Tag Notes" (or similar — pick a
short `name`/`short_name`, e.g. `name: "Tag Notes"`, `short_name: "Notes"`).
Include `display: "standalone"`, a reasonable `theme_color`/`background_color`
(pick any cohesive light color; later plans are not blocked on the exact
value), and icon entries pointing at the generated PWA icons (192/512/
maskable).

### public/logo.svg

Create a simple placeholder logo (e.g. a colored circle or a simple "tag"
icon shape) — this is the source for the icon generator.

### Icon generation

Run `npm run generate-pwa-assets` to produce:

- `pwa-64x64.png`
- `pwa-192x192.png`
- `pwa-512x512.png`
- `maskable-icon-512x512.png`
- `apple-touch-icon-180x180.png`
- `favicon.ico`

### index.html

- Standard Vite + Solid entry (`<div id="root">`, script tag for
  `src/index.tsx`).
- Add iOS PWA meta tags: `apple-mobile-web-app-capable`,
  `apple-mobile-web-app-status-bar-style`,
  `apple-mobile-web-app-title`, `theme-color`.
- `<link rel="apple-touch-icon" href="/apple-touch-icon-180x180.png">` —
  must match the generated filename exactly.
- `<link rel="manifest" href="/manifest.webmanifest">`.
- `<link rel="icon" href="/favicon.ico">`.

### src/index.tsx and src/App.tsx

Minimal: `index.tsx` renders `<App />` into `#root` via `solid-js/web`'s
`render`. `App.tsx` can be a placeholder (`<div>Tag Notes</div>`) — plan 3
replaces its contents with the real shell/router.

## Verification

From `pwa/`:

1. `npm install`
2. `npm run build` — must succeed with no errors
3. `npm run lint` — zero errors
4. `npx tsc --noEmit` — zero errors
5. `npm run dev` and confirm the page loads in a browser (use the `run` skill
   if available)

## .gitignore

Append to the **root** `.gitignore` (not a new `pwa/.gitignore`):

```
pwa/node_modules/
pwa/dist/
pwa/dev-dist/
pwa/.vite/
```
