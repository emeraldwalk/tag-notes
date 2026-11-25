import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiError, setApiDeps } from './api';
import { IMPORT_CHUNK, importBundle } from './backup';
import { createHttpFoodStore } from './foods/store';
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
    answers.push(json({ notes: 200, foods: 0, targets: false, skipped: 0 }), json({ notes: 4, foods: 1, targets: true, skipped: 1 }));
    const result = await importBundle({ notes, foods, foodTargets: { protein: 1, calories: 2 } });
    expect(result).toEqual({ notes: 204, foods: 1, targets: true, skipped: 1 });
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
    answers.push(json({ notes: 0, foods: 0, targets: false, skipped: 0 }));
    await importBundle({ notes: [], foods: [] });
    expect(calls).toHaveLength(1);
  });
});
