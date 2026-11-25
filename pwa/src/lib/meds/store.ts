import { api, ApiError } from '../api';
import type { ConvertResult, Dose, Medicine, MedsStore } from './types';

const path = (base: string, id: string) => `${base}/${encodeURIComponent(id)}`;

async function ignoreNotFound(call: Promise<unknown>): Promise<void> {
  try {
    await call;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return;
    throw err;
  }
}

/** The `MedsStore` over the Worker's `/api/medicines` and `/api/doses` (plan 16). */
export function createHttpMedsStore(): MedsStore {
  return {
    async listMedicines() {
      return (await api<{ medicines: Medicine[] }>('/medicines')).medicines;
    },
    async createMedicine(input) {
      return (await api<{ medicine: Medicine }>('/medicines', { method: 'POST', body: input })).medicine;
    },
    async updateMedicine(id, patch) {
      return (await api<{ medicine: Medicine }>(path('/medicines', id), { method: 'PUT', body: patch })).medicine;
    },
    removeMedicine(id) {
      return ignoreNotFound(api<void>(path('/medicines', id), { method: 'DELETE' }));
    },
    async listDoses(range) {
      const query = range ? `?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}` : '';
      return (await api<{ doses: Dose[] }>(`/doses${query}`)).doses;
    },
    async createDose(input) {
      return (await api<{ dose: Dose }>('/doses', { method: 'POST', body: input })).dose;
    },
    async updateDose(id, patch) {
      return (await api<{ dose: Dose }>(path('/doses', id), { method: 'PUT', body: patch })).dose;
    },
    removeDose(id) {
      return ignoreNotFound(api<void>(path('/doses', id), { method: 'DELETE' }));
    },
    convertNotes(groups) {
      return api<ConvertResult>('/doses/convert-notes', { method: 'POST', body: { groups } });
    },
  };
}
