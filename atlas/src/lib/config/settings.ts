import { z } from "zod";
import { SCHEDULE_PRESETS } from "../finance/payments";

const stage = z.object({ label: z.string().min(1), rate: z.number().gt(0).lte(1) });

export const SettingsSchema = z.object({
  business: z.object({
    name: z.string(),
    abn: z.string().default(""),
    licenceNumber: z.string().default(""),
    phone: z.string().default(""),
    email: z.string().default(""),
    timezone: z.string().default("Australia/Sydney"),
  }),
  pricing: z.object({
    gstRate: z.number().min(0).max(1),
    defaultMarkup: z.number().min(0).max(5),
    overheadRate: z.number().min(0).max(1),
    contingencyRate: z.number().min(0).max(1),
    /** Manager overrides outside this margin band need a reason and owner approval. */
    minMargin: z.number().min(-1).max(1),
    maxMargin: z.number().min(-1).max(1),
    quoteValidityDays: z.number().int().positive(),
  }),
  commission: z.object({
    enabled: z.boolean(),
    rate: z.number().min(0).max(1),
    base: z.enum(["invoice_inc_gst", "revenue_ex_gst"]),
    treatment: z.enum(["absorb", "pass_through"]),
  }),
  payments: z.object({
    defaultSchedule: z.string(),
    schedules: z.record(z.string(), z.object({ name: z.string(), stages: z.array(stage).min(1) })),
    /** Warn when a deposit exceeds this. NSW Home Building Act caps residential deposits at 10% (verify for each contract). */
    maxDepositRate: z.number().min(0).max(1),
    dueDays: z.number().int().nonnegative(),
  }),
  labour: z.object({
    defaultRatePerPersonHourCents: z.number().int().nonnegative(),
    hoursPerDay: z.number().positive(),
  }),
  /** Quick-pick lists the owner keeps (shown first in the matching boxes). */
  lists: z.object({
    taskTitles: z.array(z.string()).default([]),
  }).default({ taskTitles: [] }),
});

export type Settings = z.infer<typeof SettingsSchema>;

/**
 * Defaults reflect what the Airtable base already uses (30% markup, 10% GST,
 * 6% marketing commission). Every value can be changed by the owner; nothing in
 * the app reads these numbers from anywhere else.
 */
export const DEFAULT_SETTINGS: Settings = {
  business: { name: "Whispering Leaf Landscaping & Construction", abn: "", licenceNumber: "", phone: "", email: "", timezone: "Australia/Sydney" },
  pricing: { gstRate: 0.1, defaultMarkup: 0.3, overheadRate: 0, contingencyRate: 0, minMargin: 0.15, maxMargin: 0.45, quoteValidityDays: 30 },
  commission: { enabled: true, rate: 0.06, base: "invoice_inc_gst", treatment: "absorb" },
  payments: { defaultSchedule: "fiveStage", schedules: SCHEDULE_PRESETS, maxDepositRate: 0.1, dueDays: 7 },
  labour: { defaultRatePerPersonHourCents: 4500, hoursPerDay: 8 },
  // From the manager's list of the tasks that come up most.
  lists: { taskTitles: ["Site Visit", "Submit New Design", "Create Estimate", "Send Action Plan", "Follow Up (Estimate)"] },
};

export function mergeSettings<T>(base: T, over: unknown): T {
  return deepMerge(base, over);
}

function deepMerge<T>(base: T, over: unknown): T {
  if (!over || typeof over !== "object" || Array.isArray(over)) return (over as T) ?? base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(over)) {
    const b = (base as Record<string, unknown>)[k];
    out[k] = b && typeof b === "object" && !Array.isArray(b) && k !== "schedules" ? deepMerge(b, v) : v;
  }
  return out as T;
}

/** Apply owner overrides (partial JSON) on top of defaults, then validate. */
export function resolveSettings(overrides?: unknown): Settings {
  const merged = deepMerge(DEFAULT_SETTINGS, overrides ?? {});
  const parsed = SettingsSchema.parse(merged);
  if (!parsed.payments.schedules[parsed.payments.defaultSchedule]) throw new Error(`Unknown default schedule ${parsed.payments.defaultSchedule}`);
  if (parsed.pricing.minMargin >= parsed.pricing.maxMargin) throw new Error("minMargin must be below maxMargin");
  return parsed;
}

