export interface ParsedNote {
  title: string;
  body: string; // full text minus the trailing tag line, trimmed
  tags: string[]; // lowercased, trimmed, de-duplicated; [] if none
}

export interface Note extends ParsedNote {
  id: string; // generated, e.g. crypto.randomUUID()
  rawText: string; // exactly what the user typed, unmodified
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

export interface NoteStore {
  list(): Promise<Note[]>;
  get(id: string): Promise<Note | undefined>;
  create(rawText: string): Promise<Note>;
  update(id: string, rawText: string): Promise<Note>;
  remove(id: string): Promise<void>;
  listTags(): Promise<string[]>; // distinct tags across all notes, sorted
  listByTag(tag: string): Promise<Note[]>;
}
