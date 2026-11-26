import { api, ApiError } from '../api';
import type { CreatedIngestToken, InboxStore, IngestToken, ParseModelInfo, ParseTryResult, Proposal, RawEntry } from './types';

const path = (base: string, id: string) => `${base}/${encodeURIComponent(id)}`;

async function ignoreNotFound(call: Promise<unknown>): Promise<void> {
  try {
    await call;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return;
    throw err;
  }
}

/** The `InboxStore` over the Worker's `/api/raw-entries` and `/api/ingest-tokens` (plan 9). */
export function createHttpInboxStore(): InboxStore {
  return {
    async list(filter, page = {}) {
      const query = new URLSearchParams({ status: filter });
      if (page.after) {
        query.set('before', page.after.occurredAt);
        query.set('beforeId', page.after.id);
      }
      if (page.limit) query.set('limit', String(page.limit));
      return (await api<{ entries: RawEntry[] }>(`/raw-entries?${query}`)).entries;
    },
    async countNew() {
      return (await api<{ new: number }>('/raw-entries/count')).new;
    },
    async create(text) {
      return (await api<{ entry: RawEntry }>('/raw-entries', { method: 'POST', body: { text } })).entry;
    },
    async setStatus(id, status) {
      return (await api<{ entry: RawEntry }>(path('/raw-entries', id), { method: 'PUT', body: { status } })).entry;
    },
    async makeNote(id) {
      const result = await api<{ note: { id: string }; entry: RawEntry }>(`${path('/raw-entries', id)}/note`, { method: 'POST' });
      return { noteId: result.note.id, entry: result.entry };
    },
    remove(id) {
      return ignoreNotFound(api<void>(path('/raw-entries', id), { method: 'DELETE' }));
    },
    async parse(id, model) {
      const body = model ? { model } : {};
      return (await api<{ entry: RawEntry }>(`${path('/raw-entries', id)}/parse`, { method: 'POST', body })).entry;
    },
    acceptProposal(id, food) {
      return api<{ proposal: Proposal; entry: RawEntry }>(`${path('/proposals', id)}/accept`, { method: 'POST', body: food ? { food } : {} });
    },
    rejectProposal(id) {
      return api<{ proposal: Proposal; entry: RawEntry }>(`${path('/proposals', id)}/reject`, { method: 'POST', body: {} });
    },
    async listTokens() {
      return (await api<{ tokens: IngestToken[] }>('/ingest-tokens')).tokens;
    },
    createToken(name) {
      return api<CreatedIngestToken>('/ingest-tokens', { method: 'POST', body: { name } });
    },
    revokeToken(id) {
      return ignoreNotFound(api<void>(path('/ingest-tokens', id), { method: 'DELETE' }));
    },
  };
}

/** Every raw entry, any status, newest first (Export All), paging back through the list. */
export async function listAllRawEntries(store: InboxStore, pageSize = 200): Promise<RawEntry[]> {
  const all: RawEntry[] = [];
  for (;;) {
    const page = await store.list('all', { after: all.at(-1), limit: pageSize });
    all.push(...page);
    if (page.length < pageSize) return all;
  }
}

/** Plan 10: the parse models (`GET /api/parse/models`). */
export const listParseModels = () => api<{ models: ParseModelInfo[]; default: string }>('/parse/models');

/** Plan 10: one model's proposals for a text, saved nowhere (`POST /api/parse/try`). */
export const tryParse = (text: string, model: string) => api<ParseTryResult>('/parse/try', { method: 'POST', body: { text, model } });
