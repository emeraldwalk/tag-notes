import { api } from './api';
import { buildExportFile, EXPORT_FORMAT, EXPORT_VERSION, type ExportFileV2, type ImportBundle } from './export';
import { foodStore } from './foods/store-instance';
import { getFoodTargets } from './foods/targets';
import { noteStore } from './notes/store-instance';

/**
 * Export All and Import against the server (plan 8). Kept apart from `export.ts`, which the Worker shares and so
 * can't import the stores.
 */

export async function exportAll(): Promise<ExportFileV2> {
  const [notes, foods, foodTargets] = await Promise.all([noteStore.list(), foodStore.list(), getFoodTargets()]);
  return buildExportFile({ notes, foods, foodTargets });
}

export interface ImportResult {
  notes: number;
  foods: number;
  targets: boolean;
  /** Rows whose id belongs to another user: never overwritten. */
  skipped: number;
}

/** Notes plus foods per request, so each import request stays well inside the Worker's 10 ms of CPU. */
export const IMPORT_CHUNK = 200;

/**
 * Posts a parsed export file to `POST /api/import` in chunks (each a v2 file with part of the rows; targets go with
 * the last). The file was already validated by `parseExportFile`; the server validates again.
 */
export async function importBundle(bundle: ImportBundle): Promise<ImportResult> {
  const total: ImportResult = { notes: 0, foods: 0, targets: false, skipped: 0 };
  const rows = [
    ...bundle.notes.map((note) => ({ kind: 'note' as const, note })),
    ...bundle.foods.map((food) => ({ kind: 'food' as const, food })),
  ];
  const chunks = Math.max(1, Math.ceil(rows.length / IMPORT_CHUNK));
  for (let i = 0; i < chunks; i++) {
    const part = rows.slice(i * IMPORT_CHUNK, (i + 1) * IMPORT_CHUNK);
    const file: Record<string, unknown> = {
      app: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      notes: part.flatMap((row) => (row.kind === 'note' ? [row.note] : [])),
      foods: part.flatMap((row) => (row.kind === 'food' ? [row.food] : [])),
    };
    if (i === chunks - 1 && bundle.foodTargets) file['foodTargets'] = bundle.foodTargets;
    const result = await api<ImportResult>('/import', { method: 'POST', body: file });
    total.notes += result.notes;
    total.foods += result.foods;
    total.targets ||= result.targets;
    total.skipped += result.skipped;
  }
  return total;
}
