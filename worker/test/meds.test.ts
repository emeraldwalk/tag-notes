import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_CONVERT_NOTES, MAX_RANGE_DAYS } from '../src/meds';
import { clearData, Jar, send, sendJson, signIn, useHarness } from './harness';

const h = useHarness();
beforeEach(clearData);

type Row = Record<string, unknown> & { id: string };

const addMedicine = async (jar: Jar, body: Record<string, unknown>) => {
  const res = await sendJson(h, jar, 'POST', '/api/medicines', body);
  expect(res.status, JSON.stringify(body)).toBe(201);
  return ((await res.json()) as { medicine: Row }).medicine;
};
const medicines = async (jar: Jar) => ((await (await send(h, jar, '/api/medicines')).json()) as { medicines: Row[] }).medicines;
const addDose = async (jar: Jar, body: Record<string, unknown>) => {
  const res = await sendJson(h, jar, 'POST', '/api/doses', body);
  expect(res.status, JSON.stringify(body)).toBe(201);
  return ((await res.json()) as { dose: Row }).dose;
};
const doses = async (jar: Jar, q = '') => {
  const res = await send(h, jar, `/api/doses${q}`);
  expect(res.status).toBe(200);
  return ((await res.json()) as { doses: Row[] }).doses;
};
const addNote = async (jar: Jar, rawText: string) => {
  const res = await sendJson(h, jar, 'POST', '/api/notes', { rawText });
  expect(res.status).toBe(201);
  return ((await res.json()) as { note: Row }).note;
};
const noteIds = async (jar: Jar) => ((await (await send(h, jar, '/api/notes')).json()) as { notes: Row[] }).notes.map((n) => n.id);
const convert = async (jar: Jar, groups: unknown) => sendJson(h, jar, 'POST', '/api/doses/convert-notes', { groups });

describe('medicine API signed out', () => {
  it('401s every route', async () => {
    const jar = new Jar();
    for (const [method, path] of [
      ['GET', '/api/medicines'], ['POST', '/api/medicines'], ['PUT', '/api/medicines/x'], ['DELETE', '/api/medicines/x'],
      ['GET', '/api/doses'], ['POST', '/api/doses'], ['PUT', '/api/doses/x'], ['DELETE', '/api/doses/x'],
      ['POST', '/api/doses/convert-notes'],
    ] as const) {
      expect((await sendJson(h, jar, method, path, method === 'GET' || method === 'DELETE' ? undefined : {})).status, `${method} ${path}`).toBe(401);
    }
  });
});

