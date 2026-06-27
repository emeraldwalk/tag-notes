export interface FoodEntry {
  id: string; // generated, e.g. crypto.randomUUID()
  name: string;
  quantity: number;
  protein: number; // per single unit of quantity
  calories: number; // per single unit of quantity
  carbs: number; // per single unit of quantity
  date: string; // YYYY-MM-DD, local date the entry is logged against
  createdAt: string; // ISO 8601
}

export interface FoodStore {
  list(): Promise<FoodEntry[]>;
  listByDate(date: string): Promise<FoodEntry[]>;
  create(entry: Omit<FoodEntry, 'id' | 'createdAt'>): Promise<FoodEntry>;
  update(id: string, entry: Omit<FoodEntry, 'id' | 'createdAt'>): Promise<FoodEntry>;
  remove(id: string): Promise<void>;
  /** Most recently logged entry for each distinct food name, newest first. */
  listRecentDistinct(): Promise<FoodEntry[]>;
}
