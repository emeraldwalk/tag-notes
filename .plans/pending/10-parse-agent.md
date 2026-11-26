# 10 — Parse agent

- [ ] Candidate models: pick 2–3 Workers AI models from the catalog (free plan, JSON output) and record them here
- [ ] Migration `0005_parse.sql`; `ai` binding; `PARSE_MODELS` / `PARSE_MODEL` vars; `npx wrangler types`
- [ ] Provider adapters (Workers AI binding, OpenAI-compatible) behind one interface
- [ ] Parser: prompt with context, model output validated into proposals, run recorded with its model
- [ ] Triggers: after `POST /api/ingest/text` and `POST /api/raw-entries` (in `waitUntil`), and `POST /api/raw-entries/:id/parse`
- [ ] Accept / reject proposals (food entry, dose, note); the entry is filed when all are decided
- [ ] Inbox: parse state and proposals on each new entry
- [ ] Settings → Parser: try a text against each model side by side (`POST /api/parse/try`, saves nothing)
- [ ] Tests (fake provider; no network)
- [ ] README: config, adding a model, the free allowance
- [ ] `npm run check`
- [ ] Owner: push, compare models on real entries, set `PARSE_MODEL`, live checks

## Goal

Something said to Tracker ("I had two eggs and toast for breakfast", "took my metformin at 8") turns into
**proposed** food entries, medicine doses or a note, shown on the Inbox entry for me to accept or reject. Nothing is
logged without my tap. Each proposal records the model that made it, so models can be compared and swapped by config.

Plan 11 builds on this: food lookup tools (USDA FoodData Central, Open Food Facts), correcting a proposal before
accepting it, and approved foods that resolve repeat meals. This plan's food numbers come from my own recent foods
when the name matches, else the model's estimate, marked as such.

## Decisions made while writing (2026-11-25)

- **No native tool calling in this plan.** Workers AI documents function calling for one model, and its response
  format isn't documented as the same across models. Here the context (my medicines, my recent foods, the time) goes
  in the prompt and the model answers with one JSON object. That works the same way with any chat model, including
  small free ones. Plan 11 adds a tool loop where lookups need it.
- **The default model is picked on real entries** with a compare screen (Settings → Parser), since models can only be
  called from the deployed Worker. Until then `PARSE_MODEL` is the first candidate.
- **No new cron.** The cron already uses 4–9 ms of its 10 ms. Parsing runs per request: after an entry is saved
  (`waitUntil`), or when the Inbox asks.

## Existing touchpoints

