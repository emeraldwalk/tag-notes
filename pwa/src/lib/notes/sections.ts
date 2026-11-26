/** Date groups and row dates for the Notes list, as iOS Notes and Mail show them. Pure (no DOM). */

const DAY_MS = 24 * 60 * 60 * 1000;

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** Whole local days from `d` to `now` (0 = today). */
function daysAgo(d: Date, now: Date): number {
  return Math.round((startOfDay(now).getTime() - startOfDay(d).getTime()) / DAY_MS);
}

export interface NoteSection {
  /** Stable for grouping (notes in order fall into consecutive sections). */
  key: string;
  label: string;
}

/** Today, Yesterday, Previous 7 Days, Previous 30 Days, then the month (this year) or the year. */
export function noteSection(iso: string, now = new Date()): NoteSection {
  const d = new Date(iso);
  const ago = daysAgo(d, now);
  if (ago <= 0) return { key: 'today', label: 'Today' };
  if (ago === 1) return { key: 'yesterday', label: 'Yesterday' };
  if (ago < 7) return { key: '7d', label: 'Previous 7 Days' };
  if (ago < 30) return { key: '30d', label: 'Previous 30 Days' };
  if (d.getFullYear() === now.getFullYear()) {
    return { key: `m${d.getMonth()}`, label: d.toLocaleDateString(undefined, { month: 'long' }) };
  }
  return { key: `y${d.getFullYear()}`, label: String(d.getFullYear()) };
}

/** A row's date: the time today, "Yesterday", the weekday this week, else a short date (like Mail). */
export function listDate(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const ago = daysAgo(d, now);
  if (ago <= 0) return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (ago === 1) return 'Yesterday';
  if (ago < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
  return d.toLocaleDateString(undefined, { year: '2-digit', month: 'numeric', day: 'numeric' });
}

/** Splits items (newest first) into consecutive sections by `noteSection` of `when(item)`. */
export function groupBySection<T>(items: T[], when: (item: T) => string, now = new Date()): { section: NoteSection; items: T[] }[] {
  const groups: { section: NoteSection; items: T[] }[] = [];
  for (const item of items) {
    const section = noteSection(when(item), now);
    const last = groups.at(-1);
    if (last && last.section.key === section.key) last.items.push(item);
    else groups.push({ section, items: [item] });
  }
  return groups;
}
