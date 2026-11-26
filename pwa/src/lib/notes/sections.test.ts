import { describe, expect, it } from 'vitest';
import { groupBySection, listDate, noteSection } from './sections';

const now = new Date(2026, 10, 25, 15, 0); // Wed Nov 25 2026, 3 PM local
const at = (y: number, m: number, d: number, h = 9) => new Date(y, m, d, h).toISOString();

describe('noteSection', () => {
  it('groups like iOS Notes', () => {
    expect(noteSection(at(2026, 10, 25), now).label).toBe('Today');
    expect(noteSection(at(2026, 10, 24, 23), now).label).toBe('Yesterday');
    expect(noteSection(at(2026, 10, 19), now).label).toBe('Previous 7 Days');
    expect(noteSection(at(2026, 10, 18), now).label).toBe('Previous 30 Days');
    expect(noteSection(at(2026, 9, 27), now).label).toBe('Previous 30 Days');
    expect(noteSection(at(2026, 9, 1), now).key).toBe('m9');
    expect(noteSection(at(2025, 11, 31), now)).toEqual({ key: 'y2025', label: '2025' });
  });
});

describe('listDate', () => {
  it('shows the time today and words or dates before', () => {
    expect(listDate(at(2026, 10, 25), now)).toMatch(/9:00/);
    expect(listDate(at(2026, 10, 24), now)).toBe('Yesterday');
    expect(listDate(at(2026, 10, 20), now)).not.toMatch(/\d/); // a weekday name
    expect(listDate(at(2026, 9, 1), now)).toMatch(/\d/);
  });
});

describe('groupBySection', () => {
  it('keeps order and merges consecutive items of one section', () => {
    const items = [at(2026, 10, 25), at(2026, 10, 25, 8), at(2026, 10, 24), at(2025, 1, 1)];
    expect(groupBySection(items, (i) => i, now).map((g) => [g.section.label, g.items.length])).toEqual([
      ['Today', 2],
      ['Yesterday', 1],
      ['2025', 1],
    ]);
  });
});
