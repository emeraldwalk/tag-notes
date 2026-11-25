import { api } from '../api';
import type { FoodTargets } from './types';

export type { FoodTargets } from './types';

export const DEFAULT_FOOD_TARGETS: FoodTargets = { protein: 150, calories: 2000 };

/** The signed-in user's targets from the server; `DEFAULT_FOOD_TARGETS` when none are saved yet. */
export async function getFoodTargets(): Promise<FoodTargets> {
  const { targets } = await api<{ targets: FoodTargets | null }>('/food-targets');
  return targets ?? DEFAULT_FOOD_TARGETS;
}

export async function setFoodTargets(targets: FoodTargets): Promise<void> {
  await api<{ targets: FoodTargets }>('/food-targets', { method: 'PUT', body: targets });
}

/** Today's date as YYYY-MM-DD in the local timezone. */
export function todayDateKey(): string {
  return dateKey(new Date());
}

/** A date as YYYY-MM-DD in the local timezone. */
export function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
