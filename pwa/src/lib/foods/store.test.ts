import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { createIndexedDbFoodStore } from './store';
import type { FoodStore } from './types';

describe('createIndexedDbFoodStore', () => {
  let store: FoodStore;

  beforeEach(async () => {
    store = createIndexedDbFoodStore();

    for (const entry of await store.list()) {
      await store.remove(entry.id);
    }
  });

  it('starts with an empty list', async () => {
    expect(await store.list()).toEqual([]);
  });

  it('creates a food entry and returns it with generated fields', async () => {
    const entry = await store.create({
      name: 'Chicken Breast',
      quantity: 2,
      protein: 30,
      calories: 165,
      carbs: 0,
      date: '2026-06-27',
    });

    expect(entry.id).toBeTruthy();
    expect(entry.name).toBe('Chicken Breast');
    expect(entry.quantity).toBe(2);
    expect(() => new Date(entry.createdAt).toISOString()).not.toThrow();
  });

  it('listByDate() returns only entries for that date, sorted newest first', async () => {
    const a = await store.create({
      name: 'A',
      quantity: 1,
      protein: 1,
      calories: 1,
      carbs: 1,
      date: '2026-06-27',
    });
    await new Promise((r) => setTimeout(r, 5));
    const b = await store.create({
      name: 'B',
      quantity: 1,
      protein: 1,
      calories: 1,
      carbs: 1,
      date: '2026-06-27',
    });
    await store.create({
      name: 'C',
      quantity: 1,
      protein: 1,
      calories: 1,
      carbs: 1,
      date: '2026-06-26',
    });

    const entries = await store.listByDate('2026-06-27');
    expect(entries.map((e) => e.id)).toEqual([b.id, a.id]);
  });

  it('update() overwrites fields while preserving id and createdAt', async () => {
    const entry = await store.create({
      name: 'A',
      quantity: 1,
      protein: 1,
      calories: 1,
      carbs: 1,
      date: '2026-06-27',
    });

    const updated = await store.update(entry.id, {
      name: 'A (revised)',
      quantity: 2,
      protein: 5,
      calories: 50,
      carbs: 10,
      date: '2026-06-27',
    });

    expect(updated.id).toBe(entry.id);
    expect(updated.createdAt).toBe(entry.createdAt);
    expect(updated.name).toBe('A (revised)');
    expect(updated.quantity).toBe(2);

    const [stored] = await store.list();
    expect(stored).toEqual(updated);
  });

  it('update() throws for an unknown id', async () => {
    await expect(
      store.update('missing-id', {
        name: 'A',
        quantity: 1,
        protein: 1,
        calories: 1,
        carbs: 1,
        date: '2026-06-27',
      }),
    ).rejects.toThrow();
  });

  it('remove() deletes a food entry', async () => {
    const entry = await store.create({
      name: 'A',
      quantity: 1,
      protein: 1,
      calories: 1,
      carbs: 1,
      date: '2026-06-27',
    });
    await store.remove(entry.id);
    expect(await store.list()).toEqual([]);
  });

  it('listRecentDistinct() returns the most recent entry per distinct food name, case-insensitively', async () => {
    await store.create({
      name: 'Oats',
      quantity: 1,
      protein: 5,
      calories: 150,
      carbs: 27,
      date: '2026-06-25',
    });
    await new Promise((r) => setTimeout(r, 5));
    await store.create({
      name: 'Chicken',
      quantity: 1,
      protein: 30,
      calories: 165,
      carbs: 0,
      date: '2026-06-26',
    });
    await new Promise((r) => setTimeout(r, 5));
    const latestOats = await store.create({
      name: 'oats',
      quantity: 2,
      protein: 6,
      calories: 160,
      carbs: 28,
      date: '2026-06-27',
    });

    const recent = await store.listRecentDistinct();
    expect(recent).toHaveLength(2);
    expect(recent[0].id).toBe(latestOats.id);
    expect(recent[0].protein).toBe(6);
    expect(recent.map((e) => e.name.toLowerCase()).sort()).toEqual(['chicken', 'oats']);
  });
});
