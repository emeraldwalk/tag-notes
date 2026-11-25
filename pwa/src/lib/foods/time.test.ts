import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eatenAtFrom, eatenDay, formatEatenAt, timeInputValue } from './time';

// Node re-reads TZ when it is set, so local times below are Chicago's.
beforeEach(() => {
  vi.stubEnv('TZ', 'America/Chicago');
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('meal time helpers', () => {
  it('turns a local day and time into UTC', () => {
    expect(eatenAtFrom('2026-11-24', '19:30')).toBe('2026-11-25T01:30:00.000Z');
    expect(eatenAtFrom('2026-11-24', '')).toBeUndefined();
    expect(eatenAtFrom('bad', '10:00')).toBeUndefined();
  });

  it('shows a UTC time as local', () => {
    expect(timeInputValue('2026-11-25T01:30:00.000Z')).toBe('19:30');
    expect(timeInputValue(undefined)).toBe('');
    expect(eatenDay('2026-11-25T01:30:00.000Z')).toBe('2026-11-24');
    expect(formatEatenAt('2026-11-25T01:30:00.000Z')).toMatch(/7:30/);
    expect(formatEatenAt(undefined)).toBe('');
  });
});
