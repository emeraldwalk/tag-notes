import type { Context } from 'hono';
import type { EntryParse, ParseModelInfo, ParseTryResult, Proposal, ProposalData, RawEntry } from '../../../pwa/src/lib/inbox/types';
import type { AppEnv } from '../app';
import { interpretAnswer } from './answer';
import { modelRef, type ParseModel } from './config';
import { ANSWER_SCHEMA, buildMessages, MAX_PROMPT_FOODS, type ParseContext } from './prompt';
import { type ChatProvider, ProviderError } from './providers';

/** What the parse agent needs from the Worker's config and bindings. */
export interface ParseDeps {
  models: ParseModel[];
  /** `PARSE_MODEL`: the id new entries are parsed with. */
  defaultModel: string;
  /** The provider for a model, or null when it can't be called (its API key secret is unset). */
  providerFor(model: ParseModel): ChatProvider | null;
  timeZone: string;
  /** Runs work after the response; defaults to `waitUntil`. Tests collect the promises instead. */
  defer?: (work: Promise<unknown>) => void;
}

/** A run still `running` after this long is treated as failed (`timeout`), and may be replaced. */
export const STALE_RUN_MS = 60_000;
const MAX_OUTPUT = 4000;

interface RunRow {
  id: string;
  raw_entry_id: string;
  model: string;
  status: string;
  error: string | null;
  started_at: string;
}

interface ProposalRow {
  id: string;
  run_id: string;
  status: string;
  outcome_id: string | null;
  data: string;
}

interface EntryRow {
  id: string;
  text: string;
  occurred_at: string;
  received_at: string;
}

export type StartResult = { ok: true; runId: string } | { ok: false; code: 'not_found' | 'already_filed' | 'parsing' };

/** The latest run of an entry, as SQL usable in a WHERE (one `?`: the entry id). */
export const LATEST_RUN_SQL = '(SELECT id FROM parse_runs WHERE raw_entry_id = ? ORDER BY started_at DESC, id DESC LIMIT 1)';

