import { createIndexedDbFoodStore } from './store';

/**
 * Shared `FoodStore` instance for the whole app. UI code should import this
 * rather than constructing its own store, so all routes/components operate
 * on the same underlying IndexedDB connection.
 */
export const foodStore = createIndexedDbFoodStore();
