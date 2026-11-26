# Tracker

A personal tracker for notes, food, medicine and the health data behind blood sugar highs. It started as Tag Notes, a
notes PWA, and now runs at `https://tracker.ingles.place`: a Cloudflare Worker that serves the PWA and its API, with
the data in D1, behind the family IdP. Plans and decisions: [`.plans/plan.md`](.plans/plan.md).

**Live app:** https://tracker.ingles.place. The old GitHub Pages app (https://emeraldwalk.github.io/tag-notes/, data
in the browser) stays up, frozen at plan 6's build, until its data has been exported and imported here (plan 8's
owner steps).

## Layout

npm workspaces, one `package-lock.json` at the root:

| Path | What it is |
| --- | --- |
| `pwa/` | `tracker-pwa`: the SolidJS PWA. Online only: every read and save goes to the Worker's `/api`. |
| `worker/` | `tracker-worker`: the Worker `tracker` at `tracker.ingles.place`, with D1 `tracker` and IdP sign-in. It serves the built PWA (`pwa/dist`) behind sign-in. |

`pwa/src/lib/notes/parse.ts` and `pwa/src/lib/export.ts` are shared: the Worker imports them to parse notes and
validate imports (and medicine/dose bodies), so they must stay free of browser APIs. So are the type files they
import (`notes/types.ts`, `foods/types.ts`, `meds/types.ts`).

## Development

```sh
npm install            # at the root
npm start -w tracker-pwa
npm run dev -w tracker-worker
npm run check          # every workspace: lint, types, build, tests
```

After changing `worker/wrangler.jsonc`, run `npx wrangler types` from `worker/` and commit
`worker-configuration.d.ts`.

The Worker's build (`npm run build -w tracker-worker`) builds the PWA first, with base `/`. The Worker tests need
`pwa/dist` to exist (the assets directory), which `npm run check` builds first. `npm start -w tracker-pwa` serves the
UI alone; without the Worker behind it, every API call fails (sign-in only works at `tracker.ingles.place`).

`node_modules` may be shared between a Mac and a Linux devcontainer; an install on one replaces the other's platform
binaries (for example `@rollup/rollup-linux-x64-gnu`). That's fine: run `npm install` on the side you're working on.

## Deploying

### Old app (GitHub Pages, until retired)

[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) rebuilds plan 6's commit (`bca422c`, the last
IndexedDB build, with Export All) on every push to `main`, so the old app keeps working until its data is moved.
It is deleted when GitHub Pages is retired.

### Worker (`tracker.ingles.place`)

Claude commits; the owner pushes and holds the Cloudflare credentials. Cloudflare Workers Builds deploys `main`:

| Workers Builds project | Root directory | Build command | Deploy command |
| --- | --- | --- | --- |
| `tracker` | repo root | `npm run build -w tracker-worker` | `npm run deploy -w tracker-worker` |

The deploy builds the PWA, applies D1 migrations (`worker/migrations/`), and stamps the commit being built
(`WORKERS_CI_COMMIT_SHA`) into `/api/me` (shown in Settings → Account). Non-production branch builds stay off.

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
of 15-minute points in `glucose_readings`. Settings → Glucose shows the last reading and how the last run went. After a
rate limit it pauses (`Retry-After`, else 30 minutes); after a refused sign-in it pauses an hour, so a wrong password
can't lock the account.

Setup (owner):

1. **Follower account:** a separate LibreView account with a different email. In the Libre 3 app: Share → Connected
   apps → LibreLinkUp → invite that email. Accept in the LibreLinkUp app once, and accept its terms there.
2. **`OWNER_USER_ID`** in `worker/wrangler.jsonc`: your user id from Settings → Account. Readings are stored for it.
   `LLU_REGION` is `us`; a wrong region is followed automatically.
