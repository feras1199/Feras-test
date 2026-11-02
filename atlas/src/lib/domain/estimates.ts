import { z } from "zod";
import type { Rec } from "../data/entities";
import type { Settings } from "../config/settings";
import { priceJob, checkOverride, type CostCategory, type PricingResult } from "../finance/pricing";
import { splitSchedule, depositWarning, validateSchedule, type ScheduleStage, type ScheduledPayment } from "../finance/payments";
import { runEstimateChecks, blockingFailures, type QualityCheck } from "../finance/estimateChecks";
import type { Cents } from "../finance/money";

export const COST_TYPES = ["Material", "Labour", "Equipment", "Subcontractor", "Delivery", "Disposal", "Permit", "Consumable", "Other"] as const;
export type CostType = (typeof COST_TYPES)[number];
export const toCategory = (t: string | null | undefined): CostCategory => (t ? (t.toLowerCase() as CostCategory) : "other");

/** Lines that make up the base price. Optional upgrades and alternatives are priced separately. */
export const inBasePrice = (l: Pick<Rec<"estimateLines">, "included" | "proposalOption">) =>
  l.included !== false && (!l.proposalOption || l.proposalOption === "Included" || l.proposalOption === "Internal Only");

/**
 * Ex-GST line cost, identical to the Airtable "Line Cost" formula:
 * ROUND(qty × (1 + waste) × unitCostSnapshot / (1 + inputGstRate if net pricing)).
 */
export function lineCostExGst(l: Pick<Rec<"estimateLines">, "quantity" | "wasteRate" | "unitCostSnapshot" | "netCostPricing" | "inputGstRate">): Cents {
  const q = l.quantity ?? 0;
  const unit = l.unitCostSnapshot ?? 0;
  if (!(q > 0) || !unit) return 0;
  const divisor = l.netCostPricing ? 1 + (l.inputGstRate ?? 0) : 1;
  return Math.round((q * (1 + (l.wasteRate ?? 0)) * unit) / divisor);
}

const STAGE_FIELDS = ["depositRate", "progress1Rate", "progress2Rate", "progress3Rate", "finalRate"] as const;
const STAGE_LABELS = ["Deposit", "Progress 1", "Progress 2", "Progress 3", "Final"];

export function scheduleFromEstimate(e: Partial<Rec<"estimates">>): ScheduleStage[] {
  return STAGE_FIELDS.map((f, i) => ({ label: STAGE_LABELS[i]!, rate: (e[f] as number | null | undefined) ?? 0 })).filter((s) => s.rate > 0);
}

/** Map a named schedule onto the five Airtable rate fields (deposit, three progress, final). */
export function scheduleToFields(stages: ScheduleStage[]): Pick<Rec<"estimates">, (typeof STAGE_FIELDS)[number]> {
  if (stages.length < 2 || stages.length > 5) throw new Error("A schedule needs between 2 and 5 stages");
  const out = { depositRate: 0, progress1Rate: 0, progress2Rate: 0, progress3Rate: 0, finalRate: 0 } as Record<(typeof STAGE_FIELDS)[number], number>;
  out.depositRate = stages[0]!.rate;
  out.finalRate = stages[stages.length - 1]!.rate;
  stages.slice(1, -1).forEach((s, i) => (out[STAGE_FIELDS[i + 1]!] = s.rate));
  return out;
}

export interface EstimateSummary {
  pricing: PricingResult;
  costByCategory: Partial<Record<CostCategory, Cents>>;
  optionalExtras: { id: string; description: string; costExGst: Cents; priceExGst: Cents }[];
  personHours: number;
  schedule: ScheduledPayment[] | null;
  scheduleErrors: string[];
  warnings: string[];
  checks: QualityCheck[];
  blocking: QualityCheck[];
}

