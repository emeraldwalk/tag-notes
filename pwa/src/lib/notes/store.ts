import { api, ApiError } from '../api';
import type { Note, NoteStore } from './types';

/** The `NoteStore` over the Worker's `/api/notes` and `/api/tags`. The server parses `rawText`. */
export function createHttpNoteStore(): NoteStore {
  return {
    async list() {
      return (await api<{ notes: Note[] }>('/notes')).notes;
    },
    async get(id) {
      try {
        return (await api<{ note: Note }>(`/notes/${encodeURIComponent(id)}`)).note;
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return undefined;
        throw err;
      }
    },
    async create(rawText) {
      return (await api<{ note: Note }>('/notes', { method: 'POST', body: { rawText } })).note;
    },
    async update(id, rawText) {
      return (await api<{ note: Note }>(`/notes/${encodeURIComponent(id)}`, { method: 'PUT', body: { rawText } })).note;
    },
    async remove(id) {
      try {
        await api<void>(`/notes/${encodeURIComponent(id)}`, { method: 'DELETE' });
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return;
        throw err;
      }
    },
    async listTags() {
      return (await api<{ tags: string[] }>('/tags')).tags;
    },
    async listByTag(tag) {
      return (await api<{ notes: Note[] }>(`/notes?tag=${encodeURIComponent(tag.toLowerCase())}`)).notes;
    },
  };
}