export function createParser(db: D1Database, deps: ParseDeps) {
  const findModel = (id: string) => deps.models.find((m) => m.id === id);

  async function loadContext(userId: string, entry: { text: string; occurredAt: string; receivedAt: string }): Promise<ParseContext> {
    const [meds, foods] = await db.batch([
      db.prepare('SELECT id, name, default_dose FROM medicines WHERE user_id = ? AND active = 1 ORDER BY sort_order, name COLLATE NOCASE').bind(userId),
      db
        .prepare(
          `SELECT name, serving_size, protein, calories, carbs FROM (
             SELECT *, ROW_NUMBER() OVER (PARTITION BY lower(trim(name)) ORDER BY created_at DESC) AS rn
             FROM foods WHERE user_id = ?
           ) WHERE rn = 1 ORDER BY created_at DESC LIMIT ${MAX_PROMPT_FOODS}`,
        )
        .bind(userId),
    ]);
    return {
      text: entry.text,
      occurredAt: entry.occurredAt,
      receivedAt: entry.receivedAt,
      timeZone: deps.timeZone,
      medicines: (meds!.results as { id: string; name: string; default_dose: string | null }[]).map((m) => ({
        id: m.id,
        name: m.name,
        ...(m.default_dose ? { defaultDose: m.default_dose } : {}),
      })),
      foods: (foods!.results as { name: string; serving_size: string | null; protein: number; calories: number; carbs: number }[]).map((f) => ({
        name: f.name,
        ...(f.serving_size ? { servingSize: f.serving_size } : {}),
        protein: f.protein,
        calories: f.calories,
        carbs: f.carbs,
      })),
    };
  }

  /** One model call: proposals, or the error code. Never throws. */
  async function callModel(model: ParseModel, ctx: ParseContext, sessionId: string) {
    const started = Date.now();
    const provider = deps.providerFor(model);
    if (!provider) return { ms: 0, error: 'unavailable' as string, proposals: [] as ProposalData[] };
    let output: string | undefined;
    try {
      const completion = await provider.complete(buildMessages(ctx), { sessionId, schema: ANSWER_SCHEMA });
      output = completion.text;
      const proposals = interpretAnswer(completion.text, ctx);
      return { ms: Date.now() - started, output, proposals, inputTokens: completion.inputTokens, outputTokens: completion.outputTokens };
    } catch (err) {
      const error = err instanceof ProviderError ? err.code : 'provider_error';
      if (!(err instanceof ProviderError)) console.error('parse: unexpected error', err instanceof Error ? err.message : String(err));
      return { ms: Date.now() - started, output, error, proposals: [] as ProposalData[] };
    }
  }

  /** Claims a new run for the entry, unless it's filed, has an accepted proposal, or is being parsed. */
  async function start(userId: string, entryId: string, model: ParseModel): Promise<StartResult> {
    const now = new Date();
    const staleBefore = new Date(now.getTime() - STALE_RUN_MS).toISOString();
    const state = await db
      .prepare(
        `SELECT outcome_kind,
           EXISTS (SELECT 1 FROM proposals WHERE raw_entry_id = e.id AND status = 'accepted') AS accepted,
           EXISTS (SELECT 1 FROM parse_runs WHERE raw_entry_id = e.id AND status = 'running' AND started_at > ?) AS running
         FROM raw_entries e WHERE id = ? AND user_id = ?`,
      )
      .bind(staleBefore, entryId, userId)
      .first<{ outcome_kind: string | null; accepted: number; running: number }>();
    if (!state) return { ok: false, code: 'not_found' };
    if (state.outcome_kind !== null || state.accepted) return { ok: false, code: 'already_filed' };
    if (state.running) return { ok: false, code: 'parsing' };

    const runId = crypto.randomUUID();
    const res = await db
      .prepare(
        `INSERT INTO parse_runs (id, user_id, raw_entry_id, model, model_ref, status, started_at)
         SELECT ?1, ?2, ?3, ?4, ?5, 'running', ?6
         WHERE EXISTS (SELECT 1 FROM raw_entries WHERE id = ?3 AND user_id = ?2 AND outcome_kind IS NULL)
           AND NOT EXISTS (SELECT 1 FROM proposals WHERE raw_entry_id = ?3 AND status = 'accepted')
           AND NOT EXISTS (SELECT 1 FROM parse_runs WHERE raw_entry_id = ?3 AND status = 'running' AND started_at > ?7)`,
      )
      .bind(runId, userId, entryId, model.id, modelRef(model), now.toISOString(), staleBefore)
      .run();
    return res.meta.changes ? { ok: true, runId } : { ok: false, code: 'parsing' };
  }

  /** Calls the model for a claimed run and records the result: proposals replace earlier runs' undecided ones. */
  async function finish(userId: string, runId: string, entry: EntryRow, model: ParseModel): Promise<void> {
    const ctx = await loadContext(userId, { text: entry.text, occurredAt: entry.occurred_at, receivedAt: entry.received_at });
    const result = await callModel(model, ctx, entry.id);
    const now = new Date().toISOString();
    const statements: D1PreparedStatement[] = [
      db
        .prepare(
          `UPDATE parse_runs SET status = ?, error = ?, output = ?, input_tokens = ?, output_tokens = ?, finished_at = ?
           WHERE id = ? AND status = 'running'`,
        )
        .bind(result.error ? 'failed' : 'done', result.error ?? null, result.output?.slice(0, MAX_OUTPUT) ?? null,
          result.inputTokens ?? null, result.outputTokens ?? null, now, runId),
    ];
    if (!result.error) {
      statements.push(
        db
          .prepare(
            `DELETE FROM proposals WHERE raw_entry_id = ? AND status != 'accepted'
               AND run_id IN (SELECT id FROM parse_runs WHERE raw_entry_id = ? AND id != ? AND started_at <= (SELECT started_at FROM parse_runs WHERE id = ?))`,
          )
          .bind(entry.id, entry.id, runId, runId),
        ...result.proposals.map((p, i) =>
          db
            .prepare(
              `INSERT INTO proposals (id, user_id, raw_entry_id, run_id, position, kind, data, status, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, 'proposed', ?)`,
            )
            .bind(crypto.randomUUID(), userId, entry.id, runId, i, p.kind, JSON.stringify(p), now),
        ),
      );
    }
    await db.batch(statements);
  }

  const getEntry = (userId: string, entryId: string) =>
    db.prepare('SELECT id, text, occurred_at, received_at FROM raw_entries WHERE id = ? AND user_id = ?').bind(entryId, userId).first<EntryRow>();

  /** Starts and finishes a parse in this request. */
  async function parseNow(userId: string, entryId: string, modelId = deps.defaultModel): Promise<StartResult | { ok: false; code: 'unknown_model' }> {
    const model = findModel(modelId);
    if (!model) return { ok: false, code: 'unknown_model' };
    const started = await start(userId, entryId, model);
    if (!started.ok) return started;
    const entry = await getEntry(userId, entryId);
    if (entry) await finish(userId, started.runId, entry, model);
    return started;
  }

  /** After a new entry is saved: parse it with the default model once the response is sent. Failures stay on the run. */
  function parseLater(c: Context<AppEnv>, userId: string, entryId: string): void {
    if (!findModel(deps.defaultModel)) return;
    const work = parseNow(userId, entryId).catch((err: unknown) => {
      console.error('parse: background parse failed', err instanceof Error ? err.message : String(err));
    });
    if (deps.defer) return deps.defer(work);
    try {
      c.executionCtx.waitUntil(work);
    } catch {
      // No execution context (a plain fetch in tests): the work still runs.
    }
  }

  /** The entries with their latest parse (two queries for the whole list). */
  async function attach(userId: string, entries: RawEntry[]): Promise<RawEntry[]> {
    if (entries.length === 0) return entries;
    const ids = JSON.stringify(entries.map((e) => e.id));
    const { results: runs } = await db
      .prepare(
        `SELECT r.id, r.raw_entry_id, r.model, r.status, r.error, r.started_at FROM parse_runs r
         WHERE r.user_id = ? AND r.raw_entry_id IN (SELECT value FROM json_each(?))
           AND r.id = (SELECT id FROM parse_runs WHERE raw_entry_id = r.raw_entry_id ORDER BY started_at DESC, id DESC LIMIT 1)`,
      )
      .bind(userId, ids)
      .all<RunRow>();
    if (runs.length === 0) return entries;
    const { results: proposals } = await db
      .prepare(
        `SELECT id, run_id, status, outcome_id, data FROM proposals
         WHERE user_id = ? AND run_id IN (SELECT value FROM json_each(?)) ORDER BY position`,
      )
      .bind(userId, JSON.stringify(runs.map((r) => r.id)))
      .all<ProposalRow>();
    const byRun = new Map<string, Proposal[]>();
    for (const p of proposals) {
      const list = byRun.get(p.run_id) ?? [];
      list.push(toProposal(p));
      byRun.set(p.run_id, list);
    }
    const staleBefore = new Date(Date.now() - STALE_RUN_MS).toISOString();
    const byEntry = new Map(runs.map((r) => [r.raw_entry_id, toEntryParse(r, byRun.get(r.id) ?? [], staleBefore)]));
    return entries.map((e) => {
      const parse = byEntry.get(e.id);
      return parse ? { ...e, parse } : e;
    });
  }

  /** Runs a text through a model with my real context, writing nothing. */
  async function tryText(userId: string, text: string, occurredAt: string, modelId: string): Promise<ParseTryResult | null> {
    const model = findModel(modelId);
    if (!model) return null;
    const ctx = await loadContext(userId, { text, occurredAt, receivedAt: new Date().toISOString() });
    const result = await callModel(model, ctx, `try-${crypto.randomUUID()}`);
    const out: ParseTryResult = { model: model.id, modelRef: modelRef(model), ms: result.ms, proposals: result.proposals };
    if (result.inputTokens !== undefined) out.inputTokens = result.inputTokens;
    if (result.outputTokens !== undefined) out.outputTokens = result.outputTokens;
    if (result.output !== undefined) out.output = result.output.slice(0, MAX_OUTPUT);
    if (result.error) out.error = result.error;
    return out;
  }

  function listModels(): { models: ParseModelInfo[]; default: string } {
    return {
      models: deps.models.map((m) => ({ id: m.id, provider: m.provider, model: m.model, available: deps.providerFor(m) !== null })),
      default: deps.defaultModel,
    };
  }

  return { parseNow, parseLater, attach, tryText, listModels, findModel };
}

export type Parser = ReturnType<typeof createParser>;

export function toProposal(r: ProposalRow): Proposal {
  const p: Proposal = { id: r.id, status: r.status as Proposal['status'], data: JSON.parse(r.data) as ProposalData };
  if (r.outcome_id !== null) p.outcomeId = r.outcome_id;
  return p;
}

function toEntryParse(r: RunRow, proposals: Proposal[], staleBefore: string): EntryParse {
  const stale = r.status === 'running' && r.started_at <= staleBefore;
  const parse: EntryParse = {
    runId: r.id,
    status: stale ? 'failed' : (r.status as EntryParse['status']),
    model: r.model,
    startedAt: r.started_at,
    proposals: r.status === 'done' ? proposals : [],
  };
  const error = stale ? 'timeout' : r.error;
  if (error) parse.error = error;
  return parse;
}
