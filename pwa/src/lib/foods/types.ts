export interface FoodEntry {
  id: string; // generated, e.g. crypto.randomUUID()
  name: string;
  servingSize?: string; // free-text description, e.g. "1 cup" or "100g"
  quantity: number;
  protein: number; // per single unit of quantity
  calories: number; // per single unit of quantity
  carbs: number; // per single unit of quantity
  date: string; // YYYY-MM-DD, local date the entry is logged against
  createdAt: string; // ISO 8601
}

/** A food entry read from an export file; missing `id`/`createdAt` are generated on import. */
export interface ImportableFoodEntry {
  id?: string;
  name: string;
  servingSize?: string; // free text, e.g. "1 cup"
  quantity: number;
  protein: number;
  calories: number;
  carbs: number;
  date: string; // YYYY-MM-DD
  createdAt?: string;
}

export interface FoodStore {
  list(): Promise<FoodEntry[]>;
  listByDate(date: string): Promise<FoodEntry[]>;
  create(entry: Omit<FoodEntry, 'id' | 'createdAt'>): Promise<FoodEntry>;
  update(id: string, entry: Omit<FoodEntry, 'id' | 'createdAt'>): Promise<FoodEntry>;
  remove(id: string): Promise<void>;
  /** Most recently logged entry for each distinct food name, newest first. */
  listRecentDistinct(): Promise<FoodEntry[]>;
  /** Upsert by id; entries without an id or createdAt get generated ones. */
  importAll(entries: ImportableFoodEntry[]): Promise<void>;
}
