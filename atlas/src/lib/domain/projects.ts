import { z } from "zod";
import type { Rec } from "../data/entities";
import { componentFinancials, projectRollup, contractWithVariations, findLikelyDuplicateCosts, type ComponentFinancials } from "../finance/reconciliation";
import { timesheetTotals } from "../finance/labour";
import { exGst } from "../finance/pricing";
import { mulRate, sumCents, type Cents } from "../finance/money";
import { paymentState } from "../finance/payments";

/** Actual Costs are recorded inc GST in Airtable. ATLAS reports them ex GST, except labour which carries no GST. */
export function actualCostExGst(c: Pick<Rec<"actualCosts">, "unitCostInc" | "quantity" | "costType">, gstRate = 0.1): Cents {
  const inc = mulRate(c.unitCostInc ?? 0, c.quantity ?? 1);
  return c.costType === "Labour" ? inc : exGst(inc, gstRate);
}

export function timesheetCost(t: Pick<Rec<"timesheets">, "start" | "finish" | "breakMinutes" | "crewSize" | "rate" | "rateBasis">) {
  if (!t.start || !t.finish) return { labourHours: 0, personHours: 0, cost: 0 };
  return timesheetTotals({ start: t.start, finish: t.finish, breakMinutes: t.breakMinutes ?? 0, crewSize: t.crewSize ?? 1, rate: t.rate ?? 0, rateBasis: t.rateBasis === "Crew Total" ? "crew_total" : "per_person" });
}

export interface ProjectFinancials {
  components: ComponentFinancials[];
  unallocatedCost: Cents;
  unallocatedHours: number;
  revenue: Cents;
  totalCost: Cents;
  profit: Cents;
  margin: number | null;
  /** Profit from components that are completed with final revenue. Never includes work still underway. */
  completedProfit: Cents;
  completedRevenue: Cents;
  completedCount: number;
  /** Actual cost as a share of estimated cost, across all components. */
  costUsed: number | null;
  estimatedCost: Cents;
  personHours: number;
  unsubmittedTimesheets: number;
  duplicates: string[][];
  contract: ReturnType<typeof contractWithVariations>;
  payments: { scheduled: Cents; received: Cents; outstanding: Cents; overdue: Cents };
  rollupStatus: "ok" | "mismatch" | "no_detail";
  revenueGap: Cents | null;
}

/**
 * One calculation for project money, used by the project page, finance
 * dashboards and the AI assistant. Revenue is component revenue (ex GST);
 * the contract figures are inc GST, as quoted.
 */
export function projectFinancials(
  project: Rec<"projects">,
  components: Rec<"components">[],
  costs: Rec<"actualCosts">[],
  timesheets: Rec<"timesheets">[],
  variations: Rec<"variations">[],
  payments: Rec<"payments">[],
  today: string,
  gstRate = 0.1,
): ProjectFinancials {
  const submitted = timesheets.filter((t) => t.submitted);
  const comps = components.map((c) =>
    componentFinancials({
      id: c.id,
      name: c.label ? String(c.label).split("·").pop()!.trim() : c.componentType ?? "Component",
      status: c.status ?? "",
      quotedRevenue: c.quotedRevenue ?? 0,
      finalRevenue: c.finalRevenue ?? null,
      estimatedCost: c.estimatedCost ?? 0,
      estimatedPersonHours: c.estimatedHours ?? 0,
      actualCostLines: costs.filter((x) => x.componentIds?.includes(c.id)).map((x) => actualCostExGst(x, gstRate)),
      submittedLabourCost: sumCents(submitted.filter((t) => t.componentIds?.includes(c.id)).map((t) => timesheetCost(t).cost)),
      submittedPersonHours: submitted.filter((t) => t.componentIds?.includes(c.id)).reduce((a, t) => a + timesheetCost(t).personHours, 0),
      unitemisedCostAdjustment: c.unitemisedCostAdj ?? 0,
      unitemisedHoursAdjustment: c.unitemisedHoursAdj ?? 0,
      actualDays: c.actualDays ?? null,
      isSharedCosts: c.componentType === "Shared Project Costs",
    }),
  );
  const unallocCosts = costs.filter((x) => !x.componentIds?.length);
  const unallocTs = submitted.filter((t) => !t.componentIds?.length);
  const unallocatedCost = sumCents(unallocCosts.map((x) => actualCostExGst(x, gstRate))) + sumCents(unallocTs.map((t) => timesheetCost(t).cost));
  const unallocatedHours = Math.round(unallocTs.reduce((a, t) => a + timesheetCost(t).personHours, 0) * 100) / 100;
  const roll = projectRollup(comps, null);
  const totalCost = roll.reconciledCost + unallocatedCost;
  const profit = roll.revenue - totalCost;

  const live = payments.filter((p) => !p.archived);
  let received = 0;
  let overdue = 0;
  for (const p of live) {
    const rec = p.status === "Paid" || p.receivedDate ? p.amount ?? 0 : 0;
    received += rec;
    if (paymentState({ amount: p.amount ?? 0, received: rec, dueDate: p.dueDate ?? null }, today) === "overdue") overdue += p.amount ?? 0;
  }
  const scheduled = sumCents(live.map((p) => p.amount));
  const contract = contractWithVariations(project.estValue ?? 0, variations.map((v) => ({ status: v.status ?? "", customerPrice: v.customerPrice ?? 0, estimatedCost: v.estimatedCost ?? 0 })));
  const revenueIncGst = roll.revenue + Math.round(roll.revenue * gstRate);
  const revenueGap = project.estValue && roll.revenue ? contract.original - revenueIncGst : null;

  const done = comps.filter((c) => c.actualProfit !== null);
  const completedProfit = sumCents(done.map((c) => c.actualProfit));
  const completedRevenue = sumCents(done.map((c) => c.revenue));
  return {
    completedProfit,
    completedRevenue,
    completedCount: done.length,
    costUsed: roll.estimatedCost > 0 ? totalCost / roll.estimatedCost : null,
    components: comps,
    unallocatedCost,
    unallocatedHours,
    revenue: roll.revenue,
    totalCost,
    profit,
    margin: roll.revenue > 0 ? profit / roll.revenue : null,
    estimatedCost: roll.estimatedCost,
    personHours: roll.personHours + unallocatedHours,
    unsubmittedTimesheets: timesheets.length - submitted.length,
    duplicates: findLikelyDuplicateCosts(costs.map((x) => ({ id: x.id, projectId: x.projectIds?.[0] ?? null, componentId: x.componentIds?.[0] ?? null, supplier: x.supplier ?? "", amount: actualCostExGst(x, gstRate), date: x.costDate ?? null, reference: x.reference ?? "" }))),
    contract,
    payments: { scheduled, received, outstanding: scheduled - received, overdue },
    rollupStatus: roll.status === "no_detail" ? "no_detail" : revenueGap !== null && Math.abs(revenueGap) > 100 ? "mismatch" : "ok",
    revenueGap,
  };
}

