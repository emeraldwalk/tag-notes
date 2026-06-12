import type { ImportableNote, Note } from './types';

export const EXPORT_FORMAT = 'tag-notes';
export const EXPORT_VERSION = 1;

export interface ExportFile {
  app: typeof EXPORT_FORMAT;
  version: typeof EXPORT_VERSION;
  exportedAt: string;
  notes: Note[];
}

export class InvalidExportFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidExportFileError';
  }
}

export function buildExportFile(notes: Note[]): ExportFile {
  return {
    app: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    notes,
  };
}

export function exportFileName(date = new Date()): string {
  return `tag-notes-export-${date.toISOString().slice(0, 10)}.json`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Parses and validates an exported (or hand-edited) JSON file into a list of
 * `ImportableNote`s. Accepts either the wrapped `ExportFile` shape produced
 * by `buildExportFile`, or a bare array of note-like objects. Only `rawText`
 * is required on each entry; `id`/`createdAt`/`updatedAt` are passed through
 * if present so `NoteStore.importAll` can upsert by `id`.
 */
export function parseExportFile(json: string): ImportableNote[] {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new InvalidExportFileError('File is not valid JSON.');
  }

  const entries = Array.isArray(data)
    ? data
    : isRecord(data) && Array.isArray(data['notes'])
      ? data['notes']
      : undefined;

  if (!entries) {
    throw new InvalidExportFileError('File does not contain a notes array.');
  }

  return entries.map((entry, index) => {
    if (!isRecord(entry) || typeof entry['rawText'] !== 'string') {
      throw new InvalidExportFileError(`Note at index ${index} is missing "rawText".`);
    }

    return {
      id: typeof entry['id'] === 'string' ? entry['id'] : undefined,
      rawText: entry['rawText'],
      createdAt: typeof entry['createdAt'] === 'string' ? entry['createdAt'] : undefined,
      updatedAt: typeof entry['updatedAt'] === 'string' ? entry['updatedAt'] : undefined,
    };
  });
}