| Path | Role / change |
| --- | --- |
| `worker/wrangler.jsonc` | `"ai": { "binding": "AI" }`; vars `PARSE_MODELS`, `PARSE_MODEL`. Then `npx wrangler types`; commit `worker-configuration.d.ts`. |
| `worker/src/app.ts`, `worker/src/index.ts` | Pass the AI binding, model config and any provider secrets into the routes (as `db`, `timeZone` are now). |
| `worker/src/inbox.ts` | `textIngest` and `POST /raw-entries` start a parse with `c.executionCtx.waitUntil`. `GET /raw-entries` gains each entry's latest parse. New `POST /raw-entries/:id/parse`. |
| `worker/src/foods.ts`, `worker/src/meds.ts`, `worker/src/notes.ts` | Accepting a proposal writes a food entry, dose or note **the same way their own POST routes do**. Factor those inserts into functions both use; don't duplicate SQL. |
| `worker/src/meds.ts` | Dose `source` gains `'inbox'` (`isDoseSource`, the PWA's `Dose` type). |
| `worker/src/body.ts` | `localDate` for a food's `date` from its `eatenAt` in `TZ_NAME`. |
| `pwa/src/lib/inbox/types.ts` | `RawEntry` gains `parse`; `outcomeKind` gains `'proposals'`. Types below. |
| `pwa/src/routes/Inbox.tsx` (+ components) | Parse state and proposals per entry. |
| `pwa/src/routes/Settings.tsx` | "Parser" section (model list, try box). |
| `README.md` | "Parse agent (plan 10)" under Deploying. |

## Contracts

### Migration `worker/migrations/0005_parse.sql`

```sql
CREATE TABLE parse_runs (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  raw_entry_id  TEXT NOT NULL REFERENCES raw_entries(id) ON DELETE CASCADE,
  model         TEXT NOT NULL,          -- PARSE_MODELS id, e.g. 'llama-3.1-8b'
  model_ref     TEXT NOT NULL,          -- what was called: '<provider>/<model>', e.g. 'workers-ai/@cf/meta/llama-3.1-8b-instruct'
  status        TEXT NOT NULL,          -- 'running' | 'done' | 'failed'
  error         TEXT,                   -- short code: 'timeout', 'http_429', 'bad_output', 'quota', ...
  output        TEXT,                   -- the model's raw answer, first 4000 chars (for comparing models; no secrets)
  input_tokens  INTEGER,
  output_tokens INTEGER,
  started_at    TEXT NOT NULL,
  finished_at   TEXT
);
CREATE INDEX parse_runs_by_entry ON parse_runs (raw_entry_id, started_at);

CREATE TABLE proposals (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  raw_entry_id TEXT NOT NULL REFERENCES raw_entries(id) ON DELETE CASCADE,
  run_id       TEXT NOT NULL REFERENCES parse_runs(id) ON DELETE CASCADE,
  position     INTEGER NOT NULL,        -- order within the run
  kind         TEXT NOT NULL,           -- 'food' | 'dose' | 'note'
  data         TEXT NOT NULL,           -- JSON, ProposalData below
  status       TEXT NOT NULL DEFAULT 'proposed',  -- 'proposed' | 'accepted' | 'rejected'
  outcome_id   TEXT,                    -- the food entry / dose / note made on accept
  created_at   TEXT NOT NULL,
  decided_at   TEXT
);
CREATE INDEX proposals_by_run ON proposals (run_id, position);
```

Check that D1 enforces the foreign keys as written (`PRAGMA foreign_keys`). If not, deleting a raw entry deletes its
runs and proposals in the same batch.

### Model config (`wrangler.jsonc` vars)

```jsonc
"PARSE_MODELS": [
  { "id": "llama-3.1-8b", "provider": "workers-ai", "model": "@cf/meta/llama-3.1-8b-instruct" },
  // An OpenAI-compatible provider, e.g. OpenCode Go (paid): the key is a secret named here, never a var.
  // { "id": "go-…", "provider": "openai", "baseUrl": "https://opencode.ai/zen/go/v1", "model": "…",
  //   "apiKeySecret": "OPENCODE_GO_KEY", "headers": { "User-Agent": "tracker/1.0" }, "sessionHeader": "x-opencode-session" }
],
"PARSE_MODEL": "llama-3.1-8b"
```

- `id` is short and stable; it's what runs record (`model`), with `model_ref` saying exactly what was called.
- `sessionHeader`: send that header with a stable value per raw entry (its id), which OpenCode Go requires.
- A model whose `apiKeySecret` is unset is listed as unavailable, not an error at startup.
- The first checklist step replaces the example with 2–3 real Workers AI candidates. Choose from the catalog
  (`https://developers.cloudflare.com/workers-ai/models/`): text generation, available on Workers Free (some models
  need Workers Paid), JSON output or good instruction following, and the cost per M tokens on the pricing page.
  Record the choices and their neuron costs here.

### Provider interface (`worker/src/parse/providers.ts`)

```ts
export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }
export interface Completion { text: string; inputTokens?: number; outputTokens?: number }
export interface ChatProvider {
  /** One completion that should be a JSON object. Rejects with ProviderError on HTTP / quota / timeout. */
  complete(messages: ChatMessage[], opts: { signal: AbortSignal; sessionId: string }): Promise<Completion>;
}
export class ProviderError extends Error { constructor(readonly code: string, message: string) }
```

- `workers-ai`: `env.AI.run(model, { messages, response_format?, max_tokens })`. Use `response_format` JSON mode
  where the model supports it. Answer shapes vary by model (`response` as text or an object, or OpenAI-style
  `choices[0].message.content`), so normalise to `text` here and test each candidate's real shape on the compare
  screen. Running out of the daily neurons is `'quota'`.
- `openai`: `POST {baseUrl}/chat/completions` with `Authorization: Bearer <secret>`, the configured headers,
  `response_format: { type: 'json_object' }`, and `usage` read into the token counts.
- 25 s timeout per call (`waitUntil` work gets 30 s after the response). One call per parse, with no retry inside a
  request.

### What the model sees and answers

The system prompt holds the rules and the JSON shape. The user message holds:

- **When:** the entry's `occurredAt` as a local date, weekday and time in `TZ_NAME`. Relative times ("an hour ago",
  "for breakfast") are relative to it.
- **My medicines:** the active ones, as `id`, name and default dose.
- **My foods:** the 40 most recent distinct foods (`listRecentDistinct`), each with its name, serving size and
  protein / calories / carbs per unit.
- **The text**, verbatim.

The answer has to be exactly this shape:

