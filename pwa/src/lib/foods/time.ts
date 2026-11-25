import { dateKey } from './targets';

/** `eatenAt` as a local clock time ("1:05 PM"); empty when unknown. */
export function formatEatenAt(eatenAt: string | undefined): string {
  if (!eatenAt) return '';
  return new Date(eatenAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** A local time as an `<input type="time">` value (HH:mm); empty when unknown. */
export function timeInputValue(eatenAt: string | Date | undefined): string {
  if (!eatenAt) return '';
  const d = typeof eatenAt === 'string' ? new Date(eatenAt) : eatenAt;
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** The local day (YYYY-MM-DD) plus a time field's HH:mm, as UTC ISO 8601; undefined if the time is empty or bad. */
export function eatenAtFrom(day: string, time: string): string | undefined {
  const t = /^(\d{2}):(\d{2})$/.exec(time);
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!t || !d) return undefined;
  const local = new Date(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]), Number(t[2]));
  return Number.isNaN(local.getTime()) ? undefined : local.toISOString();
}

/** The local day an `eatenAt` falls on. */
export const eatenDay = (eatenAt: string) => dateKey(new Date(eatenAt));