/**
 * What the owner can change on the Settings page. Timezone stays a server
 * setting: changing it moves every "today" in the app.
 */
const pct = (max = 1) => z.number().finite().min(0).max(max);
export const SettingsEdit = z.object({
  business: z.object({
    name: z.string().trim().min(1, "Business name is required").max(200),
    abn: z.string().trim().max(40),
    licenceNumber: z.string().trim().max(60),
    phone: z.string().trim().max(40),
    email: z.string().trim().max(200),
  }),
  pricing: z.object({
    gstRate: pct(0.5),
    defaultMarkup: pct(5),
    overheadRate: pct(0.5),
    contingencyRate: pct(0.5),
    minMargin: z.number().finite().min(-1).max(1),
    maxMargin: z.number().finite().min(-1).max(1),
    quoteValidityDays: z.number().int().min(1).max(365),
  }),
  commission: z.object({
    enabled: z.boolean(),
    rate: pct(0.5),
    base: z.enum(["invoice_inc_gst", "revenue_ex_gst"]),
    treatment: z.enum(["absorb", "pass_through"]),
  }),
  payments: z.object({
    defaultSchedule: z.string().min(1),
    schedules: z.record(
      z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
      z.object({ name: z.string().trim().min(1, "Every schedule needs a name").max(100), stages: z.array(z.object({ label: z.string().trim().min(1, "Every stage needs a label").max(60), rate: z.number().gt(0).lte(1) })).min(1).max(12) }),
    ),
    maxDepositRate: pct(1),
    dueDays: z.number().int().min(0).max(120),
  }),
  labour: z.object({
    defaultRatePerPersonHourCents: z.number().int().min(0).max(100_000),
    hoursPerDay: z.number().gt(0).max(24),
  }),
  lists: z.object({
    taskTitles: z.array(z.string().trim().max(80, "Keep each common task under 80 characters")).max(30, "Keep the common tasks list to 30 or fewer")
      .transform((a) => cleanList(a)),
  }).optional(),
});
export type SettingsEditInput = z.infer<typeof SettingsEdit>;

/** Trimmed, blank lines dropped, repeats (ignoring case) removed. */
export function cleanList(a: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of a) {
    const v = raw.trim().replace(/\s+/g, " ");
    const k = v.toLowerCase();
    if (!v || seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

/** Rules that span fields. Returns plain-English problems; empty means fine. */
export function settingsProblems(s: Pick<Settings, "pricing" | "payments">): string[] {
  const out: string[] = [];
  if (s.pricing.minMargin >= s.pricing.maxMargin) out.push("The lowest margin must be below the highest margin");
  const keys = Object.keys(s.payments.schedules);
  if (keys.length === 0) out.push("Keep at least one payment schedule");
  if (!s.payments.schedules[s.payments.defaultSchedule]) out.push("Pick a default payment schedule that exists");
  for (const sch of Object.values(s.payments.schedules)) {
    const total = sch.stages.reduce((a, x) => a + Math.round(Number((x.rate * 10000).toPrecision(12))), 0);
    if (total !== 10000) out.push(`"${sch.name}" adds up to ${(total / 100).toFixed(2)}%, not 100%`);
  }
  return out;
}

/** Owner's edit applied to the current settings (timezone and anything not editable are kept). */
export function applySettingsEdit(current: Settings, edit: SettingsEditInput): Settings {
  const next: Settings = {
    business: { ...current.business, ...edit.business },
    pricing: { ...edit.pricing },
    commission: { ...edit.commission },
    payments: { ...edit.payments },
    labour: { ...edit.labour },
    lists: edit.lists ? { ...current.lists, ...edit.lists } : current.lists,
  };
  const parsed = SettingsSchema.parse(next);
  const problems = settingsProblems(parsed);
  if (problems.length) throw Object.assign(new Error(problems.join(". ")), { problems });
  return parsed;
}

/** Flat list of what changed, for the audit log. */
export function settingsChanges(before: unknown, after: unknown, prefix = ""): { path: string; from: unknown; to: unknown }[] {
  const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
  if (isObj(before) && isObj(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
    return keys.flatMap((k) => settingsChanges(before[k], after[k], prefix ? `${prefix}.${k}` : k));
  }
  return JSON.stringify(before) === JSON.stringify(after) ? [] : [{ path: prefix, from: before, to: after }];
}