```json
{ "items": [
  { "kind": "food", "name": "Eggs", "myFood": "Eggs", "quantity": 2, "servingSize": "1 large",
    "protein": 6, "calories": 72, "carbs": 0.4, "time": "2026-11-25T07:30" },
  { "kind": "dose", "medicineId": "…", "medicineName": "Metformin", "dose": "500 mg", "time": "2026-11-25T08:00" },
  { "kind": "note", "text": "Felt dizzy after lunch\n\n:symptoms" }
] }
```

- `time` is local `YYYY-MM-DDTHH:MM` or null (= the entry's time). The Worker converts it with `TZ_NAME`. A time
  more than 5 minutes after the entry was received becomes the entry's time.
- **`myFood`** names one of *my foods* exactly. When it does, the Worker takes servingSize, protein, calories and
  carbs from that food, not from the model (`basis: 'my-food'`). Otherwise the model's numbers are kept with
  `basis: 'estimate'`. Nutrition is per unit of `quantity`, as in `FoodEntry`.
- `medicineId` must be one of mine, else it's dropped and `medicineName` kept.
- Text that is neither food nor medicine becomes one `note` (the note text format, with a tag line if the model
  picks tags). Empty `items` is a valid answer ("nothing to log").
- **Validation** is in the Worker: whole answer JSON (allow a fenced ```json block), known kinds, numbers ≥ 0 and
  sane (quantity ≤ 50, calories per unit ≤ 5000), strings trimmed and length-capped. Items that fail are dropped. If
  the JSON itself fails, the run is `failed` with `bad_output`, keeping `output`. The prompt is built in one module
  (`worker/src/parse/prompt.ts`), so plan 11 can extend it.

### Proposal types (`pwa/src/lib/inbox/types.ts`, shared)

```ts
export type ProposalData =
  | { kind: 'food'; name: string; servingSize?: string; quantity: number; protein: number; calories: number;
      carbs: number; eatenAt: string; basis: 'my-food' | 'estimate' }
  | { kind: 'dose'; medicineId?: string; medicineName: string; dose?: string; takenAt: string }
  | { kind: 'note'; text: string };

export interface Proposal {
  id: string; status: 'proposed' | 'accepted' | 'rejected'; outcomeId?: string; data: ProposalData;
}
export interface EntryParse {
  runId: string; status: 'running' | 'done' | 'failed'; model: string; error?: string;
  startedAt: string; proposals: Proposal[];     // [] unless done
}
// RawEntry gains:  parse?: EntryParse   (the latest run; absent = never parsed)
//                  outcomeKind?: 'note' | 'proposals'
```

### Routes (signed in unless noted, scoped to the session's user, errors as plan 8)

| Route | Body | Response |
| --- | --- | --- |
| `GET /api/raw-entries` (existing) | | each entry gains `parse` (one query for the page's latest runs and their proposals, not one per entry) |
| `POST /api/raw-entries/:id/parse` | `{ model? }` (an id from `PARSE_MODELS`) | runs the parse in this request and returns `200 { entry }` when it ends, `done` or `failed`. `409 already_filed` if the entry has an outcome or any accepted proposal. `409 parsing` if a run started under 60 s ago is still `running` (an older one counts as failed). |
| `POST /api/proposals/:id/accept` | | `200 { proposal, entry }`: writes the food entry (`date` from `eatenAt` in `TZ_NAME`), dose (`source 'inbox'`, `note` = the entry's text) or note (`createdAt` = the entry's `occurredAt`), and marks the proposal `accepted` with `outcome_id`, in one batch. `409` unless it's `proposed` and from the entry's latest run. |
| `POST /api/proposals/:id/reject` | | `200 { proposal, entry }` |
| `GET /api/parse/models` | | `{ models: [ { id, provider, model, available } ], default }` |
| `POST /api/parse/try` | `{ text, model, occurredAt? }` | `200 { model, modelRef, ms, inputTokens?, outputTokens?, output, proposals: ProposalData[] }`, or `{ …, error }`. Uses my real context; **writes nothing**. |

- **After each accept or reject:** when no proposal of the latest run is still `proposed` and at least one was
  accepted, the entry becomes `done` with `outcome_kind 'proposals'` and `outcome_id` = the run id. If all were
  rejected, it stays `new` (Note / Done / Dismiss as today, or re-parse).
- **Automatic parse:** `textIngest` and `POST /api/raw-entries` respond first, then parse with `PARSE_MODEL` in
  `c.executionCtx.waitUntil`. A failure is recorded on the run and never fails the save. Entries from before this
  plan aren't parsed until I tap Parse.
- **CPU:** building the prompt, one JSON parse of the answer and a few inserts. Fetch wait time doesn't count. Measure
  `POST /api/ingest/text` and `/parse` with `wrangler tail`.

## Screens

- **Inbox entry** (`new`), under the text:
  - Never parsed: **Parse** (alongside Note / Done / Dismiss).
  - `running`: "Reading…". While any visible entry is running, the Inbox re-fetches every 3 s, stopping after
    60 s.
  - `failed`: "Couldn't read this (`error`)" and **Try again**.
  - `done`: one row per proposal. Food: "2 × Eggs (1 large) · 144 kcal, 12 g protein, 1 g carbs · 7:30 AM", plus
    "estimate" when `basis` is `estimate`. Dose: "Metformin 500 mg · 8:00 AM". Note: its first line. Each row has
    **Accept** / **Reject**, and the entry has **Accept all** when more than one is proposed. Accepted rows show a
    link to the food day, Meds history or the note. "Nothing to log" for empty proposals. The model id is shown
    small, with **Re-parse** while nothing is accepted.
- **Settings → Parser:** the models (default marked, unavailable greyed). A text box (pre-filled from a recent
  Inbox entry if there is one), with checkboxes for the models to try. **Try** runs them one after another and shows
  each model's proposals, time, tokens, and the raw output in a disclosure. The footer says the default is
  `PARSE_MODEL` in `wrangler.jsonc`.

## Concept boundaries

- **Proposal** vs the row it makes: a proposal is a suggestion with its own lifecycle. Accepting it creates an
  ordinary food entry, dose or note, which can then be edited or deleted like any other. Deleting that row doesn't
  touch the proposal.
- **Raw entry `status`** (new / done / dismissed) stays mine. Parse state lives in `parse_runs`. Accepting proposals
  can move an entry to `done` (that is my decision, made by tapping); parsing never changes `status` by itself.
- **`outcome_kind 'note'`** (plan 9's Note button) vs **a `note` proposal**: both make a note. The first files the
  entry immediately; the second goes through accept.
- **Dose `source 'inbox'`** is a dose accepted from a parsed entry, whatever the capture channel; the entry's own
  `source` says Siri, Kitchen or app. Plan 16's `'voice'` stays unused.
- **`/api/parse/try`** is for comparing models and writes nothing. Its results can't be accepted.
- `basis: 'my-food'` is my own recent foods only. Plan 11's approved foods and external lookups are separate.

## Export / import

`parse_runs` and `proposals` aren't exported. They're working state; what they produced (foods, doses, notes) is
exported already. Imported raw entries have no runs. An entry imported with `outcomeKind 'proposals'` keeps that
value, since the import accepts the new value.

## Tests (worker; a fake `ChatProvider`, no network)

- Prompt: contains the local time, active medicines only, at most 40 foods, and the verbatim text.
- Output handling: fenced JSON; `myFood` replaces nutrition; an unknown `myFood` → estimate; a foreign
  `medicineId` dropped; bad items dropped; non-JSON → `failed bad_output` with `output` kept; local time → UTC
  across a DST change; a future time clamped.
- Provider adapters: answer-shape normalisation for each Workers AI shape; OpenAI headers (key, session header) and
  usage; timeout and 429 / quota codes. The key never appears in `error` or `output`.
- Routes: ingest and Inbox create call `waitUntil` with a parse, and the save succeeds when the parse fails;
  `/parse` 409s (filed, accepted, running under 60 s), with a stale run allowed; accept food / dose / note writes
  the same rows as the existing POST routes, and a second accept 409s; an accept from an old run 409s; the entry
  files after the last decision only if something was accepted; `/parse/try` writes nothing; every route
  isolates users; deleting an entry removes its runs and proposals.

## Owner steps and validation

1. Push. The deploy applies `0005_parse.sql`.
2. Settings → Parser: try 10 real entries (meals, doses, a feeling, something mixed) on each candidate. Pick the
   default on correctness first (items, quantities, times, matching my foods and medicines), then speed and cost.
   Set `PARSE_MODEL`, commit and push. Record the comparison in this plan.
3. Say "Hey Siri, Tracker: I had two eggs and toast for breakfast". Within seconds the Inbox entry shows proposals;
   accept them, and they show in Food on the right day and time; the entry moves to Filed.
4. "Took my metformin" → a dose proposal → accept → in Meds history with the right time.
5. Cloudflare dashboard → Workers AI: neurons used per parse, against 10,000 a day. Note it here.
6. `wrangler tail`: CPU for `POST /api/ingest/text` (including the parse) and `/parse` against 10 ms.
