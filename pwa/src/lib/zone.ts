// Shared with the Worker: keep this file free of browser APIs.

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export class UnknownTimeZoneError extends Error {
  constructor(timeZone: string) {
    super(`Unknown time zone "${timeZone}".`);
    this.name = 'UnknownTimeZoneError';
  }
}

/**
 * Converts local wall-clock times in an IANA zone to UTC with `Intl` (`new Date(string)` would use the runtime's own
 * zone). `candidates` returns the possible UTC instants (ms), earliest first: one normally, none in a spring-forward
 * gap, two in a fall-back hour. Offsets are cached per local hour; transitions are assumed to fall on whole hours
 * (true for US and EU zones). Throws `UnknownTimeZoneError` for a zone `Intl` doesn't know.
 */
export function createZoneConverter(timeZone: string) {
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
  } catch {
    throw new UnknownTimeZoneError(timeZone);
  }

  const offsetAt = (instant: number): number => {
    const p: Record<string, number> = {};
    for (const part of format.formatToParts(instant)) if (part.type !== 'literal') p[part.type] = Number(part.value);
    return Date.UTC(p.year!, p.month! - 1, p.day!, p.hour! % 24, p.minute!, p.second!) - Math.floor(instant / 1000) * 1000;
  };

  const byHour = new Map<number, number[]>();
  const hourOffsets = (wallHourMs: number): number[] => {
    const cached = byHour.get(wallHourMs);
    if (cached) return cached;
    const wall = wallHourMs + HOUR_MS / 2;
    const found: number[] = [];
    for (const offset of [offsetAt(wall - DAY_MS), offsetAt(wall + DAY_MS)]) {
      if (found.includes(offset)) continue;
      if (offsetAt(wall - offset) === offset) found.push(offset);
    }
    // A larger offset means an earlier instant for the same wall time.
    found.sort((a, b) => b - a);
    byHour.set(wallHourMs, found);
    return found;
  };

  return {
    /** UTC instants for a local time (`month` 1–12, `hour` 0–23), earliest first. */
    candidates(year: number, month: number, day: number, hour: number, minute: number): number[] {
      const wallHour = Date.UTC(year, month - 1, day, hour);
      return hourOffsets(wallHour).map((offset) => wallHour + minute * 60_000 - offset);
    },
  };
}
