import type { FoodTargets } from './foods/targets';
import type { FoodEntry, ImportableFoodEntry } from './foods/types';
import type { ImportableNote, Note } from './notes/types';

/** Identifies the file format, not the app's name; unchanged so old files still match. */
export const EXPORT_FORMAT = 'tag-notes';
export const EXPORT_VERSION = 2;

export interface ExportFileV2 {
  app: typeof EXPORT_FORMAT;
  version: typeof EXPORT_VERSION;
  exportedAt: string; // ISO 8601
  notes: Note[];
  foods: FoodEntry[];
  foodTargets: FoodTargets;
}

export interface ImportBundle {
  notes: ImportableNote[];
  foods: ImportableFoodEntry[];
  foodTargets?: FoodTargets; // absent for v1 files and bare arrays
}

export class InvalidExportFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidExportFileError';
  }
}

export function buildExportFile(data: {
  notes: Note[];
  foods: FoodEntry[];
  foodTargets: FoodTargets;
}): ExportFileV2 {
  return {
    app: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    notes: data.notes,
    foods: data.foods,
    foodTargets: data.foodTargets,
  };
}

export function exportFileName(date = new Date()): string {
  return `tag-notes-export-${date.toISOString().slice(0, 10)}.json`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function parseNotes(entries: unknown[]): ImportableNote[] {
  return entries.map((entry, index) => {
    if (!isRecord(entry) || typeof entry['rawText'] !== 'string') {
      throw new InvalidExportFileError(`Note at index ${index} is missing "rawText".`);
    }

    return {
      id: optionalString(entry['id']),
      rawText: entry['rawText'],
      createdAt: optionalString(entry['createdAt']),
      updatedAt: optionalString(entry['updatedAt']),
    };
  });
}

const FOOD_NUMBER_FIELDS = ['quantity', 'protein', 'calories', 'carbs'] as const;

function parseFoods(entries: unknown[]): ImportableFoodEntry[] {
  return entries.map((entry, index) => {
    const invalid = (field: string, rule: string) =>
      new InvalidExportFileError(`Food at index ${index} has an invalid "${field}" (${rule}).`);

    if (!isRecord(entry)) {
      throw new InvalidExportFileError(`Food at index ${index} is not an object.`);
    }

    const name = entry['name'];
    if (typeof name !== 'string' || name.trim() === '') {
      throw invalid('name', 'expected a non-empty string');
    }

    const servingSize = entry['servingSize'];
    if (servingSize !== undefined && typeof servingSize !== 'string') {
      throw invalid('servingSize', 'expected a string');
    }

    const numbers = {} as Record<(typeof FOOD_NUMBER_FIELDS)[number], number>;
    for (const field of FOOD_NUMBER_FIELDS) {
      const value = entry[field];
      if (!isNonNegativeNumber(value)) {
        throw invalid(field, 'expected a number ≥ 0');
      }
      numbers[field] = value;
    }

    const date = entry['date'];
    if (typeof date !== 'string' || !DATE_KEY.test(date)) {
      throw invalid('date', 'expected YYYY-MM-DD');
    }

    const food: ImportableFoodEntry = {
      id: optionalString(entry['id']),
      name,
      ...numbers,
      date,
      createdAt: optionalString(entry['createdAt']),
    };
    if (servingSize !== undefined) food.servingSize = servingSize;
    return food;
  });
}

function parseFoodTargets(value: unknown): FoodTargets {
  if (
    !isRecord(value) ||
    !isNonNegativeNumber(value['protein']) ||
    !isNonNegativeNumber(value['calories'])
  ) {
    throw new InvalidExportFileError(
      '"foodTargets" must have "protein" and "calories" numbers ≥ 0.',
    );
  }
  return { protein: value['protein'], calories: value['calories'] };
}

/**
 * Parses and validates an exported (or hand-edited) JSON file. Accepts a v2
 * file (notes, foods, food targets), a v1 file (notes only) or a bare array
 * of notes. Ids and timestamps are passed through when present so the stores'
 * `importAll` can upsert by id.
 */
export function parseExportFile(json: string): ImportBundle {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new InvalidExportFileError('File is not valid JSON.');
  }

  if (Array.isArray(data)) {
    return { notes: parseNotes(data), foods: [] };
  }

  if (!isRecord(data) || !Array.isArray(data['notes'])) {
    throw new InvalidExportFileError('File does not contain a notes array.');
  }

  const bundle: ImportBundle = { notes: parseNotes(data['notes']), foods: [] };

  if (data['foods'] !== undefined) {
    if (!Array.isArray(data['foods'])) {
      throw new InvalidExportFileError('"foods" must be an array.');
    }
    bundle.foods = parseFoods(data['foods']);
  }

  if (data['foodTargets'] !== undefined) {
    bundle.foodTargets = parseFoodTargets(data['foodTargets']);
  }

  return bundle;
}
