import type * as Beta from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { MessagesClient } from "./assistant";
import { DEFAULT_MODEL } from "./assistant";
import { UNITS, WORK_TYPES } from "../domain/inspections";

/** The site-note boxes the AI may fill, with the label the person sees. */
export const NOTE_FIELDS = {
  scope: "What the customer wants",
  existingConditions: "Existing conditions",
  slopeLevels: "Slope and levels",
  drainage: "Drainage",
  services: "Services (power, water, gas, sewer)",
  risks: "Risks and hazards",
  priorities: "Customer priorities and style",
  notes: "Other notes",
} as const;
export type NoteField = keyof typeof NOTE_FIELDS;
export const NOTE_KEYS = Object.keys(NOTE_FIELDS) as NoteField[];
const ACCESS = ["Easy", "Moderate", "Difficult", "Unknown"] as const;

/** Customer contact details the recording may mention. Only ever used to fill empty boxes. */
export const CUSTOMER_KEYS = ["phone", "email", "address", "suburb"] as const;
export type CustomerKey = (typeof CUSTOMER_KEYS)[number];

export interface DraftMeasurement {
  zone: string;
  workType: (typeof WORK_TYPES)[number];
  unit: (typeof UNITS)[number];
  lengthM?: number;
  widthM?: number;
  heightM?: number;
  quantity?: number;
  note: string;
}

export interface SiteNotesDraft {
  summary: string;
  fields: Partial<Record<NoteField, string>>;
  accessDifficulty?: (typeof ACCESS)[number];
  accessWidthM?: number;
  customer?: Partial<Record<CustomerKey, string>>;
  budgetDollars?: number;
  measurements?: DraftMeasurement[];
}

const SYSTEM = `You write up site visit notes for Whispering Leaf Landscaping & Construction in Sydney, Australia.
You are given transcripts of voice notes recorded at a customer's property. They may be the builder talking alone or a conversation with the customer, and speech-to-text may have small errors.

Rules:
- Use only what was said. If a topic wasn't mentioned, leave that field as an empty string. Never invent measurements, prices, dates, materials or names.
- Keep numbers exactly as spoken (sizes, budgets, widths). If something is unclear, write "(unclear in recording)" rather than guessing.
- Write short, practical notes in Australian English, as a builder would: dot points or short sentences.
- The summary is for the business owner: who was there if known, what the customer wants, key site facts, budget or timing if mentioned, and next steps agreed. 5 to 10 short lines.
- Customer-facing promises (prices, start dates) should be quoted, not reinterpreted.
- Customer details (phone, email, address, suburb): only if clearly said in the recording. Write phone numbers as digits. Empty string if not said or not clear. Never make one up or complete a partial one.
- budgetDollars: only a figure the customer actually gave, in Australian dollars; null otherwise. For a range, use the top of the range.
- measurements: one entry per area with a size that was actually said (e.g. "back lawn about 40 square metres", "wall 6 metres long, 600 high"). Convert millimetres to metres. Use quantity for a size given as a total (m², lm, m³, each); use length/width/height for dimensions. Leave a number null if it wasn't said. No entry for an area without a number. The note says what was said, briefly.`;

/**
 * The answer comes back as JSON matching this schema (structured outputs). Forcing a tool call
 * isn't allowed on current Claude models, so the schema does the job a forced tool used to.
 */
const num = { anyOf: [{ type: "number" }, { type: "null" }] } as const;
const NOTES_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "Meeting summary for the owner." },
    ...Object.fromEntries(Object.entries(NOTE_FIELDS).map(([k, label]) => [k, { type: "string", description: `${label}. Empty string if not discussed.` }])),
    accessDifficulty: { type: "string", enum: ["", ...ACCESS], description: "How hard it is to get machines and materials in. Empty if not discussed." },
    accessWidthM: { anyOf: [{ type: "number" }, { type: "null" }], description: "Narrowest access width in metres, only if a number was said; otherwise null." },
    customer: {
      type: "object",
      properties: Object.fromEntries(CUSTOMER_KEYS.map((k) => [k, { type: "string", description: `Customer ${k}, only if clearly said. Empty string otherwise.` }])),
      required: [...CUSTOMER_KEYS],
      additionalProperties: false,
    },
    budgetDollars: { anyOf: [{ type: "number" }, { type: "null" }], description: "Budget the customer gave, AUD. Null if not said." },
    measurements: {
      type: "array",
      items: {
        type: "object",
        properties: {
          zone: { type: "string", description: "Area name, e.g. Back lawn, Side path." },
          workType: { type: "string", enum: [...WORK_TYPES] },
          unit: { type: "string", enum: [...UNITS] },
          lengthM: num,
          widthM: num,
          heightM: num,
          quantity: num,
          note: { type: "string", description: "What was said about this size, briefly." },
        },
        required: ["zone", "workType", "unit", "lengthM", "widthM", "heightM", "quantity", "note"],
        additionalProperties: false,
      },
    },
  },
  required: ["summary", ...Object.keys(NOTE_FIELDS), "accessDifficulty", "accessWidthM", "customer", "budgetDollars", "measurements"],
  additionalProperties: false,
} as const;