describe('medicines', () => {
  it('adds, lists in order, renames, sets the default dose, reorders, deactivates and deletes', async () => {
    const jar = await signIn(h, new Jar());
    const met = await addMedicine(jar, { name: ' Metformin ', defaultDose: '500 mg' });
    expect(met).toMatchObject({ name: 'Metformin', defaultDose: '500 mg', active: true, sortOrder: 0, createdAt: expect.any(String) });
    const vit = await addMedicine(jar, { name: 'Vitamin D' });
    expect(vit).toMatchObject({ sortOrder: 1 });
    expect(vit).not.toHaveProperty('defaultDose');
    expect((await medicines(jar)).map((m) => m['name'])).toEqual(['Metformin', 'Vitamin D']);

    const put = async (id: string, body: unknown) => {
      const res = await sendJson(h, jar, 'PUT', `/api/medicines/${id}`, body);
      expect(res.status, JSON.stringify(body)).toBe(200);
      return ((await res.json()) as { medicine: Row }).medicine;
    };
    expect(await put(vit.id, { sortOrder: -1 })).toMatchObject({ name: 'Vitamin D', sortOrder: -1 });
    expect((await medicines(jar)).map((m) => m['name'])).toEqual(['Vitamin D', 'Metformin']);
    expect(await put(met.id, { name: 'Metformin XR', defaultDose: '750 mg' })).toMatchObject({ name: 'Metformin XR', defaultDose: '750 mg', sortOrder: 0 });
    const inactive = await put(met.id, { active: false, defaultDose: null });
    expect(inactive).toMatchObject({ name: 'Metformin XR', active: false });
    expect(inactive).not.toHaveProperty('defaultDose');
    // Inactive ones are still listed.
    expect(await medicines(jar)).toHaveLength(2);

    expect((await sendJson(h, jar, 'DELETE', `/api/medicines/${met.id}`)).status).toBe(204);
    expect((await sendJson(h, jar, 'DELETE', `/api/medicines/${met.id}`)).status).toBe(404);
    expect((await sendJson(h, jar, 'PUT', `/api/medicines/${met.id}`, { active: true })).status).toBe(404);
    expect((await medicines(jar)).map((m) => m.id)).toEqual([vit.id]);
  });

  it('refuses a duplicate name (any case), on add and on rename', async () => {
    const jar = await signIn(h, new Jar());
    await addMedicine(jar, { name: 'Metformin' });
    const other = await addMedicine(jar, { name: 'Aspirin' });
    for (const name of ['Metformin', ' metformin ']) {
      const res = await sendJson(h, jar, 'POST', '/api/medicines', { name });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: 'duplicate_name' });
    }
    expect((await sendJson(h, jar, 'PUT', `/api/medicines/${other.id}`, { name: 'METFORMIN' })).status).toBe(409);
    // Its own name in another case is fine.
    expect((await sendJson(h, jar, 'PUT', `/api/medicines/${other.id}`, { name: 'aspirin' })).status).toBe(200);
    // Another user may use the same name.
    await addMedicine(await signIn(h, new Jar(), 'sub-other'), { name: 'Metformin' });
  });

  it('validates bodies', async () => {
    const jar = await signIn(h, new Jar());
    for (const body of [{}, { name: '' }, { name: '  ' }, { name: 3 }, { name: 'x'.repeat(201) }, { name: 'A', defaultDose: 5 }, []]) {
      const res = await sendJson(h, jar, 'POST', '/api/medicines', body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(await res.json()).toMatchObject({ error: 'invalid', detail: expect.any(String) });
    }
    const med = await addMedicine(jar, { name: 'A' });
    for (const body of [{ active: 'no' }, { sortOrder: 1.5 }, { name: '' }]) {
      expect((await sendJson(h, jar, 'PUT', `/api/medicines/${med.id}`, body)).status, JSON.stringify(body)).toBe(400);
    }
  });
});

