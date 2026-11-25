import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiError, setApiDeps } from './api';
import { IMPORT_CHUNK, importBundle } from './backup';
import { createHttpFoodStore } from './foods/store';
import { createHttpMedsStore } from './meds/store';
import { DEFAULT_FOOD_TARGETS, getFoodTargets, setFoodTargets } from './foods/targets';
import { createHttpNoteStore } from './notes/store';

interface Call {
  url: string;
  method: string;
  body: unknown;
  headers: Headers;
}

let calls: Call[];
let answers: (Response | Error)[];
let redirects: string[];
let restore: () => void;

const json = (body: unknown, status = 200) => Response.json(body, { status });

beforeEach(() => {
  calls = [];
  answers = [];
  redirects = [];
  restore = setApiDeps({
    fetch: async (input, init) => {
      calls.push({
        url: String(input),
        method: init?.method ?? 'GET',
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
        headers: new Headers(init?.headers),
      });
      const next = answers.shift() ?? json({});
      if (next instanceof Error) throw next;
      return next;
    },
    redirect: (url) => redirects.push(url),
    currentPath: () => '/notes/history?x=1',
  });
});

afterEach(() => restore());

const note = {
  id: 'n1',
  rawText: 'T\n\n:a',
  title: 'T',
  body: '',
  tags: ['a'],
  createdAt: '2026-11-24T00:00:00.000Z',
  updatedAt: '2026-11-24T00:00:00.000Z',
};

describe('HTTP note store', () => {
  const store = createHttpNoteStore();

  it('lists, filters by tag and reads tags', async () => {
    answers.push(json({ notes: [note] }), json({ notes: [note] }), json({ tags: ['a'] }));
    expect(await store.list()).toEqual([note]);
    expect(await store.listByTag('A b')).toEqual([note]);
    expect(await store.listTags()).toEqual(['a']);
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(['GET /api/notes', 'GET /api/notes?tag=a%20b', 'GET /api/tags']);
  });

  it('creates and updates with rawText only', async () => {
    answers.push(json({ note }, 201), json({ note }));
    expect(await store.create('T\n\n:a')).toEqual(note);
    expect(await store.update('n1', 'U')).toEqual(note);
    expect(calls[0]).toMatchObject({ url: '/api/notes', method: 'POST', body: { rawText: 'T\n\n:a' } });
    expect(calls[0]!.headers.get('Content-Type')).toBe('application/json');
    expect(calls[1]).toMatchObject({ url: '/api/notes/n1', method: 'PUT', body: { rawText: 'U' } });
  });

  it('get answers undefined for 404; remove ignores 404', async () => {
    answers.push(json({ error: 'not_found' }, 404), json({ error: 'not_found' }, 404), new Response(null, { status: 204 }));
    expect(await store.get('gone')).toBeUndefined();
    await expect(store.remove('gone')).resolves.toBeUndefined();
    await expect(store.remove('n1')).resolves.toBeUndefined();
    expect(calls[2]).toMatchObject({ url: '/api/notes/n1', method: 'DELETE' });
  });

  it('sends a signed-out browser to sign in, coming back here', async () => {
    answers.push(json({ error: 'unauthenticated' }, 401));
    await expect(store.list()).rejects.toBeInstanceOf(ApiError);
    expect(redirects).toEqual(['/auth/login?returnTo=%2Fnotes%2Fhistory%3Fx%3D1']);
  });

  it('turns a dropped connection and server errors into messages', async () => {
    answers.push(new TypeError('Failed to fetch'), json({ error: 'invalid', detail: 'rawText must be a string.' }, 400));
    await expect(store.create('x')).rejects.toThrow(/No connection/);
    await expect(store.create('x')).rejects.toThrow('rawText must be a string.');
    expect(redirects).toEqual([]);
  });
});

describe('HTTP food store and targets', () => {
  const store = createHttpFoodStore();
  const food = {
    id: 'f1',
    name: 'Oats',
    quantity: 1,
    protein: 5,
    calories: 150,
    carbs: 27,
    date: '2026-11-24',
    eatenAt: '2026-11-24T14:00:00.000Z',
    createdAt: '2026-11-24T14:01:00.000Z',
  };

  it('uses the food routes', async () => {
    answers.push(json({ foods: [food] }), json({ foods: [food] }), json({ foods: [food] }), json({ food }, 201), json({ food }));
    expect(await store.list()).toEqual([food]);
    expect(await store.listByDate('2026-11-24')).toEqual([food]);
    expect(await store.listRecentDistinct()).toEqual([food]);
    const { id: _id, createdAt: _c, ...input } = food;
    expect(await store.create(input)).toEqual(food);
    expect(await store.update('f1', input)).toEqual(food);
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'GET /api/foods',
      'GET /api/foods?date=2026-11-24',
      'GET /api/foods/recent',
      'POST /api/foods',
      'PUT /api/foods/f1',
    ]);
    expect(calls[3]!.body).toEqual(input);
  });

  it('reads targets, defaulting when the server has none, and saves them', async () => {
    answers.push(json({ targets: null }), json({ targets: { protein: 120, calories: 1800 } }), json({ targets: {} }));
    expect(await getFoodTargets()).toEqual(DEFAULT_FOOD_TARGETS);
    expect(await getFoodTargets()).toEqual({ protein: 120, calories: 1800 });
    await setFoodTargets({ protein: 1, calories: 2 });
    expect(calls[2]).toMatchObject({ url: '/api/food-targets', method: 'PUT', body: { protein: 1, calories: 2 } });
  });
});

