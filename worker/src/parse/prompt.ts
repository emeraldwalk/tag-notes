import type { ChatMessage } from './providers';

/** What the parser knows besides the text: built from D1 for the entry's user. */
export interface ParseContext {
  text: string;
  /** UTC ISO: when it was said; relative times are from here. */
  occurredAt: string;
  /** UTC ISO: when the Worker got it; no time after this (plus 5 minutes) is accepted. */
  receivedAt: string;
  timeZone: string;
  /** Active medicines. */
  medicines: { id: string; name: string; defaultDose?: string }[];
  /** My distinct foods (latest entry per name), newest first, with the numbers to copy. */
  foods: { name: string; servingSize?: string; protein: number; calories: number; carbs: number }[];
}

/** At most this many of my foods go in the prompt. */
export const MAX_PROMPT_FOODS = 300;

/** The answer's JSON schema, for providers that enforce one. Kept flat: some JSON modes don't take `anyOf`. */
export const ANSWER_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['food', 'dose', 'note'] },
          name: { type: 'string' },
          myFood: { type: ['string', 'null'] },
          quantity: { type: 'number' },
          medicineId: { type: ['string', 'null'] },
          medicineName: { type: 'string' },
          dose: { type: ['string', 'null'] },
          text: { type: 'string' },
          time: { type: ['string', 'null'] },
        },
        required: ['kind'],
      },
    },
  },
  required: ['items'],
} as const;

const SYSTEM = `You turn one short diary entry into things to log. Reply with one JSON object and nothing else:
{"items": [ ... ]}

Each item is one of:
- Food eaten: {"kind":"food","name":"<what was eaten>","myFood":"<exact name from MY FOODS>" or null,"quantity":<number>,"time":"YYYY-MM-DDTHH:MM" or null}
  - myFood: the name from MY FOODS when the food is one of them (ignore case, plurals and small wording differences), else null.
  - quantity: how many of that food's serving ("two eggs" with serving "1 large" is 2). Default 1.
  - One item per distinct food. Never include nutrition numbers.
- Medicine taken: {"kind":"dose","medicineId":"<id from MY MEDICINES>" or null,"medicineName":"<name>","dose":"<amount>" or null,"time":"YYYY-MM-DDTHH:MM" or null}
  - medicineId: the id when the medicine is in MY MEDICINES, else null. dose: only if the entry says an amount.
- Anything else worth keeping (how I feel, symptoms, events): {"kind":"note","text":"<the entry's own words>"}
  - At most one note. Food and medicine go in their own items, not in the note.

time: the local time the entry says or clearly implies ("at 8" is 08:00 on the entry's day, "an hour ago" is one hour before ENTRY TIME). null when it doesn't say; never guess from meal names alone.
If there is nothing to log, reply {"items": []}.`;

function localStamp(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'long',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return `${p.weekday} ${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

/** The two messages for one parse. The text goes last, verbatim. */
export function buildMessages(ctx: ParseContext): ChatMessage[] {
  const meds = ctx.medicines.length
    ? ctx.medicines.map((m) => `- id=${m.id} | ${m.name}${m.defaultDose ? ` | usual dose ${m.defaultDose}` : ''}`).join('\n')
    : '(none)';
  const foods = ctx.foods.length
    ? ctx.foods
        .slice(0, MAX_PROMPT_FOODS)
        .map((f) => `- ${f.name}${f.servingSize ? ` | serving ${f.servingSize}` : ''}`)
        .join('\n')
    : '(none)';
  const user = `ENTRY TIME: ${localStamp(ctx.occurredAt, ctx.timeZone)} (${ctx.timeZone})

MY MEDICINES:
${meds}

MY FOODS:
${foods}

ENTRY:
${ctx.text}`;
  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: user },
  ];
}
