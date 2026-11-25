// Shared with the Worker (types only): keep this file free of browser APIs.

/** Something on my list of medicines. Inactive ones are hidden from the Meds buttons but kept for history. */
export interface Medicine {
  id: string;
  name: string;
  defaultDose?: string; // free text, "500 mg"
  active: boolean;
  sortOrder: number;
  createdAt: string; // ISO 8601
}

/** How a dose was logged: a Meds button, the form, a converted `meds` note, or the parse agent (plan 10). */
export type DoseSource = 'tap' | 'manual' | 'note' | 'voice';

/** One time I took something. `medicineName` is copied when logged, so history survives renames and deletes. */
export interface Dose {
  id: string;
  medicineId?: string; // absent for one-offs and deleted medicines
  medicineName: string;
  dose?: string; // free text
  takenAt: string; // UTC ISO 8601
  note?: string;
  source: DoseSource;
  createdAt: string; // ISO 8601
}

/** `POST /api/medicines`. */
export interface MedicineInput {
  name: string;
  defaultDose?: string;
}

/** `PUT /api/medicines/:id`: any subset; `defaultDose: null` clears it. */
export interface MedicinePatch {
  name?: string;
  defaultDose?: string | null;
  active?: boolean;
  sortOrder?: number;
}

/** `POST /api/doses`: `medicineId` or `medicineName` (or both; the medicine's name wins). */
export interface DoseInput {
  medicineId?: string;
  medicineName?: string;
  dose?: string | null; // absent: the medicine's default dose; null: none
  takenAt?: string; // absent: now
  note?: string;
  source: DoseSource;
}

/** `PUT /api/doses/:id`: any subset; `null` clears `dose` or `note`. */
export interface DosePatch {
  dose?: string | null;
  takenAt?: string;
  note?: string | null;
}

/** One group of `POST /api/doses/convert-notes`: these notes become doses of this medicine. */
export interface ConvertGroup {
  noteIds: string[];
  medicineId: string;
}

export interface ConvertResult {
  converted: number;
  skipped: number;
}

/** A medicine read from an export file; missing `id` / `createdAt` are generated on import. */
export interface ImportableMedicine {
  id?: string;
  name: string;
  defaultDose?: string;
  active: boolean;
  sortOrder: number;
  createdAt?: string;
}

/** A dose read from an export file. */
export interface ImportableDose {
  id?: string;
  medicineId?: string;
  medicineName: string;
  dose?: string;
  takenAt: string;
  note?: string;
  source: DoseSource;
  createdAt?: string;
}

export interface MedsStore {
  listMedicines(): Promise<Medicine[]>;
  createMedicine(input: MedicineInput): Promise<Medicine>;
  updateMedicine(id: string, patch: MedicinePatch): Promise<Medicine>;
  removeMedicine(id: string): Promise<void>;
  /** Doses with `from <= takenAt < to` (at most 92 days), newest first; with no range, every dose. */
  listDoses(range?: { from: string; to: string }): Promise<Dose[]>;
  createDose(input: DoseInput): Promise<Dose>;
  updateDose(id: string, patch: DosePatch): Promise<Dose>;
  removeDose(id: string): Promise<void>;
  convertNotes(groups: ConvertGroup[]): Promise<ConvertResult>;
}
