import { describe, expect, it } from 'vitest';
import {
  buildExportFile,
  EXPORT_FORMAT,
  EXPORT_VERSION,
  exportFileName,
  InvalidExportFileError,
  parseExportFile,
} from './export';
import type { FoodTargets } from './foods/targets';
import type { FoodEntry } from './foods/types';
import type { Note } from './notes/types';

const note: Note = {
  id: 'abc-123',
  title: 'My Title',
  body: 'Some body',
  tags: ['foo'],
  rawText: 'My Title\n\nSome body\n\n:foo',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};

const importedNote = {
  id: note.id,
  rawText: note.rawText,
  createdAt: note.createdAt,
  updatedAt: note.updatedAt,
};

const foods: FoodEntry[] = [
  {
    id: 'food-1',
    name: 'Oats',
    servingSize: '1 cup',
    quantity: 1.5,
    protein: 5,
    calories: 150,
    carbs: 27,
    date: '2026-06-27',
    createdAt: '2026-06-27T08:00:00.000Z',
  },
  {
    id: 'food-2',
    name: 'Chicken',
    quantity: 1,
    protein: 30,
    calories: 165,
    carbs: 0,
    date: '2026-06-27',
    createdAt: '2026-06-27T12:00:00.000Z',
  },
];

const foodTargets: FoodTargets = { protein: 140, calories: 1800 };

function v2Json(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ ...buildExportFile({ notes: [note], foods, foodTargets }), ...overrides });
}

describe('buildExportFile', () => {
  it('wraps notes, foods and targets with app/version/exportedAt metadata', () => {
    const file = buildExportFile({ notes: [note], foods, foodTargets });

    expect(file.app).toBe(EXPORT_FORMAT);
    expect(file.app).toBe('tag-notes');
    expect(file.version).toBe(EXPORT_VERSION);
    expect(file.version).toBe(2);
    expect(file.notes).toEqual([note]);
    expect(file.foods).toEqual(foods);
    expect(file.foodTargets).toEqual(foodTargets);
    expect(() => new Date(file.exportedAt).toISOString()).not.toThrow();
  });
});

describe('exportFileName', () => {
  it('includes the date in YYYY-MM-DD form', () => {
    expect(exportFileName(new Date('2026-06-12T15:30:00.000Z'))).toBe(
      'tag-notes-export-2026-06-12.json',
    );
  });
});

describe('parseExportFile', () => {
  it('round-trips a v2 file: same notes, foods and targets', () => {
    const bundle = parseExportFile(v2Json());

    expect(bundle.notes).toEqual([importedNote]);
    expect(bundle.foods).toEqual(foods);
    expect(bundle.foods[1]).not.toHaveProperty('servingSize');
    expect(bundle.foodTargets).toEqual(foodTargets);
  });

  it('parses a v1 file: notes only, no foods or targets', () => {
    const json = JSON.stringify({
      app: 'tag-notes',
      version: 1,
      exportedAt: '2026-01-03T00:00:00.000Z',
      notes: [note],
    });
    const bundle = parseExportFile(json);

    expect(bundle.notes).toEqual([importedNote]);
    expect(bundle.foods).toEqual([]);
    expect(bundle.foodTargets).toBeUndefined();
  });

  it('parses a bare array of notes', () => {
    const bundle = parseExportFile(JSON.stringify([note]));

    expect(bundle).toEqual({ notes: [importedNote], foods: [] });
    expect(bundle.foodTargets).toBeUndefined();
  });

  it('allows notes with only rawText, leaving the rest undefined', () => {
    const json = JSON.stringify([{ rawText: 'Just a title' }]);
    expect(parseExportFile(json).notes).toEqual([
      { id: undefined, rawText: 'Just a title', createdAt: undefined, updatedAt: undefined },
    ]);
  });

  it('allows foods without id or createdAt', () => {
    const { id: _id, createdAt: _createdAt, ...bare } = foods[1];
    const bundle = parseExportFile(v2Json({ foods: [bare] }));
    expect(bundle.foods).toEqual([{ ...bare, id: undefined, createdAt: undefined }]);
  });

  it('throws InvalidExportFileError for invalid JSON', () => {
    expect(() => parseExportFile('not json')).toThrow(InvalidExportFileError);
  });

  it('throws InvalidExportFileError when there is no notes array', () => {
    expect(() => parseExportFile(JSON.stringify({ app: 'tag-notes' }))).toThrow(
      InvalidExportFileError,
    );
  });

  it('throws InvalidExportFileError when a note is missing rawText', () => {
    expect(() => parseExportFile(JSON.stringify([{ id: 'x' }]))).toThrow(InvalidExportFileError);
  });

  it('rejects a foods value that is not an array', () => {
    expect(() => parseExportFile(v2Json({ foods: {} }))).toThrow(InvalidExportFileError);
  });

  const invalidFoods: [field: string, value: unknown][] = [
    ['name', ''],
    ['name', '   '],
    ['name', 42],
    ['servingSize', 1],
    ['quantity', -1],
    ['quantity', '1'],
    ['protein', Number.NaN],
    ['protein', null],
    ['calories', -0.5],
    ['carbs', 'lots'],
    ['date', '2026-6-27'],
    ['date', '27/06/2026'],
    ['date', 20260627],
  ];

  it.each(invalidFoods)('rejects a food with an invalid %s (%j), naming index and field', (field, value) => {
    const bad = { ...foods[1], [field]: value };
    const parse = () => parseExportFile(v2Json({ foods: [foods[0], bad] }));

    expect(parse).toThrow(InvalidExportFileError);
    expect(parse).toThrow(`Food at index 1`);
    expect(parse).toThrow(`"${field}"`);
  });

  it('rejects a food with a missing number field', () => {
    const { carbs: _carbs, ...bad } = foods[0];
    const parse = () => parseExportFile(v2Json({ foods: [bad] }));
    expect(parse).toThrow('Food at index 0');
    expect(parse).toThrow('"carbs"');
  });

  it('rejects a food that is not an object', () => {
    expect(() => parseExportFile(v2Json({ foods: ['oats'] }))).toThrow('Food at index 0');
  });

  it.each([
    [{ protein: -1, calories: 2000 }],
    [{ protein: 150 }],
    [{ protein: 150, calories: 'many' }],
    [{ protein: Infinity, calories: 2000 }],
    ['targets'],
    [null],
  ])('rejects invalid foodTargets %j', (targets) => {
    expect(() => parseExportFile(v2Json({ foodTargets: targets }))).toThrow(
      InvalidExportFileError,
    );
  });
});
