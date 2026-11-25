import { api } from './api';
import { buildExportFile, EXPORT_FORMAT, EXPORT_VERSION, type ExportFileV2, type ImportBundle } from './export';
import { foodStore } from './foods/store-instance';
import { getFoodTargets } from './foods/targets';
import { medsStore } from './meds/store-instance';
import { noteStore } from './notes/store-instance';

/**
 * Export All and Import against the server (plan 8). Kept apart from `export.ts`, which the Worker shares and so
 * can't import the stores.
 */

export async function exportAll(): Promise<ExportFileV2> {
  const [notes, foods, foodTargets, medicines, doses] = await Promise.all([
    noteStore.list(),
    foodStore.list(),
    getFoodTargets(),
    medsStore.listMedicines(),
    medsStore.listDoses(),
  ]);
  return buildExportFile({ notes, foods, foodTargets, medicines, doses });
}

export interface ImportResult {
  notes: number;
  foods: number;
  targets: boolean;
  medicines: number;
  doses: number;
  /** Rows whose id belongs to another user: never overwritten. */
  skipped: number;
}

/** Rows (notes, foods, medicines, doses) per request, so each import request stays well inside the Worker's 10 ms of CPU. */
export const IMPORT_CHUNK = 25; // measured in production (2026-11-25): 200 rows 16 ms; 50 notes 10 ms, 50 mixed 6 ms

/**
 * Posts a parsed export file to `POST /api/import` in chunks (each a v2 file with part of the rows; targets go with
 * the last; arrays a chunk has no rows for are left out, except `notes`, which the format needs). The file was
 * already validated by `parseExportFile`; the server validates again.
 */
export async function importBundle(bundle: ImportBundle): Promise<ImportResult> {
  const total: ImportResult = { notes: 0, foods: 0, targets: false, medicines: 0, doses: 0, skipped: 0 };
  // In this order, so medicines are saved before (or with) the doses that link to them.
  const rows = [
    ...bundle.notes.map((row) => ({ kind: 'notes' as const, row })),
    ...bundle.foods.map((row) => ({ kind: 'foods' as const, row })),
    ...bundle.medicines.map((row) => ({ kind: 'medicines' as const, row })),
    ...bundle.doses.map((row) => ({ kind: 'doses' as const, row })),
  ];
  const chunks = Math.max(1, Math.ceil(rows.length / IMPORT_CHUNK));
  for (let i = 0; i < chunks; i++) {
    const part = rows.slice(i * IMPORT_CHUNK, (i + 1) * IMPORT_CHUNK);
    const file: Record<string, unknown> = {
      app: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      notes: [],
    };
    for (const { kind, row } of part) ((file[kind] ??= []) as unknown[]).push(row);
    if (i === chunks - 1 && bundle.foodTargets) file['foodTargets'] = bundle.foodTargets;
    const result = await api<ImportResult>('/import', { method: 'POST', body: file });
    total.notes += result.notes;
    total.foods += result.foods;
    total.targets ||= result.targets;
    total.medicines += result.medicines;
    total.doses += result.doses;
    total.skipped += result.skipped;
  }
  return total;
}
