import { describe, expect, it } from 'vitest';
import {
  buildExportFile,
  EXPORT_FORMAT,
  EXPORT_VERSION,
  exportFileName,
  InvalidExportFileError,
  parseExportFile,
} from './export';
import type { Note } from './types';

const note: Note = {
  id: 'abc-123',
  title: 'My Title',
  body: 'Some body',
  tags: ['foo'],
  rawText: 'My Title\n\nSome body\n\n:foo',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};

describe('buildExportFile', () => {
  it('wraps notes with app/version/exportedAt metadata', () => {
    const file = buildExportFile([note]);

    expect(file.app).toBe(EXPORT_FORMAT);
    expect(file.version).toBe(EXPORT_VERSION);
    expect(file.notes).toEqual([note]);
    expect(() => new Date(file.exportedAt).toISOString()).not.toThrow();
  });
});

describe('exportFileName', () => {
  it('includes the date in YYYY-MM-DD form', () => {
    expect(exportFileName(new Date('2026-06-12T15:30:00.000Z'))).toBe(
      'tag-notes-export-2026-06-12.json',
    );
  });
});

describe('parseExportFile', () => {
  it('parses a wrapped export file', () => {
    const json = JSON.stringify(buildExportFile([note]));
    expect(parseExportFile(json)).toEqual([
      { id: note.id, rawText: note.rawText, createdAt: note.createdAt, updatedAt: note.updatedAt },
    ]);
  });

  it('parses a bare array of notes', () => {
    const json = JSON.stringify([note]);
    expect(parseExportFile(json)).toEqual([
      { id: note.id, rawText: note.rawText, createdAt: note.createdAt, updatedAt: note.updatedAt },
    ]);
  });

  it('allows entries with only rawText, leaving the rest undefined', () => {
    const json = JSON.stringify([{ rawText: 'Just a title' }]);
    expect(parseExportFile(json)).toEqual([
      { id: undefined, rawText: 'Just a title', createdAt: undefined, updatedAt: undefined },
    ]);
  });

  it('throws InvalidExportFileError for invalid JSON', () => {
    expect(() => parseExportFile('not json')).toThrow(InvalidExportFileError);
  });

  it('throws InvalidExportFileError when there is no notes array', () => {
    expect(() => parseExportFile(JSON.stringify({ app: 'tag-notes' }))).toThrow(
      InvalidExportFileError,
    );
  });

  it('throws InvalidExportFileError when an entry is missing rawText', () => {
    expect(() => parseExportFile(JSON.stringify([{ id: 'x' }]))).toThrow(InvalidExportFileError);
  });
});
