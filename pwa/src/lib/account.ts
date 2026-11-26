import { api } from './api';
import type { CsvReading } from './glucose/csv';

export interface Me {
  sub: string;
  name: string;
  /** Short commit of the Worker's build, or "dev". */
  build: string;
}

/** Matches the Worker's `GET /api/glucose/status` (worker/src/glucose.ts `GlucoseStatus`). */
export interface GlucoseStatus {
  lastReading: { ts: string; mgDl: number; trend: number | null } | null;
  llu: { lastRunAt: string | null; lastOkAt: string | null; lastError: string | null; backoffUntil: string | null };
}

export const getMe = () => api<Me>('/me');
export const getGlucoseStatus = () => api<GlucoseStatus>('/glucose/status');

/** Plan 17: posts up to 500 LibreView CSV readings (`POST /api/glucose/import`). */
export const importGlucose = (readings: CsvReading[]) =>
  api<{ inserted: number; duplicates: number }>('/glucose/import', { method: 'POST', body: { readings } });

/** Signs out of this app and the IdP (a full page load). */
export const LOGOUT_URL = '/auth/logout';
