// Shared with the Worker (types only): keep this file free of browser APIs.

/** Mine to set: still to look at, handled (made a note, or logged elsewhere), or not worth keeping. */
export type RawEntryStatus = 'new' | 'done' | 'dismissed';

/** What a raw entry became in Tracker: a note (the Note button), or accepted proposals (plan 10; `outcomeId` is the run). */
export type RawEntryOutcomeKind = 'note' | 'proposals';

/**
 * What the parse agent (plan 10) proposes. A `known` food is one of mine, its numbers copied from my latest entry of
 * it; a `new` food has no numbers until I add them ("Needs numbers"). Times are the ones captured from the entry.
 */
export type ProposalData =
  | {
      kind: 'food';
      status: 'known';
      name: string;
      servingSize?: string;
      quantity: number;
      protein: number;
      calories: number;
      carbs: number;
      eatenAt: string;
    }
  | { kind: 'food'; status: 'new'; name: string; quantity: number; eatenAt: string }
  | { kind: 'dose'; medicineId?: string; medicineName: string; dose?: string; takenAt: string }
  | { kind: 'note'; text: string };

export type ProposalKind = ProposalData['kind'];
export type ProposalStatus = 'proposed' | 'accepted' | 'rejected';

export interface Proposal {
  id: string;
  status: ProposalStatus;
  /** The food entry, dose or note made when accepted. */
  outcomeId?: string;
  data: ProposalData;
}

/** An entry's latest parse run. */
export interface EntryParse {
  runId: string;
  status: 'running' | 'done' | 'failed';
  /** A `PARSE_MODELS` id. */
  model: string;
  error?: string;
  startedAt: string;
  /** Empty unless done. */
  proposals: Proposal[];
}

/** What accepting a food proposal may send: required for a `new` food, optional edits for a `known` one. */
export interface FoodNumbers {
  name: string;
  servingSize?: string;
  quantity: number;
  protein: number;
  calories: number;
  carbs: number;
}

/** `GET /api/parse/models`. */
export interface ParseModelInfo {
  id: string;
  provider: string;
  model: string;
  available: boolean;
}

/** `POST /api/parse/try`: one model's answer for a text, saved nowhere. */
export interface ParseTryResult {
  model: string;
  modelRef: string;
  ms: number;
  inputTokens?: number;
  outputTokens?: number;
  output?: string;
  proposals: ProposalData[];
  error?: string;
}

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
  /** The latest parse (plan 10); absent = never parsed. Not in export files. */
  parse?: EntryParse;
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
  /** Parses (or re-parses) the entry now, with a model id or the default; resolves when the run ends. */
  parse(id: string, model?: string): Promise<RawEntry>;
  /** Accepts a proposal; a `new` food needs `food`. The entry comes back with its latest parse. */
  acceptProposal(id: string, food?: FoodNumbers): Promise<{ proposal: Proposal; entry: RawEntry }>;
  rejectProposal(id: string): Promise<{ proposal: Proposal; entry: RawEntry }>;
  remove(id: string): Promise<void>;
  listTokens(): Promise<IngestToken[]>;
  createToken(name: string): Promise<CreatedIngestToken>;
  revokeToken(id: string): Promise<void>;
}
