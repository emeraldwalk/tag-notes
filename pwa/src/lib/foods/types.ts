export interface FoodEntry {
  id: string; // generated, e.g. crypto.randomUUID()
  name: string;
  servingSize?: string; // free-text description, e.g. "1 cup" or "100g"
  quantity: number;
  protein: number; // per single unit of quantity
  calories: number; // per single unit of quantity
  carbs: number; // per single unit of quantity
  date: string; // YYYY-MM-DD, local date the entry counts towards (daily totals)
  eatenAt?: string; // UTC ISO 8601, when it was eaten (for glucose); absent = unknown
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
  eatenAt?: string; // ISO 8601 with a zone; absent in files from before plan 8
  createdAt?: string;
}

export interface FoodTargets {
  protein: number;
  calories: number;
}

/** What `POST /api/foods` and `PUT /api/foods/:id` take. */
export type FoodInput = Omit<FoodEntry, 'id' | 'createdAt'>;

export interface FoodStore {
  list(): Promise<FoodEntry[]>;
  listByDate(date: string): Promise<FoodEntry[]>;
  create(entry: FoodInput): Promise<FoodEntry>;
  update(id: string, entry: FoodInput): Promise<FoodEntry>;
  remove(id: string): Promise<void>;
  /** Most recently logged entry for each distinct food name, newest first. */
  listRecentDistinct(): Promise<FoodEntry[]>;
}
