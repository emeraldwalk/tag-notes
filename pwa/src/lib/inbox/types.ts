// Shared with the Worker (types only): keep this file free of browser APIs.

/** Mine to set: still to look at, handled (made a note, or logged elsewhere), or not worth keeping. */
export type RawEntryStatus = 'new' | 'done' | 'dismissed';

/** What a raw entry became in Tracker. Plan 10 adds more kinds. */
export type RawEntryOutcomeKind = 'note';

/** Text as received (the Inbox box, Siri, Home Assistant), word for word. `text` is never edited. */
export interface RawEntry {
  id: string;
  text: string;
  /** 'app' for the Inbox box, else the capture source's (token's) name when it was posted. */
  source: string;
  occurredAt: string; // UTC ISO 8601: when it was said
  receivedAt: string; // UTC ISO 8601: when the Worker got it
  status: RawEntryStatus;
  outcomeKind?: RawEntryOutcomeKind;
  outcomeId?: string;
  updatedAt: string;
}

/** A capture source's bearer token (`POST /api/ingest/text`). The secret is shown only when created. */
export interface IngestToken {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
}

/** `POST /api/ingest-tokens`: the token's details and its secret, shown once. */
export interface CreatedIngestToken {
  token: IngestToken;
  secret: string;
}

/** A raw entry read from an export file; missing `id` / `updatedAt` / `receivedAt` are filled in on import. */
export interface ImportableRawEntry {
  id?: string;
  text: string;
  source: string;
  occurredAt: string;
  receivedAt?: string;
  status: RawEntryStatus;
  outcomeKind?: RawEntryOutcomeKind;
  outcomeId?: string;
  updatedAt?: string;
}

/** Which entries `GET /api/raw-entries` lists. */
export type RawEntryFilter = RawEntryStatus | 'all';

export interface InboxStore {
  /** Newest `occurredAt` first (then by id); `before` pages back, `after` continues exactly after that entry. */
  list(filter: RawEntryFilter, page?: { after?: Pick<RawEntry, 'id' | 'occurredAt'>; limit?: number }): Promise<RawEntry[]>;
  countNew(): Promise<number>;
  create(text: string): Promise<RawEntry>;
  setStatus(id: string, status: RawEntryStatus): Promise<RawEntry>;
  /** Makes a note from the entry (at its time); the entry becomes done. */
  makeNote(id: string): Promise<{ noteId: string; entry: RawEntry }>;
  remove(id: string): Promise<void>;
  listTokens(): Promise<IngestToken[]>;
  createToken(name: string): Promise<CreatedIngestToken>;
  revokeToken(id: string): Promise<void>;
}
