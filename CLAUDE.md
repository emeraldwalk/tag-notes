# CLAUDE.md

## Never suggest clearing site data / browser cache to "fix" stale PWA content

This app stores all user data (notes, food entries) in IndexedDB on the same
origin as the PWA's Cache Storage and service worker. Clearing "site data"
or "website data" in any browser **deletes the user's IndexedDB data**
along with the cache — it is not a safe debugging step.

If a deployed change isn't showing up:
- First verify the deploy itself: check the GitHub Actions run for the
  commit, and confirm the built JS bundle (e.g. via the hashed filename in
  `index.html` on the `gh-pages` branch) actually contains the expected
  code/strings. Don't assume it's a caching or service-worker issue
  without checking this first — it may just be a real bug in the change.
- If the deploy is confirmed correct and content still looks stale, treat
  service-worker/cache staleness as one hypothesis among several, not the
  default explanation. Use non-destructive update mechanisms only:
  Chrome DevTools → Application → Service Workers → "Update on reload" /
  "Update" button (re-checks for a new SW without clearing storage).
- Do not instruct a user to clear cache/site data/storage for this app
  unless they explicitly accept the data loss.

## Working in this repo (Tracker)

- Read `README.md`, then `.plans/plan.md`. Load the `plan-orchestrating` skill to implement a plan, and the `solidjs`
  skill for PWA work. Next plans, in order: 6, 8, 16.
- **No GitHub or Cloudflare access from the devcontainer.** `git fetch` and `git push` fail, so local `origin/main`
  can be behind what's really pushed; don't read "ahead N" as unpushed work without asking. Claude commits and stops;
  the owner pushes, sets Worker secrets (`npx wrangler secret put <NAME>` from `worker/`) and runs anything needing
  Cloudflare (`wrangler d1 execute --remote`, `wrangler tail`).
- **`node_modules` is shared with the owner's Mac.** Don't `npm install` in place. To build and test, use a clean copy
  in the scratchpad: `git checkout-index -a --prefix=<dir>/` (or rsync the working tree without `node_modules`), then
  `npm ci` and `npm run check` there. Copy back only files that belong in the repo (`package-lock.json`,
  `worker/worker-configuration.d.ts`).
- After changing `worker/wrangler.jsonc`, run `npx wrangler types` (in the clean copy) and commit
  `worker/worker-configuration.d.ts`.
- **Free plan:** 10 ms CPU per request and cron run. The glucose cron measures 4–9 ms. Heavy work goes in the browser.
- Never print secrets, the LibreLinkUp credentials or tokens. `OWNER_USER_ID` (an IdP subject id) is fine in the repo.
- The rule above about site data applies until plan 8 moves the data to D1; after that, data lives on the server.
