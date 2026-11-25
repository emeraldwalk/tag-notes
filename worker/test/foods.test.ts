import { beforeEach, describe, expect, it } from 'vitest';
import { clearData, Jar, send, sendJson, signIn, useHarness } from './harness';

const h = useHarness();
type Food = Record<string, unknown> & { id: string };

beforeEach(clearData);

const oats = { name: 'Oats', servingSize: '1 cup', quantity: 1.5, protein: 5, calories: 150, carbs: 27, date: '2026-11-24', eatenAt: '2026-11-24T14:00:00.000Z' };

const create = async (jar: Jar, body: Record<string, unknown>) => {
  const res = await sendJson(h, jar, 'POST', '/api/foods', body);
  expect(res.status).toBe(201);
  return ((await res.json()) as { food: Food }).food;
};
const list = async (jar: Jar, path = '/api/foods') => ((await (await send(h, jar, path)).json()) as { foods: Food[] }).foods;

describe('foods API signed out', () => {
  it('401s every route', async () => {
    const jar = new Jar();
    for (const [method, path] of [['GET', '/api/foods'], ['GET', '/api/foods/recent'], ['POST', '/api/foods'], ['PUT', '/api/foods/x'], ['DELETE', '/api/foods/x'], ['GET', '/api/food-targets'], ['PUT', '/api/food-targets'], ['POST', '/api/import']] as const) {
      expect((await sendJson(h, jar, method, path, method === 'GET' || method === 'DELETE' ? undefined : {})).status, `${method} ${path}`).toBe(401);
    }
  });
});

describe('foods API signed in', () => {
  it('creates, reads by date, updates and deletes', async () => {
    const jar = await signIn(h, new Jar());
    const food = await create(jar, { ...oats, id: 'ignored', createdAt: '2000-01-01T00:00:00Z' });
    expect(food).toMatchObject(oats);
    expect(food.id).not.toBe('ignored');
    expect(food.createdAt).not.toBe('2000-01-01T00:00:00Z');

    const noTime = await create(jar, { name: 'Tea', quantity: 1, protein: 0, calories: 2, carbs: 0, date: '2026-11-23' });
    expect(noTime).not.toHaveProperty('eatenAt');
    expect(noTime).not.toHaveProperty('servingSize');

    expect((await list(jar, '/api/foods?date=2026-11-24')).map((f) => f.id)).toEqual([food.id]);
    expect((await list(jar)).map((f) => f.id).sort()).toEqual([food.id, noTime.id].sort());

    const res = await sendJson(h, jar, 'PUT', `/api/foods/${food.id}`, { ...oats, quantity: 2, eatenAt: '2026-11-24T09:30:00-06:00' });
    expect(res.status).toBe(200);
    const updated = ((await res.json()) as { food: Food }).food;
    expect(updated).toMatchObject({ id: food.id, quantity: 2, eatenAt: '2026-11-24T15:30:00.000Z', createdAt: food.createdAt });

    // Clearing the time (unknown) is allowed.
    const cleared = ((await (await sendJson(h, jar, 'PUT', `/api/foods/${food.id}`, { ...oats, eatenAt: null })).json()) as { food: Food }).food;
    expect(cleared).not.toHaveProperty('eatenAt');

    expect((await sendJson(h, jar, 'DELETE', `/api/foods/${food.id}`)).status).toBe(204);
    expect((await sendJson(h, jar, 'DELETE', `/api/foods/${food.id}`)).status).toBe(404);
    expect((await sendJson(h, jar, 'PUT', `/api/foods/${food.id}`, oats)).status).toBe(404);
  });

  it('orders newest first by eatenAt, then createdAt', async () => {
    const jar = await signIn(h, new Jar());
    const late = await create(jar, { ...oats, name: 'Late', eatenAt: '2026-11-24T20:00:00Z' });
    const early = await create(jar, { ...oats, name: 'Early', eatenAt: '2026-11-24T08:00:00Z' });
    expect((await list(jar)).map((f) => f.id)).toEqual([late.id, early.id]);
  });

  it('lists the newest entry per distinct food name', async () => {
    const jar = await signIn(h, new Jar());
    await create(jar, { ...oats, name: 'Oats', protein: 1 });
    await new Promise((r) => setTimeout(r, 5));
    await create(jar, { ...oats, name: 'Banana' });
    await new Promise((r) => setTimeout(r, 5));
    const newest = await create(jar, { ...oats, name: ' oats ', protein: 9 });
    const recent = await list(jar, '/api/foods/recent');
    expect(recent.map((f) => f.name)).toEqual([' oats ', 'Banana']);
    expect(recent[0]!.id).toBe(newest.id);
  });

  it('validates bodies and the date query', async () => {
    const jar = await signIn(h, new Jar());
    for (const body of [
      { ...oats, name: '' },
      { ...oats, protein: -1 },
      { ...oats, quantity: '1' },
      { ...oats, date: '11/24/2026' },
      { ...oats, eatenAt: '2026-11-24T14:00:00' },
      { ...oats, eatenAt: 'noon' },
      { ...oats, servingSize: 3 },
      [],
    ]) {
      const res = await sendJson(h, jar, 'POST', '/api/foods', body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(await res.json()).toMatchObject({ error: 'invalid', detail: expect.any(String) });
    }
    expect((await send(h, jar, '/api/foods?date=yesterday')).status).toBe(400);
    expect((await sendJson(h, jar, 'POST', '/api/foods', { ...oats, name: 'x'.repeat(70 * 1024) })).status).toBe(413);
  });

  it('keeps food targets per user', async () => {
    const jar = await signIn(h, new Jar());
    expect(await (await send(h, jar, '/api/food-targets')).json()).toEqual({ targets: null });
    const put = await sendJson(h, jar, 'PUT', '/api/food-targets', { protein: 140, calories: 1900 });
    expect(await put.json()).toEqual({ targets: { protein: 140, calories: 1900 } });
    expect(await (await send(h, jar, '/api/food-targets')).json()).toEqual({ targets: { protein: 140, calories: 1900 } });
    expect((await sendJson(h, jar, 'PUT', '/api/food-targets', { protein: -1, calories: 1 })).status).toBe(400);

    const other = await signIn(h, new Jar(), 'sub-other');
    expect(await (await send(h, other, '/api/food-targets')).json()).toEqual({ targets: null });
  });
});

describe('foods between users', () => {
  it("can't read, change or delete another user's entries", async () => {
    const mine = await signIn(h, new Jar());
    const food = await create(mine, oats);
    const other = await signIn(h, new Jar(), 'sub-other');
    expect(await list(other)).toEqual([]);
    expect(await list(other, '/api/foods/recent')).toEqual([]);
    expect(await list(other, '/api/foods?date=2026-11-24')).toEqual([]);
    expect((await sendJson(h, other, 'PUT', `/api/foods/${food.id}`, { ...oats, name: 'Hijacked' })).status).toBe(404);
    expect((await sendJson(h, other, 'DELETE', `/api/foods/${food.id}`)).status).toBe(404);
    expect((await list(mine))[0]).toMatchObject({ id: food.id, name: 'Oats' });
  });
});
