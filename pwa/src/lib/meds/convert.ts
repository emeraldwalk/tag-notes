import type { Medicine } from './types';
import type { Note } from '../notes/types';

/** The tag medicine notes were logged with. */
export const MEDS_TAG = 'meds';

/** `meds` notes that share a title (lowercased, trimmed): one choice of medicine converts them all. */
export interface NoteGroup {
  key: string;
  /** The title as written in the newest note. */
  title: string;
  notes: Note[];
  /** Oldest and newest `createdAt`. */
  first: string;
  last: string;
}

export const groupKey = (title: string) => title.trim().toLowerCase();

/** Groups notes by title, biggest groups first, then by title. */
export function groupMedsNotes(notes: Note[]): NoteGroup[] {
  const byKey = new Map<string, Note[]>();
  for (const note of notes) {
    const key = groupKey(note.title);
    const list = byKey.get(key);
    if (list) list.push(note);
    else byKey.set(key, [note]);
  }
  return [...byKey.entries()]
    .map(([key, list]) => {
      const sorted = [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      return { key, title: sorted[sorted.length - 1]!.title.trim(), notes: sorted, first: sorted[0]!.createdAt, last: sorted[sorted.length - 1]!.createdAt };
    })
    .sort((a, b) => b.notes.length - a.notes.length || a.key.localeCompare(b.key));
}

/** What a group converts into: an existing medicine, a new one named after the title, or nothing. */
export type GroupChoice = { kind: 'existing'; medicineId: string } | { kind: 'new' } | { kind: 'skip' };

/** The initial choice for a group: the medicine with the same name (any case), else a new one. */
export function defaultChoice(group: NoteGroup, medicines: Medicine[]): GroupChoice {
  const match = medicines.find((m) => groupKey(m.name) === group.key);
  return match ? { kind: 'existing', medicineId: match.id } : { kind: 'new' };
}

/** Notes per `convert-notes` request (the server takes at most 50). */
export const CONVERT_CHUNK = 50;

/** Splits `{ noteIds, medicineId }` groups into requests of at most `CONVERT_CHUNK` notes each. */
export function chunkGroups(groups: { noteIds: string[]; medicineId: string }[], size = CONVERT_CHUNK) {
  const pairs = groups.flatMap((g) => g.noteIds.map((noteId) => ({ noteId, medicineId: g.medicineId })));
  const requests: { noteIds: string[]; medicineId: string }[][] = [];
  for (let i = 0; i < pairs.length; i += size) {
    const part = new Map<string, string[]>();
    for (const { noteId, medicineId } of pairs.slice(i, i + size)) {
      const ids = part.get(medicineId);
      if (ids) ids.push(noteId);
      else part.set(medicineId, [noteId]);
    }
    requests.push([...part.entries()].map(([medicineId, noteIds]) => ({ noteIds, medicineId })));
  }
  return requests;
}