describe('doses', () => {
  it('defaults the name and dose from the medicine, and the time to now', async () => {
    const jar = await signIn(h, new Jar());
    const met = await addMedicine(jar, { name: 'Metformin', defaultDose: '500 mg' });
    const before = Date.now();
    const tap = await addDose(jar, { medicineId: met.id, medicineName: 'ignored', source: 'tap' });
    expect(tap).toMatchObject({ medicineId: met.id, medicineName: 'Metformin', dose: '500 mg', source: 'tap' });
    expect(Date.parse(tap['takenAt'] as string)).toBeGreaterThanOrEqual(before - 1000);
    expect(Date.parse(tap['takenAt'] as string)).toBeLessThanOrEqual(Date.now() + 1000);
    expect(tap).not.toHaveProperty('note');

    const manual = await addDose(jar, { medicineId: met.id, dose: '1000 mg', takenAt: '2026-11-24T08:00:00-06:00', note: 'with food', source: 'manual' });
    expect(manual).toMatchObject({ dose: '1000 mg', takenAt: '2026-11-24T14:00:00.000Z', note: 'with food' });
    // An explicit null dose means none, not the default.
    expect(await addDose(jar, { medicineId: met.id, dose: null, source: 'manual' })).not.toHaveProperty('dose');

    const oneOff = await addDose(jar, { medicineName: ' Ibuprofen ', dose: '200 mg', source: 'manual' });
    expect(oneOff).toMatchObject({ medicineName: 'Ibuprofen', dose: '200 mg' });
    expect(oneOff).not.toHaveProperty('medicineId');
    const listed = await doses(jar);
    expect(listed).toHaveLength(4);
    expect(listed[3]!.id).toBe(manual.id);
  });

  it('lists newest first, edits time, dose and note, and deletes', async () => {
    const jar = await signIn(h, new Jar());
    const a = await addDose(jar, { medicineName: 'A', takenAt: '2026-11-24T08:00:00Z', source: 'manual' });
    const b = await addDose(jar, { medicineName: 'B', takenAt: '2026-11-24T20:00:00Z', dose: '1', note: 'n', source: 'manual' });
    expect((await doses(jar)).map((d) => d.id)).toEqual([b.id, a.id]);

    const res = await sendJson(h, jar, 'PUT', `/api/doses/${a.id}`, { takenAt: '2026-11-24T22:00:00Z', dose: '2 tablets' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { dose: Row }).dose).toMatchObject({ takenAt: '2026-11-24T22:00:00.000Z', dose: '2 tablets', medicineName: 'A' });
    expect((await doses(jar)).map((d) => d.id)).toEqual([a.id, b.id]);

    const cleared = ((await (await sendJson(h, jar, 'PUT', `/api/doses/${b.id}`, { dose: null, note: '' })).json()) as { dose: Row }).dose;
    expect(cleared).not.toHaveProperty('dose');
    expect(cleared).not.toHaveProperty('note');
    expect(cleared['takenAt']).toBe('2026-11-24T20:00:00.000Z');

    expect((await sendJson(h, jar, 'DELETE', `/api/doses/${a.id}`)).status).toBe(204);
    expect((await sendJson(h, jar, 'DELETE', `/api/doses/${a.id}`)).status).toBe(404);
    expect((await sendJson(h, jar, 'PUT', `/api/doses/${a.id}`, { dose: 'x' })).status).toBe(404);
  });

  it('validates bodies', async () => {
    const jar = await signIn(h, new Jar());
    for (const body of [
      { medicineName: 'A' },
      { medicineName: 'A', source: 'shout' },
      { source: 'tap' },
      { medicineName: '', source: 'tap' },
      { medicineId: 'nope', source: 'tap' },
      { medicineName: 'A', source: 'tap', takenAt: '2026-11-24T08:00:00' },
      { medicineName: 'A', source: 'tap', dose: 3 },
    ]) {
      const res = await sendJson(h, jar, 'POST', '/api/doses', body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(await res.json()).toMatchObject({ error: 'invalid', detail: expect.any(String) });
    }
    const d = await addDose(jar, { medicineName: 'A', source: 'tap' });
    expect((await sendJson(h, jar, 'PUT', `/api/doses/${d.id}`, { takenAt: 'noon' })).status).toBe(400);
  });

  it('filters by range, at most 92 days', async () => {
    const jar = await signIn(h, new Jar());
    const inside = await addDose(jar, { medicineName: 'A', takenAt: '2026-11-24T06:00:00Z', source: 'manual' });
    await addDose(jar, { medicineName: 'A', takenAt: '2026-11-25T06:00:00Z', source: 'manual' });
    await addDose(jar, { medicineName: 'A', takenAt: '2026-11-24T05:59:59Z', source: 'manual' });
    const day = '?from=2026-11-24T00:00:00-06:00&to=2026-11-25T00:00:00-06:00';
    expect((await doses(jar, day)).map((d) => d.id)).toEqual([inside.id]);
    expect(await doses(jar, '?from=2026-08-24T06:00:00Z&to=2026-11-24T06:00:00Z')).toHaveLength(1);

    const days = (MAX_RANGE_DAYS + 1) * 24 * 3600 * 1000;
    const tooLong = `?from=${new Date(Date.parse('2026-11-24T00:00:00Z') - days).toISOString()}&to=2026-11-24T00:00:00Z`;
    for (const q of [tooLong, '?from=2026-11-24T00:00:00Z', '?from=2026-11-25T00:00:00Z&to=2026-11-24T00:00:00Z', '?from=yesterday&to=today']) {
      expect((await send(h, jar, `/api/doses${q}`)).status, q).toBe(400);
    }
  });

  it('keeps doses when their medicine is deleted, with its name', async () => {
    const jar = await signIn(h, new Jar());
    const met = await addMedicine(jar, { name: 'Metformin', defaultDose: '500 mg' });
    const dose = await addDose(jar, { medicineId: met.id, source: 'tap' });
    await sendJson(h, jar, 'PUT', `/api/medicines/${met.id}`, { name: 'Renamed' });
    expect((await sendJson(h, jar, 'DELETE', `/api/medicines/${met.id}`)).status).toBe(204);
    const [kept] = await doses(jar);
    expect(kept).toMatchObject({ id: dose.id, medicineName: 'Metformin', dose: '500 mg' });
    expect(kept).not.toHaveProperty('medicineId');
  });
});

describe('medicines and doses between users', () => {
  it("can't read, use, change or delete another user's rows", async () => {
    const mine = await signIn(h, new Jar());
    const met = await addMedicine(mine, { name: 'Metformin' });
    const dose = await addDose(mine, { medicineId: met.id, source: 'tap' });
    const other = await signIn(h, new Jar(), 'sub-other');

    expect(await medicines(other)).toEqual([]);
    expect(await doses(other)).toEqual([]);
    expect((await sendJson(h, other, 'POST', '/api/doses', { medicineId: met.id, source: 'tap' })).status).toBe(400);
    expect((await sendJson(h, other, 'PUT', `/api/medicines/${met.id}`, { name: 'Hijacked' })).status).toBe(404);
    expect((await sendJson(h, other, 'DELETE', `/api/medicines/${met.id}`)).status).toBe(404);
    expect((await sendJson(h, other, 'PUT', `/api/doses/${dose.id}`, { dose: 'x' })).status).toBe(404);
    expect((await sendJson(h, other, 'DELETE', `/api/doses/${dose.id}`)).status).toBe(404);
    expect((await convert(other, [{ noteIds: [], medicineId: met.id }])).status).toBe(200);

    expect((await medicines(mine))[0]).toMatchObject({ name: 'Metformin' });
    expect(await doses(mine)).toHaveLength(1);
  });
});

describe('POST /api/doses/convert-notes', () => {
  it('turns meds notes into doses on their dates, then deletes them; others are skipped', async () => {
    const jar = await signIn(h, new Jar());
    const met = await addMedicine(jar, { name: 'Metformin', defaultDose: '500 mg' });
    const vit = await addMedicine(jar, { name: 'Vitamin D' });
    const n1 = await addNote(jar, 'metformin\n\nafter breakfast\n\n:meds');
    const n2 = await addNote(jar, 'Metformin\n\n:meds, morning');
    const n3 = await addNote(jar, 'vitamin d\n\n:meds');
    const plain = await addNote(jar, 'metformin\n\nnot tagged');
    const theirs = await addNote(await signIn(h, new Jar(), 'sub-other'), 'metformin\n\n:meds');

    const res = await convert(jar, [
      { noteIds: [n1.id, n2.id, plain.id, theirs.id, 'missing'], medicineId: met.id },
      { noteIds: [n3.id, n3.id], medicineId: vit.id },
    ]);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ converted: 3, skipped: 4 });

    expect(await noteIds(jar)).toEqual([plain.id]);
    expect(await (await send(h, jar, '/api/notes?tag=meds')).json()).toEqual({ notes: [] });
    const tagRows = await env.DB.prepare('SELECT note_id FROM note_tags WHERE note_id IN (?, ?, ?)').bind(n1.id, n2.id, n3.id).all();
    expect(tagRows.results).toEqual([]);

    const all = await doses(jar);
    expect(all).toHaveLength(3);
    const byNote = Object.fromEntries(all.map((d) => [d['note'], d]));
    expect(byNote[n1['rawText'] as string]).toMatchObject({ medicineId: met.id, medicineName: 'Metformin', dose: '500 mg', takenAt: n1['createdAt'], source: 'note' });
    expect(byNote[n2['rawText'] as string]).toMatchObject({ medicineId: met.id, takenAt: n2['createdAt'] });
    expect(byNote[n3['rawText'] as string]).toMatchObject({ medicineId: vit.id, medicineName: 'Vitamin D' });
    expect(byNote[n3['rawText'] as string]).not.toHaveProperty('dose');

    // The other user's note is untouched.
    const other = await signIn(h, new Jar(), 'sub-other');
    expect(await noteIds(other)).toEqual([theirs.id]);
    expect(await doses(other)).toEqual([]);
  });

  it('adds no second dose for a note restored by re-importing an old export and converted again', async () => {
    const jar = await signIn(h, new Jar());
    const met = await addMedicine(jar, { name: 'Metformin' });
    const n1 = await addNote(jar, 'metformin\n\n:meds');
    const exported = { app: 'tag-notes', version: 2, notes: [n1], foods: [] };
    expect(await (await convert(jar, [{ noteIds: [n1.id], medicineId: met.id }])).json()).toEqual({ converted: 1, skipped: 0 });

    expect((await sendJson(h, jar, 'POST', '/api/import', exported)).status).toBe(200);
    expect(await noteIds(jar)).toEqual([n1.id]);
    expect(await (await convert(jar, [{ noteIds: [n1.id], medicineId: met.id }])).json()).toEqual({ converted: 1, skipped: 0 });

    expect(await noteIds(jar)).toEqual([]);
    expect(await doses(jar)).toHaveLength(1);
  });

  it('leaves every note in place when the request fails', async () => {
    const jar = await signIn(h, new Jar());
    const met = await addMedicine(jar, { name: 'Metformin' });
    const n1 = await addNote(jar, 'metformin\n\n:meds');
    const theirMed = await addMedicine(await signIn(h, new Jar(), 'sub-other'), { name: 'Theirs' });

    for (const groups of [
      [{ noteIds: [n1.id], medicineId: met.id }, { noteIds: [n1.id], medicineId: 'nope' }],
      [{ noteIds: [n1.id], medicineId: theirMed.id }],
      [{ noteIds: Array.from({ length: MAX_CONVERT_NOTES }, (_, i) => `x${i}`).concat(n1.id), medicineId: met.id }],
      [{ noteIds: n1.id, medicineId: met.id }],
      'nope',
    ]) {
      expect((await convert(jar, groups)).status, JSON.stringify(groups).slice(0, 80)).toBe(400);
    }
    expect(await noteIds(jar)).toEqual([n1.id]);
    expect(await doses(jar)).toEqual([]);

    // A batch that fails part-way rolls back: the dose insert for n1 succeeds, then a duplicate id aborts the batch.
    const failing = env.DB.batch([
      env.DB.prepare("INSERT INTO doses (id, user_id, medicine_name, taken_at, source, created_at) VALUES ('d', 'sub-brian', 'x', 't', 'note', 't')"),
      env.DB.prepare('DELETE FROM notes WHERE id = ?').bind(n1.id),
      env.DB.prepare("INSERT INTO doses (id, user_id, medicine_name, taken_at, source, created_at) VALUES ('d', 'sub-brian', 'x', 't', 'note', 't')"),
    ]);
    await expect(failing).rejects.toThrow();
    expect(await noteIds(jar)).toEqual([n1.id]);
    expect(await doses(jar)).toEqual([]);
  });
});

