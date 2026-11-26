/**
 * Plan 17: LibreView's "Download Glucose Data" CSV, parsed in the browser (the Worker's free plan has 10 ms of CPU).
 *
 * Line 1 is metadata (`Glucose Data,Generated on,…`), line 2 the headers. Columns are found by header name.
 * `Device Timestamp` is the phone's local time (`MM-DD-YYYY hh:mm AM|PM`, no zone), converted to UTC in `timeZone`.
 */

import { createZoneConverter, UnknownTimeZoneError } from '../zone';

export type CsvReadingKind = 'historic' | 'scan';

export interface CsvReading {
  /** UTC, ISO 8601 with Z, to the second. */
  ts: string;
  mgDl: number;
  kind: CsvReadingKind;
}

export interface ParsedGlucoseCsv {
  /** Sorted by ts, one per ts. */
  readings: CsvReading[];
  historic: number;
  scans: number;
  /** Rows of type 0/1 not used: a bad value, a local time that doesn't exist, or a scan at a historic reading's time. */
  skipped: number;
  /** Rows of other record types (insulin, food, events). */
  ignored: number;
  first: string | null;
  last: string | null;
}

export class InvalidGlucoseCsvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidGlucoseCsvError';
  }
}

const COLUMNS = {
  time: 'Device Timestamp',
  type: 'Record Type',
  historic: 'Historic Glucose mg/dL',
  scan: 'Scan Glucose mg/dL',
} as const;

const TIMESTAMP = /^(\d{2})-(\d{2})-(\d{4}) (\d{2}):(\d{2}) (AM|PM)$/;
const MIN_MG_DL = 20;
const MAX_MG_DL = 600;
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

/** Parses a LibreView CSV export. Throws `InvalidGlucoseCsvError` for a file it can't read. */
export function parseLibreViewCsv(text: string, timeZone: string): ParsedGlucoseCsv {
  let zone: ReturnType<typeof createZoneConverter>;
  try {
    zone = createZoneConverter(timeZone);
  } catch (err) {
    if (err instanceof UnknownTimeZoneError) throw new InvalidGlucoseCsvError(err.message);
    throw err;
  }

  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  if (!lines[0]?.startsWith('Glucose Data')) {
    throw new InvalidGlucoseCsvError('This is not a LibreView glucose export (the first line should start with "Glucose Data").');
  }
  const headers = (lines[1] ?? '').split(',').map((h) => h.trim());
  if (headers.some((h) => /^(Historic|Scan) Glucose mmol\/L$/.test(h))) {
    throw new InvalidGlucoseCsvError('This export is in mmol/L. Set LibreView to mg/dL and download it again.');
  }
  const col = {} as Record<keyof typeof COLUMNS, number>;
  for (const [key, name] of Object.entries(COLUMNS) as [keyof typeof COLUMNS, string][]) {
    const at = headers.indexOf(name);
    if (at < 0) throw new InvalidGlucoseCsvError(`The export has no "${name}" column.`);
    col[key] = at;
  }

  const seen = new Map<string, number>();
  const byTs = new Map<string, CsvReading>();
  let skipped = 0;
  let ignored = 0;

  for (let i = 2; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === '') continue;
    const cells = line.split(',');
    const type = cells[col.type]?.trim();
    const kind: CsvReadingKind | null = type === '0' ? 'historic' : type === '1' ? 'scan' : null;
    if (!kind) {
      ignored++;
      continue;
    }

    const stamp = cells[col.time]?.trim() ?? '';
    const m = TIMESTAMP.exec(stamp);
    if (!m) throw new InvalidGlucoseCsvError(`Line ${i + 1}: the time "${stamp}" isn't MM-DD-YYYY hh:mm AM/PM.`);

    const raw = cells[kind === 'historic' ? col.historic : col.scan]?.trim() ?? '';
    const mgDl = /^\d+$/.test(raw) ? Number(raw) : NaN;
    if (!(mgDl >= MIN_MG_DL && mgDl <= MAX_MG_DL)) {
      skipped++;
      continue;
    }

    const hour12 = Number(m[4]);
    const hour = (hour12 % 12) + (m[6] === 'PM' ? 12 : 0);
    const instants = zone.candidates(Number(m[3]), Number(m[1]), Number(m[2]), hour, Number(m[5]));
    if (instants.length === 0) {
      skipped++;
      continue;
    }

    // In a fall-back hour the same local time comes twice: the nth row gets the nth instant (a guess; see plan 17).
    const key = `${stamp}|${kind}`;
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    const ts = iso(instants[Math.min(n, instants.length - 1)]!);

    // One reading per ts (the table's key has no kind): a historic reading wins over a scan at the same minute.
    const existing = byTs.get(ts);
    if (existing) {
      if (existing.kind === 'scan' && kind === 'historic') byTs.set(ts, { ts, mgDl, kind });
      skipped++;
      continue;
    }
    byTs.set(ts, { ts, mgDl, kind });
  }

  const readings = [...byTs.values()].sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  const historic = readings.filter((r) => r.kind === 'historic').length;
  return {
    readings,
    historic,
    scans: readings.length - historic,
    skipped,
    ignored,
    first: readings[0]?.ts ?? null,
    last: readings.at(-1)?.ts ?? null,
  };
}