describe('importBundle', () => {
  it('posts the file in chunks, targets with the last, and adds up the counts', async () => {
    const notes = Array.from({ length: IMPORT_CHUNK + 5 }, (_, i) => ({ id: `n${i}`, rawText: `N${i}` }));
    const foods = [{ name: 'Oats', quantity: 1, protein: 5, calories: 150, carbs: 27, date: '2026-11-24' }];
    answers.push(
      json({ notes: 200, foods: 0, targets: false, medicines: 0, doses: 0, skipped: 0 }),
      json({ notes: 4, foods: 1, targets: true, medicines: 0, doses: 0, skipped: 1 }),
    );
    const result = await importBundle({ notes, foods, foodTargets: { protein: 1, calories: 2 }, medicines: [], doses: [] });
    expect(result).toEqual({ notes: 204, foods: 1, targets: true, medicines: 0, doses: 0, skipped: 1 });
    expect(calls).toHaveLength(2);
    const [first, second] = calls.map((c) => c.body as Record<string, unknown[]>);
    expect(calls.every((c) => c.url === '/api/import' && c.method === 'POST')).toBe(true);
    expect(first!['notes']).toHaveLength(IMPORT_CHUNK);
    expect(first).not.toHaveProperty('foodTargets');
    expect(second!['notes']).toHaveLength(5);
    expect(second!['foods']).toEqual(foods);
    expect(second).toMatchObject({ app: 'tag-notes', version: 2, foodTargets: { protein: 1, calories: 2 } });
  });

  it('posts once for an empty file', async () => {
    answers.push(json({ notes: 0, foods: 0, targets: false, medicines: 0, doses: 0, skipped: 0 }));
    await importBundle({ notes: [], foods: [], medicines: [], doses: [] });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toMatchObject({ notes: [] });
  });

  it('sends medicines and doses after notes and foods, adding up their counts', async () => {
    const medicine = { name: 'Metformin', active: true, sortOrder: 0 };
    const dose = { medicineName: 'Metformin', takenAt: '2026-11-24T14:00:00.000Z', source: 'tap' as const };
    const notes = Array.from({ length: IMPORT_CHUNK - 1 }, (_, i) => ({ rawText: `N${i}` }));
    answers.push(
      json({ notes: 199, foods: 0, targets: false, medicines: 1, doses: 0, skipped: 0 }),
      json({ notes: 0, foods: 0, targets: false, medicines: 0, doses: 1, skipped: 0 }),
    );
    const result = await importBundle({ notes, foods: [], medicines: [medicine], doses: [dose] });
    expect(result).toMatchObject({ notes: 199, medicines: 1, doses: 1 });
    const [first, second] = calls.map((c) => c.body as Record<string, unknown[]>);
    expect(first!['medicines']).toEqual([medicine]);
    expect(first).not.toHaveProperty('doses');
    expect(second).toMatchObject({ notes: [], doses: [dose] });
  });
});

describe('HTTP meds store', () => {
  const store = createHttpMedsStore();
  const medicine = { id: 'm1', name: 'Metformin', active: true, sortOrder: 0, createdAt: '2026-11-24T00:00:00.000Z' };
  const dose = { id: 'd1', medicineId: 'm1', medicineName: 'Metformin', takenAt: '2026-11-24T14:00:00.000Z', source: 'tap', createdAt: '2026-11-24T14:00:00.000Z' };

  it('uses the medicine and dose routes', async () => {
    answers.push(
      json({ medicines: [medicine] }),
      json({ medicine }, 201),
      json({ medicine }),
      new Response(null, { status: 204 }),
      json({ doses: [dose] }),
      json({ doses: [dose] }),
      json({ dose }, 201),
      json({ dose }),
      json({ error: 'not_found' }, 404),
      json({ converted: 1, skipped: 0 }),
    );
    expect(await store.listMedicines()).toEqual([medicine]);
    expect(await store.createMedicine({ name: 'Metformin', defaultDose: '500 mg' })).toEqual(medicine);
    expect(await store.updateMedicine('m1', { active: false })).toEqual(medicine);
    await store.removeMedicine('m1');
    expect(await store.listDoses()).toEqual([dose]);
    expect(await store.listDoses({ from: '2026-11-24T06:00:00.000Z', to: '2026-11-25T06:00:00.000Z' })).toEqual([dose]);
    expect(await store.createDose({ medicineId: 'm1', source: 'tap' })).toEqual(dose);
    expect(await store.updateDose('d1', { dose: null })).toEqual(dose);
    await expect(store.removeDose('gone')).resolves.toBeUndefined();
    expect(await store.convertNotes([{ noteIds: ['n1'], medicineId: 'm1' }])).toEqual({ converted: 1, skipped: 0 });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'GET /api/medicines',
      'POST /api/medicines',
      'PUT /api/medicines/m1',
      'DELETE /api/medicines/m1',
      'GET /api/doses',
      'GET /api/doses?from=2026-11-24T06%3A00%3A00.000Z&to=2026-11-25T06%3A00%3A00.000Z',
      'POST /api/doses',
      'PUT /api/doses/d1',
      'DELETE /api/doses/gone',
      'POST /api/doses/convert-notes',
    ]);
    expect(calls[1]!.body).toEqual({ name: 'Metformin', defaultDose: '500 mg' });
    expect(calls[7]!.body).toEqual({ dose: null });
    expect(calls[9]!.body).toEqual({ groups: [{ noteIds: ['n1'], medicineId: 'm1' }] });
  });

  it('surfaces a duplicate name', async () => {
    answers.push(json({ error: 'duplicate_name' }, 409));
    await expect(store.createMedicine({ name: 'Metformin' })).rejects.toMatchObject({ status: 409, code: 'duplicate_name' });
  });
});
