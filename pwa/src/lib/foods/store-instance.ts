import { createHttpFoodStore } from './store';

/** Shared `FoodStore` for the whole app (plan 8: the Worker's API). UI code imports this, never `fetch`. */
export const foodStore = createHttpFoodStore();
