import type * as Beta from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { MessagesClient } from "./assistant";
import { DEFAULT_MODEL } from "./assistant";

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

export interface SiteNotesDraft {
  summary: string;
  fields: Partial<Record<NoteField, string>>;
  accessDifficulty?: (typeof ACCESS)[number];
  accessWidthM?: number;
}

const SYSTEM = `You write up site visit notes for Whispering Leaf Landscaping & Construction in Sydney, Australia.
You are given transcripts of voice notes recorded at a customer's property. They may be the builder talking alone or a conversation with the customer, and speech-to-text may have small errors.

Rules:
- Use only what was said. If a topic wasn't mentioned, leave that field as an empty string. Never invent measurements, prices, dates, materials or names.
- Keep numbers exactly as spoken (sizes, budgets, widths). If something is unclear, write "(unclear in recording)" rather than guessing.
- Write short, practical notes in Australian English, as a builder would: dot points or short sentences.
- The summary is for the business owner: who was there if known, what the customer wants, key site facts, budget or timing if mentioned, and next steps agreed. 5 to 10 short lines.
- Customer-facing promises (prices, start dates) should be quoted, not reinterpreted.`;

/**
 * The answer comes back as JSON matching this schema (structured outputs). Forcing a tool call
 * isn't allowed on current Claude models, so the schema does the job a forced tool used to.
 */
const NOTES_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "Meeting summary for the owner." },
    ...Object.fromEntries(Object.entries(NOTE_FIELDS).map(([k, label]) => [k, { type: "string", description: `${label}. Empty string if not discussed.` }])),
    accessDifficulty: { type: "string", enum: ["", ...ACCESS], description: "How hard it is to get machines and materials in. Empty if not discussed." },
    accessWidthM: { anyOf: [{ type: "number" }, { type: "null" }], description: "Narrowest access width in metres, only if a number was said; otherwise null." },
  },
  required: ["summary", ...Object.keys(NOTE_FIELDS), "accessDifficulty", "accessWidthM"],
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
  return { summary: str(o.summary, 4000), fields, accessDifficulty: access, accessWidthM: width };
}

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
