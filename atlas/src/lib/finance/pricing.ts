import { type Cents, mulRate, sumCents } from "./money";

/**
 * Pricing engine.
 *
 * Conventions (deliberate, see docs/FINANCIAL_RULES.md):
 * - Every cost going into a price is GST-EXCLUSIVE. Supplier prices recorded
 *   inc GST are converted first with exGst(). GST paid to suppliers is an input
 *   tax credit, not a job cost, for a GST-registered business.
 * - Markup is applied to the ex-GST cost base. GST is added once, at the end.
 * - Markup and margin are different numbers and are both reported.
 *     markup = profit / cost      margin = profit / selling price (ex GST)
 * - Marketing commission is a cost of winning the job. It is calculated on a
 *   configurable base and either absorbed (reduces profit) or passed through
 *   (price grossed up so the target profit is still achieved).
 */

export const DEFAULT_GST_RATE = 0.1;

export function exGst(incCents: Cents, gstRate = DEFAULT_GST_RATE): Cents {
  return Math.round(incCents / (1 + gstRate));
}

export function gstOn(exCents: Cents, gstRate = DEFAULT_GST_RATE): Cents {
  return mulRate(exCents, gstRate);
}

export function incGst(exCents: Cents, gstRate = DEFAULT_GST_RATE): Cents {
  return exCents + gstOn(exCents, gstRate);
}

export function markupToMargin(markup: number): number {
  return markup / (1 + markup);
}

export function marginToMarkup(margin: number): number {
  if (margin >= 1) throw new RangeError("Margin must be below 100%");
  return margin / (1 - margin);
}

export type CostCategory =
  | "material"
  | "labour"
  | "subcontractor"
  | "equipment"
  | "delivery"
  | "disposal"
  | "permit"
  | "consumable"
  | "other";

export interface CostBreakdown {
  byCategory: Partial<Record<CostCategory, Cents>>;
  /** Overhead allowance as a fixed amount (ex GST). */
  overheadFixed?: Cents;
  /** Overhead allowance as a rate of direct cost. Applied in addition to overheadFixed. */
  overheadRate?: number;
  /** Contingency rate applied to (direct + overhead). */
  contingencyRate?: number;
}

export type CommissionBase = "invoice_inc_gst" | "revenue_ex_gst";
export type CommissionTreatment = "absorb" | "pass_through";

export interface PricingInput {
  costs: CostBreakdown;
  markupRate: number;
  gstRate?: number;
  /** Manager-approved selling price ex GST that replaces the recommended price. */
  managerOverrideExGst?: Cents | null;
  commission?: { rate: number; base: CommissionBase; treatment: CommissionTreatment } | null;
}

export interface PricingResult {
  directCost: Cents;
  overhead: Cents;
  contingency: Cents;
  /** direct + overhead + contingency. The base markup is applied to. */
  costBase: Cents;
  markupRate: number;
  recommendedExGst: Cents;
  sellExGst: Cents;
  gst: Cents;
  sellIncGst: Cents;
  commission: Cents;
  commissionBase: Cents;
  /** Selling price ex GST minus cost base. Before commission. */
  grossProfit: Cents;
  /** Gross profit minus commission. */
  operatingProfit: Cents;
  /** Achieved markup on cost base (gross profit / cost base). */
  achievedMarkup: number | null;
  /** Gross margin (gross profit / sell ex GST). */
  grossMargin: number | null;
  /** Operating margin after commission (operating profit / sell ex GST). */
  operatingMargin: number | null;
  overridden: boolean;
  warnings: string[];
}

export function priceJob(input: PricingInput): PricingResult {
  const gstRate = input.gstRate ?? DEFAULT_GST_RATE;
  const warnings: string[] = [];
  if (input.markupRate < 0) throw new RangeError("Markup cannot be negative");

  const directCost = sumCents(Object.values(input.costs.byCategory));
  const overhead = (input.costs.overheadFixed ?? 0) + mulRate(directCost, input.costs.overheadRate ?? 0);
  const contingency = mulRate(directCost + overhead, input.costs.contingencyRate ?? 0);
  const costBase = directCost + overhead + contingency;

  let recommendedExGst = costBase + mulRate(costBase, input.markupRate);

  const commissionCfg = input.commission && input.commission.rate > 0 ? input.commission : null;
  if (commissionCfg && commissionCfg.treatment === "pass_through") {
    // Gross up so that sell - commission(sell) = cost base * (1 + markup).
    const baseFactor = commissionCfg.base === "invoice_inc_gst" ? 1 + gstRate : 1;
    const denom = 1 - commissionCfg.rate * baseFactor;
    if (denom <= 0) throw new RangeError("Commission rate too high to pass through");
    recommendedExGst = Math.round(recommendedExGst / denom);
  }

  const overridden = typeof input.managerOverrideExGst === "number" && input.managerOverrideExGst > 0;
  const sellExGst = overridden ? (input.managerOverrideExGst as Cents) : recommendedExGst;
  const gst = gstOn(sellExGst, gstRate);
  const sellIncGst = sellExGst + gst;

  let commission = 0;
  let commissionBase = 0;
  if (commissionCfg) {
    commissionBase = commissionCfg.base === "invoice_inc_gst" ? sellIncGst : sellExGst;
    commission = mulRate(commissionBase, commissionCfg.rate);
  }

  const grossProfit = sellExGst - costBase;
  const operatingProfit = grossProfit - commission;
  const achievedMarkup = costBase > 0 ? grossProfit / costBase : null;
  const grossMargin = sellExGst > 0 ? grossProfit / sellExGst : null;
  const operatingMargin = sellExGst > 0 ? operatingProfit / sellExGst : null;

  if (directCost === 0) warnings.push("No direct costs entered");
  if (sellExGst < costBase) warnings.push("Selling price is below cost");
  if (operatingProfit < 0) warnings.push("Job loses money after commission");

  return {
    directCost,
    overhead,
    contingency,
    costBase,
    markupRate: input.markupRate,
    recommendedExGst,
    sellExGst,
    gst,
    sellIncGst,
    commission,
    commissionBase,
    grossProfit,
    operatingProfit,
    achievedMarkup,
    grossMargin,
    operatingMargin,
    overridden,
    warnings,
  };
}

export interface OverrideBand {
  minMargin: number;
  maxMargin: number;
}

/** Flags a manager override whose margin falls outside the allowed band. */
export function checkOverride(result: PricingResult, band: OverrideBand): string | null {
  if (!result.overridden || result.grossMargin === null) return null;
  if (result.grossMargin < band.minMargin)
    return `Override margin ${(result.grossMargin * 100).toFixed(1)}% is below the minimum ${(band.minMargin * 100).toFixed(0)}%`;
  if (result.grossMargin > band.maxMargin)
    return `Override margin ${(result.grossMargin * 100).toFixed(1)}% is above ${(band.maxMargin * 100).toFixed(0)}%. Check the estimate is complete.`;
  return null;
}
