# 06 — Full export / import

- [x] Export file v2: notes, food entries and food targets in one file
- [x] `FoodStore.importAll`; import of v1 and v2 files
- [x] Settings: Export / Import cover everything
- [x] Tests
- [ ] Owner: push (ships to GitHub Pages), export a file from the installed app, keep it

## Goal

One file holds everything the app has, so plan 8 can load it into `tracker.ingles.place`. Browser storage is per
origin: the data on `emeraldwalk.github.io` (the root site and `/preview/` share it) can't be read from the new
domain any other way.

## Existing touchpoints

| Path | Role / change |
| --- | --- |
| `pwa/src/lib/notes/export.ts` | Today: `ExportFile` v1 `{ app: 'tag-notes', version: 1, exportedAt, notes }`, `buildExportFile`, `parseExportFile` (v1 or a bare array → `ImportableNote[]`), `exportFileName`. Moves to `pwa/src/lib/export.ts` since it's no longer notes-only; update imports. |
| `pwa/src/lib/foods/types.ts` | `FoodStore` gains `importAll`; `ImportableFoodEntry` added. |
| `pwa/src/lib/foods/store.ts` | IndexedDB `importAll`. |
| `pwa/src/lib/foods/targets.ts` | `FoodTargets` (localStorage) read for export and written on import. |
| `pwa/src/routes/Settings.tsx` | Buttons become "Export All" / "Import"; status text reports counts of each kind. |
| `pwa/src/lib/notes/export.test.ts` | Moves with the module; extended. |

## Contracts

```ts
// pwa/src/lib/export.ts
export const EXPORT_FORMAT = 'tag-notes';   // unchanged, so old files still match
export const EXPORT_VERSION = 2;

export interface ExportFileV2 {
  app: 'tag-notes';
  version: 2;
  exportedAt: string;            // ISO 8601
  notes: Note[];
  foods: FoodEntry[];
  foodTargets: FoodTargets;
}

export interface ImportBundle {
  notes: ImportableNote[];
  foods: ImportableFoodEntry[];
  foodTargets?: FoodTargets;     // absent for v1 files and bare arrays
}

export function buildExportFile(data: { notes: Note[]; foods: FoodEntry[]; foodTargets: FoodTargets }): ExportFileV2;
export function parseExportFile(json: string): ImportBundle;   // throws InvalidExportFileError
export function exportFileName(date?: Date): string;           // `tag-notes-export-YYYY-MM-DD.json`, unchanged
```

```ts
// pwa/src/lib/foods/types.ts
export interface ImportableFoodEntry {
  id?: string;
  name: string;
  servingSize?: string;          // free text, e.g. "1 cup"
  quantity: number;
  protein: number;
  calories: number;
  carbs: number;
  date: string;                  // YYYY-MM-DD
  createdAt?: string;
}
// FoodStore gains:
importAll(entries: ImportableFoodEntry[]): Promise<void>;   // upsert by id; missing id/createdAt generated
```

Parsing rules:

- Accepted: a v2 object, a v1 object (`notes` only), or a bare array of notes (as today).
- Notes: as today (`rawText` required).
- Foods: `name` non-empty string; `servingSize` optional string; `quantity`, `protein`, `calories`, `carbs` finite numbers ≥ 0; `date` matches
  `YYYY-MM-DD`. The error names the index and the field, like the notes errors.
- `foodTargets`: both numbers finite ≥ 0, else the file is invalid.
- Import applies notes, then foods, then targets (only when present). Merge semantics as today: same id overwrites.

Plan 8's server import reads this same v2 shape. Keep the file format the contract; don't add fields here that plan 8
doesn't know about.

## Concept boundaries

- `EXPORT_FORMAT` stays `'tag-notes'` after the rename; it identifies the file format, not the app's name.
- No `eatenAt` here: plan 8 adds meal times and derives them for imported entries.

## Tests

- Round trip: build → JSON → parse gives the same notes, foods and targets.
- v1 file and bare array still import (no foods, no targets).
- Each invalid food field rejected with its index; invalid targets rejected.
- `FoodStore.importAll` (with `fake-indexeddb`): upsert by id, generated ids, `listByDate` sees imported entries.

## Validation (owner, after the push)

1. On the installed home-screen app: Settings → Export All. The status counts match what you'd expect; keep the file
   (iCloud Drive).
2. Open the file: it has `"version": 2`, a `foods` array and `foodTargets`.
3. Import that same file back: counts reported, nothing duplicated.
