import { describe, expect, it } from 'vitest';
import { parseNoteText, serializeNote } from './parse';

describe('parseNoteText', () => {
  it('returns empty fields for an empty string', () => {
    expect(parseNoteText('')).toEqual({ title: '', body: '', tags: [] });
  });

  it('returns empty fields when every line is empty/whitespace', () => {
    expect(parseNoteText('\n   \n\t\n')).toEqual({
      title: '',
      body: '',
      tags: [],
    });
  });

  it('handles only a title, no body, no tags', () => {
    expect(parseNoteText('My Title')).toEqual({
      title: 'My Title',
      body: '',
      tags: [],
    });
  });

  it('handles title + body, no tag line', () => {
    const raw = 'My Title\n\nThis is the body.\nMore body text.';
    expect(parseNoteText(raw)).toEqual({
      title: 'My Title',
      body: 'This is the body.\nMore body text.',
      tags: [],
    });
  });

  it('handles title + body + tag line', () => {
    const raw = 'some title\n\nbody of note\n\npotential multi-lines, etc.\n\n:tag 1, tag 2, tag-three';
    expect(parseNoteText(raw)).toEqual({
      title: 'some title',
      body: 'body of note\n\npotential multi-lines, etc.',
      tags: ['tag 1', 'tag 2', 'tag-three'],
    });
  });

  it('handles title + tag line only (no body) with empty string body, not whitespace', () => {
    const raw = 'My Title\n\n:foo, bar';
    const result = parseNoteText(raw);
    expect(result.title).toBe('My Title');
    expect(result.body).toBe('');
    expect(result.tags).toEqual(['foo', 'bar']);
  });

  it('does not treat a line starting with ":" as a tag line unless it is the last line', () => {
    const raw = 'My Title\n\n:not a tag line\nactual body content';
    expect(parseNoteText(raw)).toEqual({
      title: 'My Title',
      body: ':not a tag line\nactual body content',
      tags: [],
    });
  });

  it('treats a last line of exactly ":" as an empty tag line, stripped from body', () => {
    const raw = 'My Title\n\nbody text\n:';
    expect(parseNoteText(raw)).toEqual({
      title: 'My Title',
      body: 'body text',
      tags: [],
    });
  });

  it('trims extra whitespace around comma-separated tags', () => {
    const raw = 'Title\n\nbody\n: a ,  b ,c';
    expect(parseNoteText(raw)).toEqual({
      title: 'Title',
      body: 'body',
      tags: ['a', 'b', 'c'],
    });
  });

  it('dedupes tags case-insensitively and lowercases them', () => {
    const raw = 'Title\n\nbody\n:foo, foo, FOO';
    expect(parseNoteText(raw)).toEqual({
      title: 'Title',
      body: 'body',
      tags: ['foo'],
    });
  });

  it('is robust to trailing newlines after the tag line', () => {
    const raw = 'Title\n\nbody\n:foo, bar\n\n\n';
    expect(parseNoteText(raw)).toEqual({
      title: 'Title',
      body: 'body',
      tags: ['foo', 'bar'],
    });
  });

  it('is robust to trailing blank lines before a tag line', () => {
    const raw = 'Title\n\nbody\n\n\n:foo, bar';
    expect(parseNoteText(raw)).toEqual({
      title: 'Title',
      body: 'body',
      tags: ['foo', 'bar'],
    });
  });

  it('preserves internal spacing within a tag (only trims surrounding whitespace)', () => {
    const raw = 'Title\n\nbody\n:tag 1, tag 2, tag-three';
    expect(parseNoteText(raw)).toEqual({
      title: 'Title',
      body: 'body',
      tags: ['tag 1', 'tag 2', 'tag-three'],
    });
  });

  it('trims leading/trailing whitespace from the title line', () => {
    expect(parseNoteText('   My Title   \n\nbody')).toEqual({
      title: 'My Title',
      body: 'body',
      tags: [],
    });
  });

  it('skips leading blank lines to find the title', () => {
    const raw = '\n\n   \nMy Title\n\nbody text';
    expect(parseNoteText(raw)).toEqual({
      title: 'My Title',
      body: 'body text',
      tags: [],
    });
  });
});

describe('serializeNote', () => {
  it('serializes title only', () => {
    expect(serializeNote('My Title', '', [])).toBe('My Title');
  });

  it('serializes title and body, no tags', () => {
    expect(serializeNote('My Title', 'Some body', [])).toBe('My Title\n\nSome body');
  });

  it('serializes title and tags, no body', () => {
    expect(serializeNote('My Title', '', ['foo', 'bar'])).toBe('My Title\n\n:foo, bar');
  });

  it('serializes title, body, and tags', () => {
    expect(serializeNote('My Title', 'Some body', ['foo', 'bar'])).toBe(
      'My Title\n\nSome body\n\n:foo, bar',
    );
  });

  it('trims title and body whitespace', () => {
    expect(serializeNote('  My Title  ', '  Some body  ', [])).toBe('My Title\n\nSome body');
  });

  it('dedupes and lowercases tags like parseTags', () => {
    expect(serializeNote('Title', '', ['Foo', 'foo', 'BAR'])).toBe('Title\n\n:foo, bar');
  });

  it('omits empty tag entries', () => {
    expect(serializeNote('Title', '', ['foo', '  ', 'bar'])).toBe('Title\n\n:foo, bar');
  });

  it('round-trips through parseNoteText', () => {
    const rawText = serializeNote('My Title', 'Body line 1\nBody line 2', ['foo', 'bar']);
    expect(parseNoteText(rawText)).toEqual({
      title: 'My Title',
      body: 'Body line 1\nBody line 2',
      tags: ['foo', 'bar'],
    });
  });
});
