import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { ORIGIN } from '../src/auth';
import { interpretAnswer } from '../src/parse/answer';
import { readParseModels } from '../src/parse/config';
import { buildMessages, type ParseContext } from '../src/parse/prompt';
import { openAiProvider, ProviderError, workersAiProvider, workersAiText } from '../src/parse/providers';
import { clearData, Jar, send, sendJson, signIn, useHarness } from './harness';

const h = useHarness();
beforeEach(clearData);

type Row = Record<string, unknown> & { id: string };
type Entry = Row & { parse?: { status: string; error?: string; model: string; runId: string; proposals: (Row & { data: Row })[] } };

// ---------------------------------------------------------------------------------------------------------------
// Prompt and answer (no D1)

const CTX: ParseContext = {
  text: 'two eggs and OJ for breakfast, took metformin at 8',
  occurredAt: '2026-11-25T14:30:00.000Z', // 08:30 in Chicago (CST)
  receivedAt: '2026-11-25T14:30:05.000Z',
  timeZone: 'America/Chicago',
  medicines: [{ id: 'med-1', name: 'Metformin', defaultDose: '500 mg' }],
  foods: [
    { name: 'Eggs', servingSize: '1 large', protein: 6, calories: 72, carbs: 0.4 },
    { name: 'Orange juice', servingSize: '1 cup', protein: 1.7, calories: 112, carbs: 26 },
  ],
};

describe('buildMessages', () => {
  it('gives the local entry time, my medicines and foods (no numbers), and the text verbatim, last', () => {
    const [system, user] = buildMessages(CTX);
    expect(system!.role).toBe('system');
    expect(user!.content).toContain('ENTRY TIME: Wednesday 2026-11-25 08:30 (America/Chicago)');
    expect(user!.content).toContain('- id=med-1 | Metformin | usual dose 500 mg');
    expect(user!.content).toContain('- Eggs | serving 1 large');
    expect(user!.content).not.toContain('72');
    expect(user!.content.endsWith(`ENTRY:\n${CTX.text}`)).toBe(true);
  });

  it('lists at most 300 foods', () => {
    const foods = Array.from({ length: 350 }, (_, i) => ({ name: `Food ${i}`, protein: 1, calories: 1, carbs: 1 }));
    const user = buildMessages({ ...CTX, foods })[1]!.content;
    expect(user).toContain('- Food 299');
    expect(user).not.toContain('- Food 300');
  });
});

