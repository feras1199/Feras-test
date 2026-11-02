import { type Cents, sumCents } from "./money";

export interface ComponentFinancialsInput {
  id: string;
  name: string;
  status: string;
  quotedRevenue: Cents;
  finalRevenue: Cents | null;
  estimatedCost: Cents;
  estimatedPersonHours: number;
  /** Itemised actual cost lines linked to this component (ex GST). */
  actualCostLines: Cents[];
  /** Labour cost from SUBMITTED timesheets only. */
  submittedLabourCost: Cents;
  submittedPersonHours: number;
  unitemisedCostAdjustment: Cents;
  unitemisedHoursAdjustment: number;
  actualDays: number | null;
  isSharedCosts?: boolean;
}

export interface ComponentFinancials {
  id: string;
  name: string;
  revenue: Cents; // final if known, else quoted
  revenueIsFinal: boolean;
  estimatedCost: Cents;
  estimatedProfit: Cents;
  estimatedMargin: number | null;
  reconciledCost: Cents;
  reconciledPersonHours: number;
  actualProfit: Cents | null;
  actualMargin: number | null;
  costVariance: Cents;
  profitPerDay: Cents | null;
  revenuePerLabourHour: Cents | null;
  issues: string[];
}

/**
 * One definition of component actuals used everywhere in ATLAS. It matches the
 * Airtable "Reconciled Actual Cost" formula: itemised costs + submitted labour +
 * unitemised adjustment. Dashboards must not compute profit any other way.
 */
export function componentFinancials(c: ComponentFinancialsInput): ComponentFinancials {
  const issues: string[] = [];
  const reconciledCost = sumCents(c.actualCostLines) + c.submittedLabourCost + c.unitemisedCostAdjustment;
  const reconciledPersonHours = Math.round((c.submittedPersonHours + c.unitemisedHoursAdjustment) * 100) / 100;
  const revenueIsFinal = c.finalRevenue !== null;
  const revenue = c.finalRevenue ?? c.quotedRevenue;
  const estimatedProfit = c.quotedRevenue - c.estimatedCost;
  const completed = c.status === "Completed";
  const actualProfit = completed && (revenueIsFinal || c.isSharedCosts) ? revenue - reconciledCost : null;
  const actualMargin = actualProfit !== null && revenue > 0 ? actualProfit / revenue : null;

  if (c.unitemisedCostAdjustment > 0 || c.unitemisedHoursAdjustment > 0) issues.push("Unitemised cost or hours remain");
  if (completed && !revenueIsFinal && !c.isSharedCosts) issues.push("Completed without final revenue");
  if (completed && reconciledPersonHours === 0 && !c.isSharedCosts) issues.push("Completed without labour hours");

  return {
    id: c.id,
    name: c.name,
    revenue,
    revenueIsFinal,
    estimatedCost: c.estimatedCost,
    estimatedProfit,
    estimatedMargin: c.quotedRevenue > 0 ? estimatedProfit / c.quotedRevenue : null,
    reconciledCost,
    reconciledPersonHours,
    actualProfit,
    actualMargin,
    costVariance: reconciledCost - c.estimatedCost,
    profitPerDay: actualProfit !== null && c.actualDays && c.actualDays > 0 ? Math.round(actualProfit / c.actualDays) : null,
    revenuePerLabourHour: completed && reconciledPersonHours > 0 ? Math.round(revenue / reconciledPersonHours) : null,
    issues,
  };
}

export interface ProjectRollup {
  revenue: Cents;
  reconciledCost: Cents;
  profit: Cents;
  margin: number | null;
  estimatedCost: Cents;
  estimatedProfit: Cents;
  personHours: number;
  /** Difference between a separately recorded project value and the component total. */
  revenueGap: Cents | null;
  status: "ok" | "mismatch" | "no_detail";
}

export function projectRollup(components: ComponentFinancials[], recordedProjectValue?: Cents | null): ProjectRollup {
  const revenue = sumCents(components.map((c) => c.revenue));
  const reconciledCost = sumCents(components.map((c) => c.reconciledCost));
  const estimatedCost = sumCents(components.map((c) => c.estimatedCost));
  const estimatedProfit = sumCents(components.map((c) => c.estimatedProfit));
  const personHours = Math.round(components.reduce((a, c) => a + c.reconciledPersonHours, 0) * 100) / 100;
  const profit = revenue - reconciledCost;
  const revenueGap = typeof recordedProjectValue === "number" && recordedProjectValue > 0 ? recordedProjectValue - revenue : null;
  let status: ProjectRollup["status"] = "ok";
  if (revenue === 0 && reconciledCost === 0) status = "no_detail";
  else if (revenueGap !== null && Math.abs(revenueGap) > 1) status = "mismatch";
  return { revenue, reconciledCost, profit, margin: revenue > 0 ? profit / revenue : null, estimatedCost, estimatedProfit, personHours, revenueGap, status };
}

export interface CostLineForDuplicateCheck {
  id: string;
  projectId: string | null;
  componentId: string | null;
  supplier: string;
  amount: Cents;
  date: string | null;
  reference: string;
}

/** Groups cost lines that look like the same purchase entered twice. */
export function findLikelyDuplicateCosts(lines: CostLineForDuplicateCheck[]): string[][] {
  const groups = new Map<string, string[]>();
  for (const l of lines) {
    if (!l.amount) continue;
    const ref = l.reference.trim().toLowerCase();
    const key = ref
      ? `${l.projectId}|ref:${ref}|${l.amount}`
      : `${l.projectId}|${l.supplier.trim().toLowerCase()}|${l.amount}|${l.date}`;
    const g = groups.get(key) ?? [];
    g.push(l.id);
    groups.set(key, g);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}

export function unallocatedCosts(lines: CostLineForDuplicateCheck[]): string[] {
  return lines.filter((l) => !l.projectId || !l.componentId).map((l) => l.id);
}

export interface VariationLike {
  status: "Pending" | "Approved" | "Rejected" | "Cancelled" | string;
  customerPrice: Cents;
  estimatedCost: Cents;
}

/** Only approved variations change contract value. Pending ones are reported separately. */
export function contractWithVariations(originalContract: Cents, variations: VariationLike[]) {
  const approved = variations.filter((v) => v.status === "Approved");
  const pending = variations.filter((v) => v.status === "Pending");
  return {
    original: originalContract,
    approvedVariations: sumCents(approved.map((v) => v.customerPrice)),
    approvedVariationCost: sumCents(approved.map((v) => v.estimatedCost)),
    pendingVariations: sumCents(pending.map((v) => v.customerPrice)),
    current: originalContract + sumCents(approved.map((v) => v.customerPrice)),
  };
}