/** Asks Claude to turn the transcripts into site notes. Returns only what the model wrote, validated. */
export async function draftSiteNotes(client: MessagesClient, input: { transcripts: { name: string; text: string }[]; customerName?: string; enquiry?: string }, opts: { model?: string } = {}): Promise<SiteNotesDraft> {
  const body = [
    input.customerName ? `Customer: ${input.customerName}` : "",
    input.enquiry ? `What they asked for when they enquired: ${input.enquiry}` : "",
    ...input.transcripts.map((t, i) => `--- Voice note ${i + 1} (${t.name}) ---\n${t.text}`),
  ].filter(Boolean).join("\n\n");
  const res = await client.beta.messages.create({
    model: opts.model || DEFAULT_MODEL,
    max_tokens: 16000,
    system: SYSTEM,
    output_config: { effort: "low", format: { type: "json_schema", schema: NOTES_SCHEMA as unknown as Record<string, unknown> } },
    messages: [{ role: "user", content: `${body}\n\nWrite up the site notes from these voice notes.` }],
  });
  if (res.stop_reason === "refusal") throw new Error("The AI declined to write up these notes.");
  if (res.stop_reason === "max_tokens") throw new Error("The write-up was cut short. Try again, or split very long recordings.");
  const text = res.content.filter((b): b is Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("").trim();
  if (!text) throw new Error("The AI didn't return any notes. Try again.");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("The AI's notes came back in a form ATLAS couldn't read. Nothing was changed. Try again.");
  }
  return parseDraft(raw);
}

/** Validates the model's tool input; anything malformed is dropped rather than saved. */
export function parseDraft(raw: unknown): SiteNotesDraft {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown, max = 5000) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const fields: SiteNotesDraft["fields"] = {};
  for (const k of NOTE_KEYS) {
    const v = str(o[k]);
    if (v) fields[k] = v;
  }
  const access = ACCESS.find((a) => a === o.accessDifficulty);
  const width = typeof o.accessWidthM === "number" && Number.isFinite(o.accessWidthM) && o.accessWidthM > 0 && o.accessWidthM < 100 ? o.accessWidthM : undefined;
  const draft: SiteNotesDraft = { summary: str(o.summary, 4000), fields, accessDifficulty: access, accessWidthM: width };

  const c = (o.customer && typeof o.customer === "object" ? o.customer : {}) as Record<string, unknown>;
  const customer: Partial<Record<CustomerKey, string>> = {};
  for (const k of CUSTOMER_KEYS) {
    let v = str(c[k], 200);
    if (k === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) v = "";
    if (k === "phone" && (v.replace(/\D/g, "").length < 8 || /[^\d\s()+-]/.test(v))) v = "";
    if (v) customer[k] = v;
  }
  if (Object.keys(customer).length) draft.customer = customer;

  const budget = pos(o.budgetDollars, 10_000_000);
  if (budget !== undefined) draft.budgetDollars = Math.round(budget);

  const ms: DraftMeasurement[] = [];
  for (const raw of Array.isArray(o.measurements) ? o.measurements.slice(0, 20) : []) {
    const m = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const workType = WORK_TYPES.find((w) => w === m.workType);
    const unit = UNITS.find((u) => u === m.unit);
    const zone = str(m.zone, 120);
    if (!workType || !unit || !zone) continue;
    const one: DraftMeasurement = { zone, workType, unit, note: str(m.note, 500) };
    for (const k of ["lengthM", "widthM", "heightM"] as const) { const v = pos(m[k], 1000); if (v !== undefined) one[k] = v; }
    const q = pos(m.quantity, 100_000);
    if (q !== undefined) one.quantity = q;
    if (one.quantity === undefined && one.lengthM === undefined) continue; // no number said, nothing to measure
    ms.push(one);
  }
  if (ms.length) draft.measurements = ms;
  return draft;
}

const pos = (v: unknown, max: number) => (typeof v === "number" && Number.isFinite(v) && v > 0 && v <= max ? v : undefined);

/**
 * Decides what to write. A box is filled when it is empty, or when it still
 * holds exactly what the AI wrote last time (nobody has edited it). Anything a
 * person typed is left alone.
 */
export function planFill(current: Partial<Record<NoteField, string | null>>, previousAi: Partial<Record<NoteField, string>>, draft: SiteNotesDraft) {
  const updates: Partial<Record<NoteField, string>> = {};
  const filled: NoteField[] = [];
  const kept: NoteField[] = [];
  for (const k of NOTE_KEYS) {
    const next = draft.fields[k];
    if (!next) continue;
    const now = (current[k] ?? "").trim();
    if (now === "" || now === (previousAi[k] ?? "").trim()) {
      if (now !== next) { updates[k] = next; filled.push(k); }
    } else {
      kept.push(k);
    }
  }
  return { updates, filled, kept };
}