describe('interpretAnswer', () => {
  const answer = (items: unknown[]) => JSON.stringify({ items });

  it('copies a known food’s numbers from my foods (any case), never the model’s', () => {
    const out = interpretAnswer(
      answer([{ kind: 'food', name: 'eggs', myFood: 'EGGS', quantity: 2, protein: 999, calories: 999, time: '2026-11-25T07:30' }]),
      CTX,
    );
    expect(out).toEqual([
      { kind: 'food', status: 'known', name: 'Eggs', servingSize: '1 large', quantity: 2, protein: 6, calories: 72, carbs: 0.4, eatenAt: '2026-11-25T13:30:00.000Z' },
    ]);
  });

  it('makes a food that isn’t mine "new", with no numbers even if the model sent some', () => {
    const out = interpretAnswer(answer([{ kind: 'food', name: 'Sourdough toast', myFood: 'Toast', quantity: 1, calories: 100 }]), CTX);
    expect(out).toEqual([{ kind: 'food', status: 'new', name: 'Sourdough toast', quantity: 1, eatenAt: CTX.occurredAt }]);
  });

  it('keeps my medicine’s id and default dose, and drops an id that isn’t mine', () => {
    const out = interpretAnswer(
      answer([
        { kind: 'dose', medicineId: 'med-1', medicineName: 'metformin', time: '2026-11-25T08:00' },
        { kind: 'dose', medicineId: 'someone-else', medicineName: 'Ibuprofen', dose: '200 mg' },
      ]),
      CTX,
    );
    expect(out).toEqual([
      { kind: 'dose', medicineId: 'med-1', medicineName: 'Metformin', dose: '500 mg', takenAt: '2026-11-25T14:00:00.000Z' },
      { kind: 'dose', medicineName: 'Ibuprofen', dose: '200 mg', takenAt: CTX.occurredAt },
    ]);
  });

  it('reads a fenced answer, drops bad items, and keeps one note', () => {
    const text = '```json\n' + answer([
      { kind: 'food', name: 'Eggs', myFood: 'Eggs', quantity: -1 },
      { kind: 'food', name: '', myFood: null },
      { kind: 'food', name: 'Cake', quantity: 51 },
      { kind: 'weather' },
      'nonsense',
      { kind: 'dose' },
      { kind: 'note', text: 'Felt dizzy' },
      { kind: 'note', text: 'Second note' },
    ]) + '\n```';
    expect(interpretAnswer(text, CTX)).toEqual([{ kind: 'note', text: 'Felt dizzy' }]);
  });

  it('defaults quantity to 1 and accepts an empty list', () => {
    expect(interpretAnswer(answer([{ kind: 'food', name: 'Apple' }]), CTX)[0]).toMatchObject({ quantity: 1 });
    expect(interpretAnswer('{"items": []}', CTX)).toEqual([]);
  });

  it('throws bad_output without JSON or an items list', () => {
    for (const text of ['Sure! You ate eggs.', '{"foods": []}', '[]']) {
      expect(() => interpretAnswer(text, CTX), text).toThrow(ProviderError);
    }
  });

  it('converts local times across DST, and clamps a time after the entry was received to the entry time', () => {
    const summer = { ...CTX, occurredAt: '2026-07-01T13:30:00.000Z', receivedAt: '2026-07-01T13:30:05.000Z' };
    expect(interpretAnswer(answer([{ kind: 'food', name: 'Apple', time: '2026-07-01T07:00' }]), summer)[0]).toMatchObject({
      eatenAt: '2026-07-01T12:00:00.000Z',
    });
    expect(interpretAnswer(answer([{ kind: 'food', name: 'Apple', time: '2026-11-25T20:00' }]), CTX)[0]).toMatchObject({ eatenAt: CTX.occurredAt });
    expect(interpretAnswer(answer([{ kind: 'food', name: 'Apple', time: 'breakfast' }]), CTX)[0]).toMatchObject({ eatenAt: CTX.occurredAt });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Providers and config

describe('providers', () => {
  it('normalises every Workers AI answer shape', () => {
    expect(workersAiText({ response: '{"items":[]}', usage: { prompt_tokens: 5, completion_tokens: 2 } })).toEqual({
      text: '{"items":[]}',
      inputTokens: 5,
      outputTokens: 2,
    });
    expect(workersAiText({ response: { items: [] } }).text).toBe('{"items":[]}');
    expect(workersAiText({ choices: [{ message: { content: 'x' } }], usage: { input_tokens: 1, output_tokens: 1 } })).toMatchObject({ text: 'x', inputTokens: 1 });
    expect(workersAiText({ output: [{ type: 'reasoning' }, { type: 'message', content: [{ type: 'output_text', text: 'y' }] }] }).text).toBe('y');
    expect(() => workersAiText({})).toThrow(ProviderError);
  });

  it('asks Workers AI for JSON the configured way, and maps errors to codes', async () => {
    const calls: Record<string, unknown>[] = [];
    let fail: Error | null = null;
    const ai = {
      async run(_model: string, inputs: Record<string, unknown>) {
        calls.push(inputs);
        if (fail) throw fail;
        return { response: '{"items":[]}' };
      },
    };
    const opts = { sessionId: 's', schema: { type: 'object' } };
    await workersAiProvider(ai, { id: 'a', provider: 'workers-ai', model: 'm', json: 'response_format' }).complete([], opts);
    await workersAiProvider(ai, { id: 'b', provider: 'workers-ai', model: 'm', json: 'guided_json' }).complete([], opts);
    await workersAiProvider(ai, { id: 'c', provider: 'workers-ai', model: 'm' }).complete([], opts);
    expect(calls[0]!.response_format).toEqual({ type: 'json_schema', json_schema: { type: 'object' } });
    expect(calls[1]!.guided_json).toEqual({ type: 'object' });
    expect(calls[2]).not.toHaveProperty('response_format');

    const codeOf = async (err: Error) => {
      fail = err;
      return workersAiProvider(ai, { id: 'a', provider: 'workers-ai', model: 'm' }).complete([], opts).catch((e: ProviderError) => e.code);
    };
    expect(await codeOf(new Error('4006: you have used up your daily free allocation of 10,000 neurons'))).toBe('quota');
    expect(await codeOf(new Error("JSON Mode couldn't be met"))).toBe('bad_output');
    expect(await codeOf(new Error('boom'))).toBe('provider_error');
  });

  it('times out a slow call', async () => {
    const ai = { run: () => new Promise(() => {}) };
    const err = await workersAiProvider(ai, { id: 'a', provider: 'workers-ai', model: 'm' }, 10)
      .complete([], { sessionId: 's', schema: {} })
      .catch((e: ProviderError) => e);
    expect(err).toMatchObject({ code: 'timeout' });
  });

  it('calls an OpenAI-compatible endpoint with the key, headers and session header, and never leaks the key', async () => {
    const seen: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
    let status = 200;
    const fetchFn = (async (url: string, init: RequestInit) => {
      seen.push({ url, headers: new Headers(init.headers), body: JSON.parse(String(init.body)) });
      return status === 200
        ? Response.json({ choices: [{ message: { content: '{"items":[]}' } }], usage: { prompt_tokens: 9, completion_tokens: 3 } })
        : new Response('nope', { status });
    }) as typeof fetch;
    const model = {
      id: 'go',
      provider: 'openai' as const,
      model: 'qwen',
      baseUrl: 'https://opencode.ai/zen/go/v1',
      apiKeySecret: 'K',
      headers: { 'User-Agent': 'tracker/1.0' },
      sessionHeader: 'x-opencode-session',
    };
    const provider = openAiProvider(model, 'secret-key', fetchFn);
    expect(await provider.complete([{ role: 'user', content: 'hi' }], { sessionId: 'entry-1', schema: {} })).toEqual({
      text: '{"items":[]}',
      inputTokens: 9,
      outputTokens: 3,
    });
    expect(seen[0]!.url).toBe('https://opencode.ai/zen/go/v1/chat/completions');
    expect(seen[0]!.headers.get('Authorization')).toBe('Bearer secret-key');
    expect(seen[0]!.headers.get('User-Agent')).toBe('tracker/1.0');
    expect(seen[0]!.headers.get('x-opencode-session')).toBe('entry-1');
    expect(seen[0]!.body).toMatchObject({ model: 'qwen', response_format: { type: 'json_object' } });

    status = 429;
    const err = (await provider.complete([], { sessionId: 'e', schema: {} }).catch((e: ProviderError) => e)) as ProviderError;
    expect(err.code).toBe('http_429');
    expect(err.message).not.toContain('secret-key');
  });

  it('reads PARSE_MODELS, skipping malformed entries', () => {
    const models = readParseModels([
      { id: 'a', provider: 'workers-ai', model: '@cf/x', json: 'guided_json' },
      { id: 'b', provider: 'openai', model: 'y' },
      { provider: 'workers-ai', model: 'no-id' },
      { id: 'c', provider: 'other', model: 'z' },
      { id: 'd', provider: 'openai', model: 'y', baseUrl: 'https://x.test/v1/', apiKeySecret: 'K' },
    ]);
    expect(models.map((m) => m.id)).toEqual(['a', 'd']);
    expect(models[1]!.baseUrl).toBe('https://x.test/v1');
    expect(readParseModels('not json')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Routes

const entries = async (jar: Jar, q = '') => ((await (await send(h, jar, `/api/raw-entries${q}`)).json()) as { entries: Entry[] }).entries;
const entry = async (jar: Jar, id: string) => (await entries(jar, '?status=all')).find((e) => e.id === id)!;
const addEntry = async (jar: Jar, text: string) => {
  const res = await sendJson(h, jar, 'POST', '/api/raw-entries', { text });
  expect(res.status).toBe(201);
  return ((await res.json()) as { entry: Entry }).entry;
};
const addMedicine = async (jar: Jar, name: string, defaultDose?: string) =>
  ((await (await sendJson(h, jar, 'POST', '/api/medicines', { name, defaultDose })).json()) as { medicine: Row }).medicine;
const addFood = (jar: Jar, food: Record<string, unknown>) =>
  sendJson(h, jar, 'POST', '/api/foods', { quantity: 1, protein: 6, calories: 72, carbs: 0.4, date: '2026-11-20', ...food });
const accept = (jar: Jar, id: string, body?: unknown) => sendJson(h, jar, 'POST', `/api/proposals/${id}/accept`, body);
const reject = (jar: Jar, id: string) => sendJson(h, jar, 'POST', `/api/proposals/${id}/reject`);
const answer = (items: unknown[]) => JSON.stringify({ items });

/** An entry parsed in the background with the given answer; returns it with its proposals. */
async function parsedEntry(jar: Jar, text: string, items: unknown[]): Promise<Entry> {
  h.answers = [answer(items)];
  const e = await addEntry(jar, text);
  await h.settle();
  return entry(jar, e.id);
}

describe('parsing', () => {
  it('parses a new Inbox entry in the background with the default model, using my medicines and foods', async () => {
    const jar = await signIn(h, new Jar());
    await addMedicine(jar, 'Metformin', '500 mg');
    await addFood(jar, { name: 'Eggs', servingSize: '1 large' });
    const e = await parsedEntry(jar, 'two eggs', [{ kind: 'food', name: 'Eggs', myFood: 'Eggs', quantity: 2 }]);

    expect(h.modelCalls).toHaveLength(1);
    expect(h.modelCalls[0]!.model).toBe('fake');
    expect(h.modelCalls[0]!.sessionId).toBe(e.id);
    expect(h.modelCalls[0]!.messages[1]!.content).toContain('Metformin');
    expect(e.parse).toMatchObject({ status: 'done', model: 'fake' });
    expect(e.parse!.proposals).toEqual([
      {
        id: expect.any(String),
        status: 'proposed',
        data: { kind: 'food', status: 'known', name: 'Eggs', servingSize: '1 large', quantity: 2, protein: 6, calories: 72, carbs: 0.4, eatenAt: e.occurredAt },
      },
    ]);
    const run = await env.DB.prepare('SELECT model_ref, input_tokens, output_tokens, output FROM parse_runs').first();
    expect(run).toMatchObject({ model_ref: 'workers-ai/@cf/test/fake', input_tokens: 100, output_tokens: 20 });
  });

  it('parses text from a capture source too, and keeps the entry when the model fails', async () => {
    const jar = await signIn(h, new Jar());
    const { secret } = (await (await sendJson(h, jar, 'POST', '/api/ingest-tokens', { name: 'Siri' })).json()) as { secret: string };
    h.answers = [
      () => {
        throw new ProviderError('quota', 'out of neurons');
      },
    ];
    const res = await h.app.fetch(
      new Request(`${ORIGIN}/api/ingest/text`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'toast' }),
      }),
    );
    expect(res.status).toBe(201);
    await h.settle();
    const [e] = await entries(jar);
    expect(e!.parse).toMatchObject({ status: 'failed', error: 'quota', proposals: [] });
  });

  it('records bad output as failed, keeping what the model said', async () => {
    const jar = await signIn(h, new Jar());
    h.answers = ['I think you ate eggs.'];
    const e = await addEntry(jar, 'eggs');
    await h.settle();
    expect((await entry(jar, e.id)).parse).toMatchObject({ status: 'failed', error: 'bad_output' });
    expect(await env.DB.prepare('SELECT output FROM parse_runs').first('output')).toBe('I think you ate eggs.');
  });

  it('re-parses on request with a chosen model, replacing undecided proposals', async () => {
    const jar = await signIn(h, new Jar());
    const e = await parsedEntry(jar, 'apple', [{ kind: 'food', name: 'Apple' }]);
    const oldId = e.parse!.proposals[0]!.id;

    h.answers = [answer([{ kind: 'food', name: 'Green apple' }])];
    const res = await sendJson(h, jar, 'POST', `/api/raw-entries/${e.id}/parse`, { model: 'fake-2' });
    expect(res.status).toBe(200);
    const again = ((await res.json()) as { entry: Entry }).entry;
    expect(again.parse).toMatchObject({ model: 'fake-2', status: 'done' });
    expect(again.parse!.proposals.map((p) => p.data.name)).toEqual(['Green apple']);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM proposals').first('n')).toBe(1);

    // The old run's proposal is gone: accepting it is not found.
    expect((await accept(jar, oldId)).status).toBe(404);
    expect((await sendJson(h, jar, 'POST', `/api/raw-entries/${e.id}/parse`, { model: 'nope' })).status).toBe(400);
    expect((await sendJson(h, jar, 'POST', `/api/raw-entries/${e.id}/parse`, { model: 'keyless' })).status).toBe(200);
    expect((await entry(jar, e.id)).parse).toMatchObject({ model: 'keyless', status: 'failed', error: 'unavailable' });
  });

  it('won’t parse a filed entry, one with an accepted proposal, or one being parsed (unless that run is stale)', async () => {
    const jar = await signIn(h, new Jar());
    const parse = (id: string) => sendJson(h, jar, 'POST', `/api/raw-entries/${id}/parse`);

    const noted = await addEntry(jar, 'a note');
    await h.settle();
    await send(h, jar, `/api/raw-entries/${noted.id}/note`, { method: 'POST' });
    expect(await (await parse(noted.id)).json()).toEqual({ error: 'already_filed' });

    const two = await parsedEntry(jar, 'apple and pear', [{ kind: 'food', name: 'Apple' }, { kind: 'food', name: 'Pear' }]);
    expect((await accept(jar, two.parse!.proposals[0]!.id, { food: { name: 'Apple', quantity: 1, protein: 0, calories: 95, carbs: 25 } })).status).toBe(200);
    expect((await parse(two.id)).status).toBe(409);

    const busy = await parsedEntry(jar, 'busy', []);
    await env.DB.prepare("UPDATE parse_runs SET status = 'running', started_at = ? WHERE raw_entry_id = ?").bind(new Date().toISOString(), busy.id).run();
    expect(await (await parse(busy.id)).json()).toEqual({ error: 'parsing' });
    const old = new Date(Date.now() - 2 * 60_000).toISOString();
    await env.DB.prepare('UPDATE parse_runs SET started_at = ? WHERE raw_entry_id = ?').bind(old, busy.id).run();
    expect((await entry(jar, busy.id)).parse).toMatchObject({ status: 'failed', error: 'timeout' });
    expect((await parse(busy.id)).status).toBe(200);
  });

  it('lists models with availability, and tries a text without saving anything', async () => {
    const jar = await signIn(h, new Jar());
    expect(await (await send(h, jar, '/api/parse/models')).json()).toEqual({
      models: [
        { id: 'fake', provider: 'workers-ai', model: '@cf/test/fake', available: true },
        { id: 'fake-2', provider: 'workers-ai', model: '@cf/test/fake-2', available: true },
        { id: 'keyless', provider: 'openai', model: 'm', available: false },
      ],
      default: 'fake',
    });
    h.answers = [answer([{ kind: 'note', text: 'tired' }])];
    const res = await sendJson(h, jar, 'POST', '/api/parse/try', { text: 'feeling tired', model: 'fake-2' });
    expect(await res.json()).toMatchObject({
      model: 'fake-2',
      modelRef: 'workers-ai/@cf/test/fake-2',
      inputTokens: 100,
      outputTokens: 20,
      output: answer([{ kind: 'note', text: 'tired' }]),
      proposals: [{ kind: 'note', text: 'tired' }],
    });
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM parse_runs').first('n')).toBe(0);
    expect((await sendJson(h, jar, 'POST', '/api/parse/try', { text: '', model: 'fake' })).status).toBe(400);
    expect((await sendJson(h, jar, 'POST', '/api/parse/try', { text: 'x', model: 'nope' })).status).toBe(400);
  });
});

describe('accepting and rejecting', () => {
  it('accepts a known food as an ordinary food entry at the captured time, once', async () => {
    const jar = await signIn(h, new Jar());
    await addFood(jar, { name: 'Eggs', servingSize: '1 large' });
    const e = await parsedEntry(jar, 'two eggs at 7', [{ kind: 'food', myFood: 'Eggs', quantity: 2 }]);
    const p = e.parse!.proposals[0]!;

    const res = await accept(jar, p.id);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { proposal: Row; entry: Entry };
    expect(body.proposal).toMatchObject({ status: 'accepted', outcomeId: expect.any(String) });
    expect(body.entry).toMatchObject({ status: 'done', outcomeKind: 'proposals', outcomeId: e.parse!.runId });

    const food = await env.DB.prepare('SELECT * FROM foods WHERE id = ?').bind(body.proposal.outcomeId).first();
    expect(food).toMatchObject({ name: 'Eggs', serving_size: '1 large', quantity: 2, protein: 6, calories: 72, eaten_at: e.occurredAt, user_id: 'sub-brian' });
    expect((await accept(jar, p.id)).status).toBe(409);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM foods').first('n')).toBe(2);
  });

  it('needs numbers for a new food, and uses the captured time, not when they were added', async () => {
    const jar = await signIn(h, new Jar());
    const e = await parsedEntry(jar, 'sourdough toast', [{ kind: 'food', name: 'Sourdough toast', myFood: null, time: null }]);
    const p = e.parse!.proposals[0]!;
    expect(p.data).toMatchObject({ status: 'new', name: 'Sourdough toast' });

    expect((await accept(jar, p.id)).status).toBe(400);
    expect((await accept(jar, p.id, { food: { name: 'Sourdough toast', quantity: 1, protein: 4, calories: -1, carbs: 20 } })).status).toBe(400);
    const res = await accept(jar, p.id, { food: { name: ' Sourdough toast ', servingSize: '1 slice', quantity: 2, protein: 4, calories: 120, carbs: 22 } });
    expect(res.status).toBe(200);
    const id = ((await res.json()) as { proposal: Row }).proposal.outcomeId;
    const food = await env.DB.prepare('SELECT name, serving_size, quantity, eaten_at, date FROM foods WHERE id = ?').bind(id).first();
    expect(food).toEqual({ name: 'Sourdough toast', serving_size: '1 slice', quantity: 2, eaten_at: e.occurredAt, date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
  });

  it('accepts a dose (source inbox, the entry’s text as its note), by name when the medicine was deleted', async () => {
    const jar = await signIn(h, new Jar());
    const med = await addMedicine(jar, 'Metformin', '500 mg');
    const e = await parsedEntry(jar, 'took metformin, and vitamin d', [
      { kind: 'dose', medicineId: med.id, medicineName: 'Metformin' },
      { kind: 'dose', medicineId: med.id, medicineName: 'Metformin', dose: '1000 mg' },
    ]);
    const [first, second] = e.parse!.proposals;
    const res = await accept(jar, first!.id);
    expect(res.status).toBe(200);
    const doseId = ((await res.json()) as { proposal: Row }).proposal.outcomeId;
    expect(await env.DB.prepare('SELECT medicine_id, medicine_name, dose, taken_at, note, source FROM doses WHERE id = ?').bind(doseId).first()).toEqual({
      medicine_id: med.id,
      medicine_name: 'Metformin',
      dose: '500 mg',
      taken_at: e.occurredAt,
      note: 'took metformin, and vitamin d',
      source: 'inbox',
    });

    await send(h, jar, `/api/medicines/${med.id}`, { method: 'DELETE' });
    const again = await accept(jar, second!.id);
    expect(again.status).toBe(200);
    const id2 = ((await again.json()) as { proposal: Row }).proposal.outcomeId;
    expect(await env.DB.prepare('SELECT medicine_id, dose FROM doses WHERE id = ?').bind(id2).first()).toEqual({ medicine_id: null, dose: '1000 mg' });
  });

  it('accepts a note at the entry’s time, with its tags', async () => {
    const jar = await signIn(h, new Jar());
    const e = await parsedEntry(jar, 'dizzy', [{ kind: 'note', text: 'Felt dizzy\n\n:symptoms' }]);
    expect((await accept(jar, e.parse!.proposals[0]!.id, { food: {} })).status).toBe(400);
    const res = await accept(jar, e.parse!.proposals[0]!.id);
    const id = ((await res.json()) as { proposal: Row }).proposal.outcomeId;
    const note = ((await (await send(h, jar, `/api/notes/${id}`)).json()) as { note: Row }).note;
    expect(note).toMatchObject({ title: 'Felt dizzy', tags: ['symptoms'], createdAt: e.occurredAt });
  });

  it('files the entry only once everything is decided and something was accepted', async () => {
    const jar = await signIn(h, new Jar());
    const e = await parsedEntry(jar, 'apple, pear', [{ kind: 'note', text: 'one' }, { kind: 'food', name: 'Pear' }]);
    const [note, pear] = e.parse!.proposals;
    await reject(jar, pear!.id);
    expect((await entry(jar, e.id)).status).toBe('new');
    expect((await reject(jar, pear!.id)).status).toBe(409);
    await accept(jar, note!.id);
    expect(await entry(jar, e.id)).toMatchObject({ status: 'done', outcomeKind: 'proposals' });

    const all = await parsedEntry(jar, 'nothing', [{ kind: 'note', text: 'meh' }]);
    await reject(jar, all.parse!.proposals[0]!.id);
    expect(await entry(jar, all.id)).toMatchObject({ status: 'new' });
    expect(await entry(jar, all.id)).not.toHaveProperty('outcomeKind');
  });

  it('keeps users apart, and deleting an entry deletes its runs and proposals', async () => {
    const jar = await signIn(h, new Jar());
    const e = await parsedEntry(jar, 'note', [{ kind: 'note', text: 'x' }]);
    const other = await signIn(h, new Jar(), 'sub-other');
    const pid = e.parse!.proposals[0]!.id;
    expect((await accept(other, pid)).status).toBe(404);
    expect((await reject(other, pid)).status).toBe(404);
    expect((await sendJson(h, other, 'POST', `/api/raw-entries/${e.id}/parse`)).status).toBe(404);

    await send(h, jar, `/api/raw-entries/${e.id}`, { method: 'DELETE' });
    expect(await env.DB.prepare('SELECT (SELECT COUNT(*) FROM parse_runs) + (SELECT COUNT(*) FROM proposals) AS n').first('n')).toBe(0);
  });

  it('needs a session', async () => {
    for (const [method, path] of [
      ['GET', '/api/parse/models'],
      ['POST', '/api/parse/try'],
      ['POST', '/api/raw-entries/x/parse'],
      ['POST', '/api/proposals/x/accept'],
      ['POST', '/api/proposals/x/reject'],
    ] as const) {
      expect((await send(h, new Jar(), path, { method })).status, path).toBe(401);
    }
  });
});
