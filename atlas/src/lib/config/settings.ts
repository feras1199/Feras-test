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
    schedules: z.record(z.object({ name: z.string(), stages: z.array(stage).min(1) })),
    /** Warn when a deposit exceeds this. NSW Home Building Act caps residential deposits at 10% (verify for each contract). */
    maxDepositRate: z.number().min(0).max(1),
    dueDays: z.number().int().nonnegative(),
  }),
  labour: z.object({
    defaultRatePerPersonHourCents: z.number().int().nonnegative(),
    hoursPerDay: z.number().positive(),
  }),
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
};

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
