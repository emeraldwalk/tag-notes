import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { createIndexedDbNoteStore, NoteNotFoundError } from './store';
import type { NoteStore } from './types';

describe('createIndexedDbNoteStore', () => {
  let store: NoteStore;

  beforeEach(async () => {
    store = createIndexedDbNoteStore();

    // Each test gets a fresh store instance, but IndexedDB databases persist
    // across instances within the same process (fake-indexeddb is
    // in-memory per process). Clear out any notes left by previous tests.
    for (const note of await store.list()) {
      await store.remove(note.id);
    }
  });

  it('starts with an empty list', async () => {
    expect(await store.list()).toEqual([]);
  });

  it('creates a note and returns it with generated fields', async () => {
    const rawText = 'My Title\n\nSome body text.\n\n:foo, bar';
    const note = await store.create(rawText);

    expect(note.id).toBeTruthy();
    expect(note.rawText).toBe(rawText);
    expect(note.title).toBe('My Title');
    expect(note.body).toBe('Some body text.');
    expect(note.tags).toEqual(['foo', 'bar']);
    expect(note.createdAt).toBe(note.updatedAt);
    expect(() => new Date(note.createdAt).toISOString()).not.toThrow();
  });

  it('persists created notes so they can be retrieved with get()', async () => {
    const note = await store.create('Title\n\nBody');
    const fetched = await store.get(note.id);
    expect(fetched).toEqual(note);
  });

  it('get() returns undefined for a non-existent id', async () => {
    expect(await store.get('does-not-exist')).toBeUndefined();
  });

  it('list() returns all notes sorted by updatedAt descending', async () => {
    const first = await store.create('First\n\n:a');
    await new Promise((r) => setTimeout(r, 5));
    const second = await store.create('Second\n\n:b');
    await new Promise((r) => setTimeout(r, 5));
    const third = await store.create('Third\n\n:c');

    const notes = await store.list();
    expect(notes.map((n) => n.id)).toEqual([third.id, second.id, first.id]);
  });

  it('update() re-parses rawText, preserves id/createdAt, and bumps updatedAt', async () => {
    const created = await store.create('Old Title\n\nOld body\n\n:old');
    await new Promise((r) => setTimeout(r, 5));

    const newRawText = 'New Title\n\nNew body\n\n:new, tag';
    const updated = await store.update(created.id, newRawText);

    expect(updated.id).toBe(created.id);
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.updatedAt).not.toBe(created.updatedAt);
    expect(updated.rawText).toBe(newRawText);
    expect(updated.title).toBe('New Title');
    expect(updated.body).toBe('New body');
    expect(updated.tags).toEqual(['new', 'tag']);

    const fetched = await store.get(created.id);
    expect(fetched).toEqual(updated);
  });

  it('update() throws NoteNotFoundError for a non-existent id', async () => {
    await expect(store.update('missing-id', 'Title')).rejects.toThrow(NoteNotFoundError);
  });

  it('remove() deletes a note', async () => {
    const note = await store.create('Title\n\nBody');
    await store.remove(note.id);
    expect(await store.get(note.id)).toBeUndefined();
    expect(await store.list()).toEqual([]);
  });

  it('remove() does not throw for a non-existent id', async () => {
    await expect(store.remove('missing-id')).resolves.toBeUndefined();
  });

  it('listTags() returns distinct tags across all notes, sorted alphabetically', async () => {
    await store.create('Note1\n\n:zeta, alpha');
    await store.create('Note2\n\n:beta, alpha');
    await store.create('Note3\n\n:gamma');

    expect(await store.listTags()).toEqual(['alpha', 'beta', 'gamma', 'zeta']);
  });

  it('listTags() returns an empty array when there are no notes', async () => {
    expect(await store.listTags()).toEqual([]);
  });

  it('listByTag() returns notes containing the tag, sorted by updatedAt descending', async () => {
    const a = await store.create('A\n\n:shared, only-a');
    await new Promise((r) => setTimeout(r, 5));
    const b = await store.create('B\n\n:other');
    await new Promise((r) => setTimeout(r, 5));
    const c = await store.create('C\n\n:shared, only-c');

    const sharedNotes = await store.listByTag('shared');
    expect(sharedNotes.map((n) => n.id)).toEqual([c.id, a.id]);

    const otherNotes = await store.listByTag('other');
    expect(otherNotes.map((n) => n.id)).toEqual([b.id]);
  });

  it('listByTag() matches case-insensitively against the lowercased tag', async () => {
    const note = await store.create('A\n\n:Foo');
    expect(note.tags).toEqual(['foo']);

    const found = await store.listByTag('FOO');
    expect(found.map((n) => n.id)).toEqual([note.id]);
  });

  it('listByTag() returns an empty array when no notes have the tag', async () => {
    await store.create('A\n\n:foo');
    expect(await store.listByTag('bar')).toEqual([]);
  });

  it('reflects updates to a note in listByTag results', async () => {
    const note = await store.create('A\n\n:old-tag');
    expect(await store.listByTag('old-tag')).toHaveLength(1);

    await store.update(note.id, 'A\n\n:new-tag');

    expect(await store.listByTag('old-tag')).toEqual([]);
    const newTagNotes = await store.listByTag('new-tag');
    expect(newTagNotes.map((n) => n.id)).toEqual([note.id]);
  });

  describe('importAll', () => {
    it('adds notes, re-parsing rawText and generating missing ids/timestamps', async () => {
      await store.importAll([{ rawText: 'Imported Title\n\nBody\n\n:imported' }]);

      const notes = await store.list();
      expect(notes).toHaveLength(1);
      expect(notes[0].id).toBeTruthy();
      expect(notes[0].title).toBe('Imported Title');
      expect(notes[0].body).toBe('Body');
      expect(notes[0].tags).toEqual(['imported']);
      expect(notes[0].createdAt).toBe(notes[0].updatedAt);
    });

    it('preserves provided id/createdAt/updatedAt', async () => {
      await store.importAll([
        {
          id: 'fixed-id',
          rawText: 'Title\n\nBody',
          createdAt: '2020-01-01T00:00:00.000Z',
          updatedAt: '2020-01-02T00:00:00.000Z',
        },
      ]);

      const note = await store.get('fixed-id');
      expect(note?.createdAt).toBe('2020-01-01T00:00:00.000Z');
      expect(note?.updatedAt).toBe('2020-01-02T00:00:00.000Z');
    });

    it('upserts: re-importing the same id overwrites the existing note', async () => {
      const original = await store.create('Original\n\n:a');
      await store.importAll([{ id: original.id, rawText: 'Replaced\n\n:b' }]);

      const notes = await store.list();
      expect(notes).toHaveLength(1);
      expect(notes[0].id).toBe(original.id);
      expect(notes[0].title).toBe('Replaced');
      expect(notes[0].tags).toEqual(['b']);
    });

    it('imports multiple notes in one call', async () => {
      await store.importAll([
        { rawText: 'One\n\n:x' },
        { rawText: 'Two\n\n:y' },
      ]);

      const notes = await store.list();
      expect(notes.map((n) => n.title).sort()).toEqual(['One', 'Two']);
    });
  });
});