describe('export / import of medicines and doses', () => {
  it('round-trips through GET and POST /api/import, linking doses to medicines', async () => {
    const jar = await signIn(h, new Jar());
    const met = await addMedicine(jar, { name: 'Metformin', defaultDose: '500 mg' });
    const vit = await addMedicine(jar, { name: 'Vitamin D' });
    await sendJson(h, jar, 'PUT', `/api/medicines/${vit.id}`, { active: false });
    await addDose(jar, { medicineId: met.id, takenAt: '2026-11-24T14:00:00Z', note: 'n', source: 'tap' });
    await addDose(jar, { medicineName: 'Ibuprofen', dose: '200 mg', takenAt: '2026-11-23T14:00:00Z', source: 'manual' });
    const file = { app: 'tag-notes', version: 2, notes: [], foods: [], medicines: await medicines(jar), doses: await doses(jar) };

    // Into a fresh account.
    const fresh = await signIn(h, new Jar(), 'sub-fresh');
    const res = await sendJson(h, fresh, 'POST', '/api/import', file);
    expect(await res.json()).toEqual({ notes: 0, foods: 0, targets: false, medicines: 0, doses: 0, skipped: 4 });
    // The ids are the owner's, so they're skipped; a copy without ids imports.
    const strip = <T extends Row>(rows: T[]) => rows.map(({ id: _id, ...rest }) => rest);
    const copy = { ...file, medicines: strip(file.medicines), doses: strip(file.doses) };
    expect(await (await sendJson(h, fresh, 'POST', '/api/import', copy)).json()).toMatchObject({ medicines: 2, doses: 2, skipped: 0 });
    const freshMeds = await medicines(fresh);
    expect(freshMeds.map((m) => [m['name'], m['active'], m['defaultDose']])).toEqual([['Metformin', true, '500 mg'], ['Vitamin D', false, undefined]]);
    const freshDoses = await doses(fresh);
    // The dose's medicineId was the owner's medicine: relinked by name to this account's, never to the owner's.
    expect(freshDoses[0]).toMatchObject({ medicineId: freshMeds[0]!.id, medicineName: 'Metformin', dose: '500 mg', note: 'n', source: 'tap' });
    expect(freshDoses[1]).toMatchObject({ medicineName: 'Ibuprofen', dose: '200 mg' });
    expect(freshDoses[1]).not.toHaveProperty('medicineId');

    // Back into the owner's account: upserts by id, nothing duplicated.
    expect(await (await sendJson(h, jar, 'POST', '/api/import', file)).json()).toMatchObject({ medicines: 2, doses: 2, skipped: 0 });
    expect(await medicines(jar)).toEqual(file.medicines);
    expect(await doses(jar)).toEqual(file.doses);
  });

  it('merges a medicine whose name is already on the list', async () => {
    const jar = await signIn(h, new Jar());
    const met = await addMedicine(jar, { name: 'Metformin' });
    const file = {
      notes: [],
      medicines: [{ id: 'm-file', name: 'METFORMIN', active: true, sortOrder: 0 }, { name: 'metformin', active: true, sortOrder: 0 }],
      doses: [{ id: 'd-file', medicineId: 'm-file', medicineName: 'Metformin', takenAt: '2026-11-24T14:00:00Z', source: 'tap' }],
    };
    expect(await (await sendJson(h, jar, 'POST', '/api/import', file)).json()).toMatchObject({ medicines: 2, doses: 1, skipped: 0 });
    expect((await medicines(jar)).map((m) => m.id)).toEqual([met.id]);
    expect((await doses(jar))[0]).toMatchObject({ id: 'd-file', medicineId: met.id });
  });

  it('refuses invalid medicines and doses', async () => {
    const jar = await signIn(h, new Jar());
    for (const extra of [
      { medicines: [{ name: '' }] },
      { medicines: {} },
      { doses: [{ medicineName: 'A', takenAt: '2026-11-24T14:00:00Z', source: 'x' }] },
      { doses: [{ medicineName: 'A', takenAt: 'today', source: 'tap' }] },
    ]) {
      const res = await sendJson(h, jar, 'POST', '/api/import', { notes: [], ...extra });
      expect(res.status, JSON.stringify(extra)).toBe(400);
    }
  });
});
