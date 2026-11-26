import { MAX_MEDICINE_TEXT } from '../../../pwa/src/lib/export';
import type { ProposalData } from '../../../pwa/src/lib/inbox/types';
import { createZoneConverter } from '../../../pwa/src/lib/zone';
import type { ParseContext } from './prompt';
import { ProviderError } from './providers';

/** Limits on what a model may propose (anything outside is dropped). */
export const MAX_ITEMS = 20;
const MAX_QUANTITY = 50;
const MAX_NAME = 200;
const MAX_NOTE = 4000;
const FUTURE_SLACK_MS = 5 * 60_000;
const LOCAL_TIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown, max: number): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t.length > 0 && t.length <= max ? t : undefined;
};

/** The JSON object in a model's answer: the whole text, a fenced ```json block, or the outermost `{…}`. */
export function extractJson(answer: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(answer);
  const candidates = [answer.trim(), fenced?.[1]?.trim(), answer.slice(answer.indexOf('{'), answer.lastIndexOf('}') + 1)];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      // try the next
    }
  }
  throw new ProviderError('bad_output', 'The answer has no JSON object.');
}

/**
 * A model's answer as proposals. Known foods take their numbers from my foods, never the model's; times are local
 * wall-clock in `ctx.timeZone`, defaulting to (and never later than) the entry's time. Bad items are dropped; an
 * answer without an `items` list throws `ProviderError('bad_output')`.
 */
export function interpretAnswer(answer: string, ctx: ParseContext): ProposalData[] {
  const parsed = extractJson(answer);
  const items = isRecord(parsed) ? parsed.items : undefined;
  if (!Array.isArray(items)) throw new ProviderError('bad_output', 'The answer has no "items" list.');

  const zone = createZoneConverter(ctx.timeZone);
  const latest = Date.parse(ctx.receivedAt) + FUTURE_SLACK_MS;
  const when = (v: unknown): string => {
    const m = typeof v === 'string' ? LOCAL_TIME.exec(v.trim()) : null;
    if (!m) return ctx.occurredAt;
    const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return ctx.occurredAt;
    const instant = zone.candidates(y, mo, d, h, mi)[0];
    if (instant === undefined || instant > latest) return ctx.occurredAt;
    return new Date(instant).toISOString();
  };

  const foods = new Map(ctx.foods.map((f) => [f.name.trim().toLowerCase(), f]));
  const meds = new Map(ctx.medicines.map((m) => [m.id, m]));
  const out: ProposalData[] = [];
  let notes = 0;

  for (const item of items.slice(0, MAX_ITEMS)) {
    if (!isRecord(item)) continue;
    if (item.kind === 'food') {
      const rawQuantity = item.quantity ?? 1;
      if (typeof rawQuantity !== 'number' || !(rawQuantity > 0) || rawQuantity > MAX_QUANTITY) continue;
      const quantity = Math.round(rawQuantity * 100) / 100;
      const eatenAt = when(item.time);
      const mine = typeof item.myFood === 'string' ? foods.get(item.myFood.trim().toLowerCase()) : undefined;
      if (mine) {
        const known: ProposalData = {
          kind: 'food',
          status: 'known',
          name: mine.name,
          quantity,
          protein: mine.protein,
          calories: mine.calories,
          carbs: mine.carbs,
          eatenAt,
        };
        if (mine.servingSize) known.servingSize = mine.servingSize;
        out.push(known);
        continue;
      }
      const name = text(item.name, MAX_NAME) ?? text(item.myFood, MAX_NAME);
      if (!name) continue;
      out.push({ kind: 'food', status: 'new', name, quantity, eatenAt });
    } else if (item.kind === 'dose') {
      const med = typeof item.medicineId === 'string' ? meds.get(item.medicineId) : undefined;
      const medicineName = med?.name ?? text(item.medicineName, MAX_MEDICINE_TEXT);
      if (!medicineName) continue;
      const dose: ProposalData = { kind: 'dose', medicineName, takenAt: when(item.time) };
      if (med) dose.medicineId = med.id;
      const amount = text(item.dose, MAX_MEDICINE_TEXT) ?? med?.defaultDose;
      if (amount) dose.dose = amount;
      out.push(dose);
    } else if (item.kind === 'note') {
      const note = text(item.text, MAX_NOTE);
      if (!note || notes > 0) continue;
      notes++;
      out.push({ kind: 'note', text: note });
    }
  }
  return out;
}
