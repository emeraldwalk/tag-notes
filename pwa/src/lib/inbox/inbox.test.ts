import { describe, expect, it } from 'vitest';
import { formatEntryTime } from './time';

describe('formatEntryTime', () => {
  const now = new Date(2026, 10, 25, 15, 0);

  it('shows only the time for today', () => {
    const iso = new Date(2026, 10, 25, 8, 5).toISOString();
    expect(formatEntryTime(iso, now)).toBe(new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }));
  });

  it('adds the day for earlier days, and the year for earlier years', () => {
    const yesterday = formatEntryTime(new Date(2026, 10, 24, 8, 5).toISOString(), now);
    expect(yesterday).toContain('24');
    expect(yesterday).not.toContain('2026');
    expect(formatEntryTime(new Date(2025, 10, 24, 8, 5).toISOString(), now)).toContain('2025');
  });
});
