const STORAGE_KEY = 'tag-notes:food-targets';

export interface FoodTargets {
  protein: number;
  calories: number;
}

export const DEFAULT_FOOD_TARGETS: FoodTargets = { protein: 150, calories: 2000 };

export function getFoodTargets(): FoodTargets {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return DEFAULT_FOOD_TARGETS;

  try {
    const parsed = JSON.parse(raw);
    return {
      protein: Number(parsed.protein) || 0,
      calories: Number(parsed.calories) || 0,
    };
  } catch {
    return DEFAULT_FOOD_TARGETS;
  }
}

export function setFoodTargets(targets: FoodTargets): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(targets));
}

/** Today's date as YYYY-MM-DD in the local timezone. */
export function todayDateKey(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