3. From `worker/`: `npx wrangler secret put` each of `LLU_EMAIL`, `LLU_PASSWORD` (the follower account) and
   `HA_INGEST_TOKEN` (`openssl rand -base64 32`; Home Assistant's token for `POST /api/ingest/glucose`, a different
   value from family-mail's secret of the same name).
4. Push. Within 10 minutes Settings → Glucose should show a reading matching the Libre app.

If LibreView refuses the Worker (the page shows `http_403` or similar), switch to Home Assistant polling:
[`docs/home-assistant.md`](docs/home-assistant.md).

The cron uses one of the account's 5 free-plan cron triggers. Measured CPU per run (2026-11-25): 4–9 ms of the 10 ms allowed.

**History (plan 17):** on libreview.com (the patient's account, not the follower), **Download Glucose Data** gives a
CSV of everything LibreView has. Keep it in `data/` (gitignored: it has your name and health data). Settings → Glucose
→ **Import LibreView CSV…** parses it on the phone, in the phone's time zone, shows what it found, and posts it in
chunks of 500 to `POST /api/glucose/import` as `source 'csv'`. Re-importing is safe: stored readings are skipped.
Only historic (5-minute) and scan readings are used; a scan at the same minute as a historic reading is dropped, since
the table keeps one reading per source and time. The 1 AM hour on the fall-back night appears twice in the file, and
which of each pair is the earlier hour is a guess.

### Capture (plan 9)

Anything said or typed to Tracker is kept word for word in the **Inbox** (the first tab) before anything interprets
it. Each capture source posts with its own token, made in Settings → Capture sources. A token is shown once, only its
hash is stored, and revoking it stops it working. Entries show the source's name.

```
POST https://tracker.ingles.place/api/ingest/text
Authorization: Bearer trk_…
Content-Type: application/json

{ "text": "I had two eggs and toast", "occurredAt": "2026-11-25T08:30:00-06:00" }
```

`occurredAt` is optional (default: when the Worker gets it). The answer is `201 { "id": …, "saved": "Saved: …" }`;
`401` means a missing, unknown or revoked token.

**Siri Shortcut (iPhone and Apple Watch).** In Shortcuts, a new shortcut named **Tracker** (so "Hey Siri, Tracker"
runs it), with these actions:

1. **Dictate Text**: Stop Listening *After Pause*.
2. **Get Contents of URL**: URL `https://tracker.ingles.place/api/ingest/text`; Method **POST**; Headers:
   `Authorization` = `Bearer trk_…` (the token from Settings, after the word Bearer and a space); Request Body
   **JSON** with one field, `text` (Text) = *Dictated Text*.
3. **Get Dictionary Value**: Get *Value* for `saved` in *Contents of URL*.
4. **Show Result**: *Dictionary Value* (Siri reads it out: "Saved: …").

In the shortcut's details, turn on **Show on Apple Watch**. On the watch, raise to speak or "Hey Siri, Tracker", then
say the entry.

To test from a terminal, keep the token in a variable rather than in the command:

```
read -rs TRACKER_TOKEN && export TRACKER_TOKEN
curl -sS https://tracker.ingles.place/api/ingest/text \
  -H "Authorization: Bearer $TRACKER_TOKEN" -H 'Content-Type: application/json' \
  -d '{"text":"test from curl"}'
```

Home Assistant's kitchen voice (plan 12) will post the same way with its own token ("Kitchen"). The glucose push
(`POST /api/ingest/glucose`, `HA_INGEST_TOKEN`) is separate and unchanged.

### Parse agent (plan 10)

Each new Inbox entry (typed, Siri, Home Assistant) is read by a model once it's saved. The entry then shows
**proposals**: food entries, medicine doses or a note, each with **Accept** / **Reject**. Nothing is logged until
accepted. When everything is decided and something was accepted, the entry moves to Filed.

- **Foods are mine or new.** The model matches what was said to the foods I've logged, and the Worker copies that
  food's serving and numbers (the model never does nutrition). A food I haven't logged before shows **Needs
  numbers**. **Add Numbers** asks for its serving, protein, calories and carbs once, and the food entry gets the time
  captured from the entry, not the time I filled it in. There is no external food lookup.
- **Medicines** match my medicine list; a dose accepted here has source `inbox` and the entry's text as its note.
- **Models are config**, in `worker/wrangler.jsonc`: `PARSE_MODELS` lists them and `PARSE_MODEL` picks the default.
  Each run records which model it used. Settings → Parser tries a text against each model side by side, using my
  medicines and foods, and saves nothing; use it to pick the default.
- **Workers AI** (the `AI` binding) needs no key. The free plan includes 10,000 neurons a day (reset 00:00 UTC);
  after that, parses fail with `quota` until the next day. The Cloudflare dashboard → Workers AI shows usage.
- **Another provider** (any OpenAI-compatible API, e.g. OpenCode Go): add an entry with `"provider": "openai"`,
  `baseUrl`, `model`, `apiKeySecret` (the *name* of a secret), and optional `headers` / `sessionHeader`. Then from
  `worker/`: `npx wrangler secret put <that name>`. Until the secret is set, the model is listed as unavailable.

Sessions last 30 days without use and 30 days at most; signing in again is silent while the IdP session lasts.

To read CPU time per request (the free plan allows 10 ms), run in your own terminal while making requests:

```
npx wrangler tail tracker --format json | grep -oE '"(cpuTime|url)": *("[^"]*"|[0-9]+)'
```
