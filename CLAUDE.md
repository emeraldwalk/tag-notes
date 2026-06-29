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
