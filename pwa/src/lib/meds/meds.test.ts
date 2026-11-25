import { describe, expect, it } from 'vitest';
import type { Note } from '../notes/types';
import { chunkGroups, defaultChoice, groupMedsNotes } from './convert';
import { fromLocalInput, historyRange, localInputValue, MAX_RANGE_DAYS, todayRange } from './time';

const note = (id: string, title: string, createdAt: string): Note => ({
  id,
  title,
  body: '',
  tags: ['meds'],
  rawText: `${title}\n\n:meds`,
  createdAt,
  updatedAt: createdAt,
});

describe('groupMedsNotes', () => {
  it('groups by lowercased, trimmed title, biggest first, with the date range', () => {
    const groups = groupMedsNotes([
      note('a', 'Metformin', '2026-11-02T10:00:00.000Z'),
      note('b', 'vitamin d', '2026-11-03T10:00:00.000Z'),
      note('c', ' metformin ', '2026-11-01T10:00:00.000Z'),
      note('d', 'METFORMIN', '2026-11-04T10:00:00.000Z'),
    ]);
    expect(groups.map((g) => [g.key, g.title, g.notes.map((n) => n.id), g.first, g.last])).toEqual([
      ['metformin', 'METFORMIN', ['c', 'a', 'd'], '2026-11-01T10:00:00.000Z', '2026-11-04T10:00:00.000Z'],
      ['vitamin d', 'vitamin d', ['b'], '2026-11-03T10:00:00.000Z', '2026-11-03T10:00:00.000Z'],
    ]);
  });

  it('picks the medicine of the same name, else a new one', () => {
    const [group] = groupMedsNotes([note('a', 'metformin', '2026-11-02T10:00:00.000Z')]);
    const medicine = { id: 'm1', name: 'Metformin ', active: true, sortOrder: 0, createdAt: '' };
    expect(defaultChoice(group!, [medicine])).toEqual({ kind: 'existing', medicineId: 'm1' });
    expect(defaultChoice(group!, [])).toEqual({ kind: 'new' });
  });
});

describe('chunkGroups', () => {
  it('splits requests by note count, keeping groups together within a request', () => {
    const requests = chunkGroups(
      [
        { noteIds: ['a', 'b', 'c'], medicineId: 'm1' },
        { noteIds: ['d', 'e'], medicineId: 'm2' },
      ],
      2,
    );
    expect(requests).toEqual([
      [{ noteIds: ['a', 'b'], medicineId: 'm1' }],
      [
        { noteIds: ['c'], medicineId: 'm1' },
        { noteIds: ['d'], medicineId: 'm2' },
      ],
      [{ noteIds: ['e'], medicineId: 'm2' }],
    ]);
    expect(chunkGroups([])).toEqual([]);
  });
});

describe('dose times', () => {
  it('round-trips datetime-local values', () => {
    const iso = fromLocalInput('2026-11-24T08:05')!;
    expect(localInputValue(iso)).toBe('2026-11-24T08:05');
    expect(new Date(iso).getHours()).toBe(8);
    expect(fromLocalInput('')).toBeUndefined();
    expect(fromLocalInput('8:05')).toBeUndefined();
  });

  it('makes local day and History ranges the server accepts', () => {
    const now = new Date(2026, 10, 24, 15, 30);
    const today = todayRange(now);
    expect(new Date(today.from)).toEqual(new Date(2026, 10, 24));
    expect(new Date(today.to)).toEqual(new Date(2026, 10, 25));

    const first = historyRange(0, now);
    const second = historyRange(1, now);
    expect(first.to).toBe(today.to);
    expect(second.to).toBe(first.from);
    expect(Date.parse(first.to) - Date.parse(first.from)).toBe(MAX_RANGE_DAYS * 24 * 3600 * 1000);
  });
});
