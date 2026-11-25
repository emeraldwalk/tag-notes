# Tracker

A personal tracker for notes, food, medicine and the health data behind blood sugar highs. It started as Tag Notes, a
notes PWA, and is moving to `https://tracker.ingles.place`, a Cloudflare Worker with D1 behind the family IdP. Plans
and decisions: [`.plans/plan.md`](.plans/plan.md).

**Live app (until plan 8 moves it):** https://emeraldwalk.github.io/tag-notes/

## Layout

npm workspaces, one `package-lock.json` at the root:

| Path | What it is |
| --- | --- |
| `pwa/` | `tracker-pwa`: the SolidJS PWA. Data in the browser (IndexedDB) until plan 8. |
| `worker/` | `tracker-worker`: the Worker `tracker` at `tracker.ingles.place`, with D1 `tracker` and IdP sign-in. |

## Development

```sh
npm install            # at the root
npm start -w tracker-pwa
npm run dev -w tracker-worker
npm run check          # every workspace: lint, types, build, tests
```

After changing `worker/wrangler.jsonc`, run `npx wrangler types` from `worker/` and commit
`worker-configuration.d.ts`.

`node_modules` may be shared between a Mac and a Linux devcontainer; an install on one replaces the other's platform
binaries (for example `@rollup/rollup-linux-x64-gnu`). Run `npm install` on the side you're working on.

## Deploying

### PWA (GitHub Pages, until plan 8)

Pushes are built and deployed by [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml): `main` to the site
root, every other branch to a shared `/preview/` path.

### Worker (`tracker.ingles.place`)

Claude commits; the owner pushes and holds the Cloudflare credentials. Cloudflare Workers Builds deploys `main`:

| Workers Builds project | Root directory | Build command | Deploy command |
| --- | --- | --- | --- |
| `tracker` | repo root | `npm run build -w tracker-worker` | `npm run deploy -w tracker-worker` |

The deploy applies D1 migrations (`worker/migrations/`) first, and stamps the commit being built
(`WORKERS_CI_COMMIT_SHA`) into the page footer. Non-production branch builds stay off.

One-time setup (owner):

1. **IdP:** in the console at `https://auth.emeraldwalk.com`, register an app "Tracker" with redirect URI
   `https://tracker.ingles.place/auth/callback` and post-logout redirect URI `https://tracker.ingles.place/`. Give
   your own account access; who can sign in is set there, not in the Worker. Keep the client id and secret.
2. **Database:** from `worker/`, `npx wrangler d1 create tracker`. Put the id it prints into `worker/wrangler.jsonc`
   in place of the all-zero placeholder, and commit.
3. **Secrets:** from `worker/`, `npx wrangler secret put` each of `IDP_CLIENT_ID`, `IDP_CLIENT_SECRET` and
   `COOKIE_SECRET` (`openssl rand -base64 32`). If the Worker doesn't exist yet, accept the offer to create it.
4. **Workers Builds:** a project `tracker` connected to this GitHub repo, with the settings in the table above and
   production branch `main`.
5. Push `main`.

### Glucose (plan 14)

The Worker polls LibreLinkUp, the unofficial follower API behind Abbott's LibreLinkUp app, every 5 minutes. It signs
in as a **follower account**, caches the token (about 180 days), and stores the latest reading plus the last ~12 hours
of 15-minute points in `glucose_readings`. The home page shows the last reading and how the last run went. After a
rate limit it pauses (`Retry-After`, else 30 minutes); after a refused sign-in it pauses an hour, so a wrong password
can't lock the account.

Setup (owner):

1. **Follower account:** a separate LibreView account with a different email. In the Libre 3 app: Share → Connected
   apps → LibreLinkUp → invite that email. Accept in the LibreLinkUp app once, and accept its terms there.
2. **`OWNER_USER_ID`** in `worker/wrangler.jsonc`: your user id from the home page. Readings are stored for it.
   `LLU_REGION` is `us`; a wrong region is followed automatically.
3. From `worker/`: `npx wrangler secret put` each of `LLU_EMAIL`, `LLU_PASSWORD` (the follower account) and
   `HA_INGEST_TOKEN` (`openssl rand -base64 32`; Home Assistant's token for `POST /api/ingest/glucose`, a different
   value from family-mail's secret of the same name).
4. Push. Within 10 minutes the home page should show a reading matching the Libre app.

If LibreView refuses the Worker (the page shows `http_403` or similar), switch to Home Assistant polling:
[`docs/home-assistant.md`](docs/home-assistant.md).

The cron uses one of the account's 5 free-plan cron triggers.

Sessions last 30 days without use and 30 days at most; signing in again is silent while the IdP session lasts.

To read CPU time per request (the free plan allows 10 ms), run in your own terminal while making requests:

```
npx wrangler tail tracker --format json | grep -oE '"(cpuTime|url)": *("[^"]*"|[0-9]+)'
```
