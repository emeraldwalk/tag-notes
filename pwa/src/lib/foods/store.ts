import { api, ApiError } from '../api';
import type { FoodEntry, FoodStore } from './types';

/** The `FoodStore` over the Worker's `/api/foods`. */
export function createHttpFoodStore(): FoodStore {
  return {
    async list() {
      return (await api<{ foods: FoodEntry[] }>('/foods')).foods;
    },
    async listByDate(date) {
      return (await api<{ foods: FoodEntry[] }>(`/foods?date=${encodeURIComponent(date)}`)).foods;
    },
    async create(entry) {
      return (await api<{ food: FoodEntry }>('/foods', { method: 'POST', body: entry })).food;
    },
    async update(id, entry) {
      return (await api<{ food: FoodEntry }>(`/foods/${encodeURIComponent(id)}`, { method: 'PUT', body: entry })).food;
    },
    async remove(id) {
      try {
        await api<void>(`/foods/${encodeURIComponent(id)}`, { method: 'DELETE' });
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return;
        throw err;
      }
    },
    async listRecentDistinct() {
      return (await api<{ foods: FoodEntry[] }>('/foods/recent')).foods;
    },
  };
}