export function summarise(
  estimate: Partial<Rec<"estimates">>,
  lines: Rec<"estimateLines">[],
  settings: Settings,
  ctx: { componentTypes: string[]; measurementsLinked: number; today: string; priceDates?: Record<string, { date: string | null; confidence: string | null }> },
): EstimateSummary {
  const base = lines.filter(inBasePrice);
  const costByCategory: Partial<Record<CostCategory, Cents>> = {};
  for (const l of base) {
    const cat = toCategory(l.costType);
    costByCategory[cat] = (costByCategory[cat] ?? 0) + lineCostExGst(l);
  }
  const markupRate = estimate.markupOverride ?? settings.pricing.defaultMarkup;
  const commissionRate = estimate.commissionRate ?? 0;
  const pricing = priceJob({
    costs: { byCategory: costByCategory, overheadFixed: estimate.overheadAllowance ?? 0, overheadRate: settings.pricing.overheadRate, contingencyRate: estimate.contingencyRate ?? settings.pricing.contingencyRate },
    markupRate,
    gstRate: settings.pricing.gstRate,
    managerOverrideExGst: estimate.managerOverride ?? null,
    commission: commissionRate > 0 ? { rate: commissionRate, base: settings.commission.base, treatment: settings.commission.treatment } : null,
  });

  const warnings = [...pricing.warnings];
  const band = checkOverride(pricing, { minMargin: settings.pricing.minMargin, maxMargin: settings.pricing.maxMargin });
  if (band) warnings.push(band);
  if (markupRate !== settings.pricing.defaultMarkup) warnings.push(`Markup ${(markupRate * 100).toFixed(1)}% differs from the standard ${(settings.pricing.defaultMarkup * 100).toFixed(0)}%`);

  const stages = scheduleFromEstimate(estimate);
  const scheduleErrors = validateSchedule(stages);
  const schedule = scheduleErrors.length ? null : splitSchedule(pricing.sellIncGst, stages);
  const dep = depositWarning(stages, { maxDepositRate: settings.payments.maxDepositRate });
  if (dep) warnings.push(dep);

  const optionalExtras = lines
    .filter((l) => l.included !== false && (l.proposalOption === "Optional Upgrade" || l.proposalOption === "Alternative"))
    .map((l) => {
      const cost = lineCostExGst(l);
      return { id: l.id, description: l.customerDescription || l.description || "Option", costExGst: cost, priceExGst: Math.round(cost * (1 + markupRate)) };
    });

  const checks = runEstimateChecks({
    componentTypes: ctx.componentTypes,
    lines: base.map((l) => ({
      description: l.description ?? "(no description)",
      category: toCategory(l.costType),
      quantity: l.quantity ?? 0,
      unitCostCents: l.unitCostSnapshot ?? 0,
      quantityVerified: !!l.quantityVerified,
      aiSuggested: !!l.aiSuggested,
      priceUpdatedDate: ctx.priceDates?.[l.costItemIds?.[0] ?? ""]?.date ?? (l.costType === "Material" ? null : ctx.today),
      priceConfidence: (ctx.priceDates?.[l.costItemIds?.[0] ?? ""]?.confidence as never) ?? null,
      hoursPerUnit: null,
    })),
    measurementsLinked: ctx.measurementsLinked,
    hasCustomerScope: !!estimate.customerScope?.trim(),
    exclusionsResolved: !!estimate.assumptionsResolved,
    today: ctx.today,
  });
  if (scheduleErrors.length) checks.push({ id: "schedule", label: "Payment schedule totals 100%", severity: "block", passed: false, detail: scheduleErrors.join("; ") });
  if (band) checks.push({ id: "override", label: "Price within approved margin band", severity: "block", passed: false, detail: band });

  const personHours = Math.round(base.filter((l) => l.costType === "Labour").reduce((a, l) => a + (l.quantity ?? 0), 0) * 100) / 100;
  return { pricing, costByCategory, optionalExtras, personHours, schedule, scheduleErrors, warnings, checks, blocking: blockingFailures(checks) };
}

