import { dateKey } from '../foods/targets';

const DAY_MS = 24 * 60 * 60 * 1000;
/** The longest range `GET /api/doses` answers. */
export const MAX_RANGE_DAYS = 92;

/** A UTC ISO time as an `<input type="datetime-local">` value (local `YYYY-MM-DDTHH:mm`). */
export function localInputValue(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** An `<input type="datetime-local">` value as UTC ISO 8601; undefined when empty or bad. */
export function fromLocalInput(value: string): string | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!m) return undefined;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** Local midnight of `date`'s day. */
export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Today in local time, as a `listDoses` range. */
export function todayRange(now = new Date()): { from: string; to: string } {
  const start = startOfDay(now);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
  return { from: start.toISOString(), to: end.toISOString() };
}

/** The `page`th window of History, newest first: page 0 ends at the end of today (local); each spans `MAX_RANGE_DAYS` days. */
export function historyRange(page: number, now = new Date()): { from: string; to: string } {
  const end = Date.parse(todayRange(now).to) - page * MAX_RANGE_DAYS * DAY_MS;
  return { from: new Date(end - MAX_RANGE_DAYS * DAY_MS).toISOString(), to: new Date(end).toISOString() };
}

/** The local day (YYYY-MM-DD) a dose was taken on. */
export const takenDay = (takenAt: string) => dateKey(new Date(takenAt));

/** A dose's time as a local clock time ("8:05 AM"). */
export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** A local day key as "Tue, Nov 24". */
export function formatDay(day: string): string {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  return new Date(year, month - 1, date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

/** A local day key as "Today", "Yesterday", or "Tue, Nov 24" (section headers in the Meds log). */
export function dayLabel(day: string, now = new Date()): string {
  if (day === dateKey(now)) return 'Today';
  if (day === dateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))) return 'Yesterday';
  return formatDay(day);
}
