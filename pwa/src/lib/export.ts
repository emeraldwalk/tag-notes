// Shared with the Worker (worker/src/import.ts and foods.ts validate with these): keep this file free of browser APIs
// and of imports other than types.
import type { FoodEntry, FoodTargets, ImportableFoodEntry } from './foods/types';
import type { ImportableRawEntry, RawEntry, RawEntryStatus } from './inbox/types';
import type { Dose, DoseSource, ImportableDose, ImportableMedicine, Medicine } from './meds/types';
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
  medicines: Medicine[]; // plan 16; absent in older files
  doses: Dose[];
  rawEntries: RawEntry[]; // plan 9; absent in older files
}

export interface ImportBundle {
  notes: ImportableNote[];
  foods: ImportableFoodEntry[];
  foodTargets?: FoodTargets; // absent for v1 files and bare arrays
  medicines: ImportableMedicine[]; // [] when the file has none
  doses: ImportableDose[];
  rawEntries: ImportableRawEntry[];
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
  medicines?: Medicine[];
  doses?: Dose[];
  rawEntries?: RawEntry[];
}): ExportFileV2 {
  return {
    app: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    notes: data.notes,
    foods: data.foods,
    foodTargets: data.foodTargets,
    medicines: data.medicines ?? [],
    doses: data.doses ?? [],
    rawEntries: data.rawEntries ?? [],
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

/** An ISO 8601 time with a zone (`Z` or `±hh:mm`), as `eatenAt` must be. */
export const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

export function isIsoWithZone(value: unknown): value is string {
  return typeof value === 'string' && ISO_WITH_ZONE.test(value) && !Number.isNaN(Date.parse(value));
}

/**
 * Validates one food entry (from a file, or a request body: `what` names it in messages, e.g. "Food at index 3").
 * `eatenAt` may be absent or null (unknown); when present it must be ISO 8601 with a zone.
 */
export function parseFoodEntry(entry: unknown, what: string): ImportableFoodEntry {
  const invalid = (field: string, rule: string) =>
    new InvalidExportFileError(`${what} has an invalid "${field}" (${rule}).`);

  if (!isRecord(entry)) {
    throw new InvalidExportFileError(`${what} is not an object.`);
  }

  const name = entry['name'];
  if (typeof name !== 'string' || name.trim() === '') {
    throw invalid('name', 'expected a non-empty string');
  }

  const servingSize = entry['servingSize'];
  if (servingSize !== undefined && servingSize !== null && typeof servingSize !== 'string') {
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

  const eatenAt = entry['eatenAt'];
  if (eatenAt !== undefined && eatenAt !== null && !isIsoWithZone(eatenAt)) {
    throw invalid('eatenAt', 'expected an ISO 8601 time with a zone');
  }

  const food: ImportableFoodEntry = {
    id: optionalString(entry['id']),
    name,
    ...numbers,
    date,
    createdAt: optionalString(entry['createdAt']),
  };
  if (typeof servingSize === 'string') food.servingSize = servingSize;
  if (typeof eatenAt === 'string') food.eatenAt = eatenAt;
  return food;
}

function parseFoods(entries: unknown[]): ImportableFoodEntry[] {
  return entries.map((entry, index) => parseFoodEntry(entry, `Food at index ${index}`));
}

export function parseFoodTargets(value: unknown): FoodTargets {
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

/** Longest medicine name or dose text accepted (free text, but not an essay). */
export const MAX_MEDICINE_TEXT = 200;

const DOSE_SOURCES: readonly DoseSource[] = ['tap', 'manual', 'note', 'voice', 'inbox'];

export function isDoseSource(value: unknown): value is DoseSource {
  return typeof value === 'string' && (DOSE_SOURCES as readonly string[]).includes(value);
}

/** A medicine name: trimmed, 1 to `MAX_MEDICINE_TEXT` characters; undefined when not. */
export function medicineName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const name = value.trim();
  return name.length > 0 && name.length <= MAX_MEDICINE_TEXT ? name : undefined;
}

/** Validates one medicine from a file (`what` names it in messages, e.g. "Medicine at index 0"). */
export function parseMedicine(entry: unknown, what: string): ImportableMedicine {
  const invalid = (field: string, rule: string) =>
    new InvalidExportFileError(`${what} has an invalid "${field}" (${rule}).`);
  if (!isRecord(entry)) throw new InvalidExportFileError(`${what} is not an object.`);

  const name = medicineName(entry['name']);
  if (name === undefined) throw invalid('name', `expected 1–${MAX_MEDICINE_TEXT} characters`);
  const defaultDose = entry['defaultDose'];
  if (defaultDose !== undefined && defaultDose !== null && (typeof defaultDose !== 'string' || defaultDose.length > MAX_MEDICINE_TEXT)) {
    throw invalid('defaultDose', 'expected a string');
  }
  const active = entry['active'];
  if (active !== undefined && typeof active !== 'boolean') throw invalid('active', 'expected true or false');
  const sortOrder = entry['sortOrder'];
  if (sortOrder !== undefined && !Number.isInteger(sortOrder)) throw invalid('sortOrder', 'expected an integer');

  const medicine: ImportableMedicine = {
    id: optionalString(entry['id']),
    name,
    active: active ?? true,
    sortOrder: (sortOrder as number | undefined) ?? 0,
    createdAt: optionalString(entry['createdAt']),
  };
  if (typeof defaultDose === 'string' && defaultDose.trim() !== '') medicine.defaultDose = defaultDose.trim();
  return medicine;
}

/** Validates one dose from a file. */
export function parseDose(entry: unknown, what: string): ImportableDose {
  const invalid = (field: string, rule: string) =>
    new InvalidExportFileError(`${what} has an invalid "${field}" (${rule}).`);
  if (!isRecord(entry)) throw new InvalidExportFileError(`${what} is not an object.`);

  const name = medicineName(entry['medicineName']);
  if (name === undefined) throw invalid('medicineName', `expected 1–${MAX_MEDICINE_TEXT} characters`);
  const takenAt = entry['takenAt'];
  if (!isIsoWithZone(takenAt)) throw invalid('takenAt', 'expected an ISO 8601 time with a zone');
  const source = entry['source'];
  if (!isDoseSource(source)) throw invalid('source', `expected one of ${DOSE_SOURCES.join(', ')}`);
  for (const field of ['medicineId', 'dose', 'note'] as const) {
    const value = entry[field];
    if (value !== undefined && value !== null && typeof value !== 'string') throw invalid(field, 'expected a string');
  }
  const dose = entry['dose'];
  if (typeof dose === 'string' && dose.length > MAX_MEDICINE_TEXT) throw invalid('dose', `expected at most ${MAX_MEDICINE_TEXT} characters`);

  const result: ImportableDose = {
    id: optionalString(entry['id']),
    medicineName: name,
    takenAt,
    source,
    createdAt: optionalString(entry['createdAt']),
  };
  const medicineId = optionalString(entry['medicineId']);
  if (medicineId) result.medicineId = medicineId;
  if (typeof dose === 'string' && dose.trim() !== '') result.dose = dose.trim();
  const note = optionalString(entry['note']);
  if (note) result.note = note;
  return result;
}

/** Longest raw entry text (plan 9), and longest capture source name kept on an entry. */
export const MAX_RAW_ENTRY_TEXT = 4000;
const MAX_RAW_ENTRY_SOURCE = 40;
const RAW_ENTRY_STATUSES: readonly RawEntryStatus[] = ['new', 'done', 'dismissed'];

/** Validates one raw entry from a file. */
export function parseRawEntry(entry: unknown, what: string): ImportableRawEntry {
  const invalid = (field: string, rule: string) =>
    new InvalidExportFileError(`${what} has an invalid "${field}" (${rule}).`);
  if (!isRecord(entry)) throw new InvalidExportFileError(`${what} is not an object.`);

  const text = entry['text'];
  if (typeof text !== 'string' || text.trim() === '' || text.length > MAX_RAW_ENTRY_TEXT) {
    throw invalid('text', `expected 1–${MAX_RAW_ENTRY_TEXT} characters`);
  }
  const source = entry['source'];
  if (typeof source !== 'string' || source.trim() === '' || source.length > MAX_RAW_ENTRY_SOURCE) {
    throw invalid('source', `expected 1–${MAX_RAW_ENTRY_SOURCE} characters`);
  }
  const occurredAt = entry['occurredAt'];
  if (!isIsoWithZone(occurredAt)) throw invalid('occurredAt', 'expected an ISO 8601 time with a zone');
  const receivedAt = entry['receivedAt'];
  if (receivedAt !== undefined && !isIsoWithZone(receivedAt)) throw invalid('receivedAt', 'expected an ISO 8601 time with a zone');
  const status = entry['status'] ?? 'new';
  if (typeof status !== 'string' || !(RAW_ENTRY_STATUSES as readonly string[]).includes(status)) {
    throw invalid('status', `expected one of ${RAW_ENTRY_STATUSES.join(', ')}`);
  }
  const outcomeKind = entry['outcomeKind'];
  if (outcomeKind !== undefined && outcomeKind !== null && outcomeKind !== 'note' && outcomeKind !== 'proposals') {
    throw invalid('outcomeKind', 'expected "note" or "proposals"');
  }
  const outcomeId = entry['outcomeId'];
  if (outcomeId !== undefined && outcomeId !== null && typeof outcomeId !== 'string') throw invalid('outcomeId', 'expected a string');

  const result: ImportableRawEntry = {
    id: optionalString(entry['id']),
    text,
    source,
    occurredAt,
    status: status as RawEntryStatus,
    updatedAt: optionalString(entry['updatedAt']),
  };
  if (typeof receivedAt === 'string') result.receivedAt = receivedAt;
  if ((outcomeKind === 'note' || outcomeKind === 'proposals') && typeof outcomeId === 'string' && outcomeId !== '') {
    result.outcomeKind = outcomeKind;
    result.outcomeId = outcomeId;
  }
  return result;
}

function parseArray<T>(data: Record<string, unknown>, key: string, what: string, parse: (entry: unknown, what: string) => T): T[] {
  const value = data[key];
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new InvalidExportFileError(`"${key}" must be an array.`);
  return value.map((entry, index) => parse(entry, `${what} at index ${index}`));
}

/**
 * Parses and validates an exported (or hand-edited) JSON file. Accepts a v2
 * file (notes, foods, food targets; medicines and doses since plan 16; raw entries since plan 9), a v1 file (notes only) or a bare array
 * of notes. Ids and timestamps are passed through when present so the server's
 * import can upsert by id.
 */
export function parseExportFile(json: string): ImportBundle {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new InvalidExportFileError('File is not valid JSON.');
  }

  if (Array.isArray(data)) {
    return { notes: parseNotes(data), foods: [], medicines: [], doses: [], rawEntries: [] };
  }

  if (!isRecord(data) || !Array.isArray(data['notes'])) {
    throw new InvalidExportFileError('File does not contain a notes array.');
  }

  const bundle: ImportBundle = {
    notes: parseNotes(data['notes']),
    foods: [],
    medicines: parseArray(data, 'medicines', 'Medicine', parseMedicine),
    doses: parseArray(data, 'doses', 'Dose', parseDose),
    rawEntries: parseArray(data, 'rawEntries', 'Raw entry', parseRawEntry),
  };

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