/** Immutable record of what was approved. Stored on the estimate as JSON; the quote and payments are built from it. */
export interface QuoteSnapshot {
  version: 1;
  approvedAt: string;
  approvedBy: string;
  quoteNumber: string;
  customerScope: string;
  assumptions: string;
  validUntil: string;
  gstRate: number;
  pricing: Pick<PricingResult, "costBase" | "sellExGst" | "gst" | "sellIncGst" | "markupRate" | "grossMargin" | "commission" | "overridden">;
  schedule: ScheduledPayment[];
  lines: { id: string; description: string; costType: string; quantity: number; unit: string; costExGst: Cents; customerDescription: string; option: string }[];
  optionalExtras: EstimateSummary["optionalExtras"];
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const EstimateCreate = z.object({
  customerId: z.string().regex(/^rec[A-Za-z0-9]{14}$/),
  enquiryId: z.string().regex(/^rec[A-Za-z0-9]{14}$/).optional(),
  title: z.string().trim().min(3).max(200),
  estimateType: z.enum(["Preliminary ±10%", "Detailed Estimate", "Formal Quote"]).default("Formal Quote"),
});

export const EstimateUpdate = z.object({
  title: z.string().trim().min(3).max(200).optional(),
  customerScope: z.string().max(10000).optional(),
  assumptions: z.string().max(10000).optional(),
  proposalIntro: z.string().max(5000).optional(),
  internalReviewNotes: z.string().max(5000).optional(),
  markupOverride: z.number().min(0).max(5).nullable().optional(),
  managerOverride: z.number().int().positive().nullable().optional(),
  overheadAllowance: z.number().int().nonnegative().nullable().optional(),
  contingencyRate: z.number().min(0).max(1).nullable().optional(),
  commissionRate: z.number().min(0).max(0.5).nullable().optional(),
  schedule: z.array(z.object({ label: z.string(), rate: z.number().gt(0).lte(1) })).min(2).max(5).optional(),
  validUntil: date.optional(),
  assumptionsResolved: z.boolean().optional(),
  scopeReviewComplete: z.boolean().optional(),
  costAuditComplete: z.boolean().optional(),
});

export const LineInput = z.object({
  description: z.string().trim().min(2).max(300),
  costType: z.enum(COST_TYPES),
  quantity: z.number().nonnegative().max(1_000_000),
  unit: z.string().trim().max(30).default(""),
  wasteRate: z.number().min(0).max(1).default(0),
  /** Unit price in cents as entered. */
  unitCostCents: z.number().int().nonnegative(),
  priceIncludesGst: z.boolean().default(false),
  customerDescription: z.string().max(1000).optional(),
  proposalOption: z.enum(["Included", "Optional Upgrade", "Alternative", "Internal Only"]).default("Included"),
  quantityVerified: z.boolean().default(false),
  costItemId: z.string().regex(/^rec[A-Za-z0-9]{14}$/).optional(),
  notes: z.string().max(2000).optional(),
});
export type LineInput = z.infer<typeof LineInput>;

/** Convert form input to the Airtable line shape (net cost pricing, so Line Cost lands ex GST). */
export function lineFields(i: LineInput, gstRate: number): Partial<Rec<"estimateLines">> {
  const labour = i.costType === "Labour";
  return {
    description: i.description,
    costType: i.costType,
    quantity: i.quantity,
    unitSnapshot: i.unit || (labour ? "person-hour" : ""),
    wasteRate: labour ? 0 : i.wasteRate,
    unitCostSnapshot: i.unitCostCents,
    netCostPricing: true,
    inputGstRate: i.priceIncludesGst && !labour ? gstRate : 0,
    customerDescription: i.customerDescription ?? "",
    proposalOption: i.proposalOption,
    included: true,
    quantityVerified: i.quantityVerified,
    quantityBasis: labour ? "Manual quantity" : "Manual quantity",
    labourHours: labour ? i.quantity : null,
    labourRate: labour ? i.unitCostCents : null,
    costItemIds: i.costItemId ? [i.costItemId] : [],
    notes: i.notes ?? "",
  };
}