const recId = z.string().regex(/^rec[A-Za-z0-9]{14}$/);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const COST_TYPES = ["Material", "Labour", "Equipment", "Subcontractor", "Delivery", "Disposal", "Permit", "Consumable", "Other"] as const;

export const CostCreate = z.object({
  componentId: recId.optional(),
  costType: z.enum(COST_TYPES),
  supplier: z.string().trim().min(1).max(120),
  description: z.string().trim().min(2).max(200),
  amountIncGstCents: z.number().int().positive(),
  costDate: date,
  reference: z.string().trim().max(80).optional(),
  unplanned: z.boolean().default(false),
  notes: z.string().max(2000).optional(),
});

export const TimesheetCreate = z
  .object({
    projectId: recId,
    componentId: recId.optional(),
    workDate: date,
    startTime: z.string().regex(/^\d{2}:\d{2}$/),
    finishTime: z.string().regex(/^\d{2}:\d{2}$/),
    breakMinutes: z.number().int().min(0).max(240).default(30),
    crewSize: z.number().int().min(1).max(20).default(1),
    workType: z.enum(["Construction", "Travel / Pickup", "Site Setup", "Rework", "Variation", "Management / Supervision", "Other"]).default("Construction"),
    notes: z.string().max(2000).optional(),
    reworkReason: z.string().max(500).optional(),
  })
  .refine((t) => t.finishTime > t.startTime, { message: "Finish must be after start", path: ["finishTime"] })
  .refine((t) => t.workType !== "Rework" || !!t.reworkReason?.trim(), { message: "Say why the rework was needed", path: ["reworkReason"] });

export const VariationCreate = z.object({
  componentId: recId.optional(),
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().min(3).max(5000),
  requestedBy: z.enum(["Customer", "Whispering Leaf", "Site Condition", "Consultant / Authority", "Other"]),
  estimatedCostCents: z.number().int().nonnegative(),
  customerPriceIncGstCents: z.number().int().nonnegative(),
  scheduleImpactDays: z.number().int().min(0).max(365).default(0),
});

export const ProjectUpdate = z.object({
  status: z.enum(["Proposed", "Accepted / Pre-start", "In Progress", "On Hold", "Completed", "Cancelled"]).optional(),
  health: z.enum(["On Track", "At Risk", "Delayed", "Completed"]).optional(),
  progress: z.number().min(0).max(1).optional(),
  nextAction: z.string().trim().max(200).optional(),
  nextActionDate: date.nullable().optional(),
  startDate: date.nullable().optional(),
  completionDate: date.nullable().optional(),
  siteAccessNotes: z.string().max(5000).optional(),
  crewNotes: z.string().max(5000).optional(),
  notes: z.string().max(5000).optional(),
});

export const ScheduleCreate = z.object({
  title: z.string().trim().min(2).max(200),
  type: z.enum(["Work", "Milestone", "Site Visit", "Material Delivery", "Inspection", "Client Meeting", "Payment", "Other"]),
  plannedStart: date,
  plannedFinish: date.optional(),
  assignedTo: z.string().trim().max(100).optional(),
  componentId: recId.optional(),
  customerVisible: z.boolean().default(false),
});
