import type { EntityName, Rec } from "../data/entities";
import { can, type Role } from "./roles";

/**
 * Fields hidden from roles without costs.view / profit.view. Applied on the
 * server before anything is sent to the browser. Customers never receive these.
 */
const COST_FIELDS: Partial<Record<EntityName, string[]>> = {
  projects: ["estimatedProfit", "estimatedCostSnapshot", "costIds"],
  components: ["estimatedCost", "unitemisedCostAdj", "costIds", "markupOverride", "costVarianceReason"],
  estimates: ["estimatedCost", "overheadAllowance", "contingencyRate", "unitemisedCost", "markupOverride", "managerOverride", "commissionRate", "commissionBaseSnapshot", "internalReviewNotes", "snapshotJson"],
  estimateLines: ["unitCostSnapshot", "supplierSnapshot", "lineCost", "labourRate", "labourHours", "labourExplanation", "notes", "omissionRisk"],
  timesheets: ["rate"],
  actualCosts: ["unitCostInc", "quantity", "supplier", "reference"],
  variations: ["estimatedCost", "notes"],
  costItems: ["currentUnitCostInc", "effectiveUnitCostInc", "legacyCostText", "supplier"],
  campaigns: ["budget", "actualSpend", "retainerPerMonth", "successCommissionRate"],
};
const PROFIT_FIELDS: Partial<Record<EntityName, string[]>> = {
  projects: ["estimatedProfit"],
};

export function redact<E extends EntityName>(entity: E, rec: Rec<E>, role: Role): Rec<E> {
  const hide = new Set<string>();
  if (!can(role, "costs.view")) (COST_FIELDS[entity] ?? []).forEach((k) => hide.add(k));
  if (!can(role, "profit.view")) (PROFIT_FIELDS[entity] ?? []).forEach((k) => hide.add(k));
  if (!hide.size) return rec;
  const out: Record<string, unknown> = { ...rec };
  for (const k of hide) delete out[k];
  return out as Rec<E>;
}
