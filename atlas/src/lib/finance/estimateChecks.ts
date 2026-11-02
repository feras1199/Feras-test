import type { CostCategory } from "./pricing";

export interface EstimateLineForCheck {
  description: string;
  category: CostCategory;
  quantity: number;
  unitCostCents: number;
  quantityVerified: boolean;
  aiSuggested: boolean;
  priceUpdatedDate: string | null;
  priceConfidence: "Confirmed" | "Estimate" | "Needs Review" | null;
  /** For labour lines: person-hours per unit used. */
  hoursPerUnit?: number | null;
  productivityValidated?: boolean;
}

export interface EstimateForCheck {
  componentTypes: string[];
  lines: EstimateLineForCheck[];
  measurementsLinked: number;
  hasCustomerScope: boolean;
  exclusionsResolved: boolean;
  today: string;
}

export interface QualityCheck {
  id: string;
  label: string;
  severity: "block" | "warn";
  passed: boolean;
  detail?: string;
}

const DISPOSAL_SENSITIVE = ["Excavation", "Retaining Wall", "Paving", "Driveway (Concrete)", "Driveway (Crusty Dust)", "Drainage (Ag Pipe)", "Drainage"];
const DELIVERY_SENSITIVE = ["Paving", "Retaining Wall", "Turfing", "Driveway (Concrete)", "Pathway (Pebbles)", "Planting"];

function daysBetween(a: string, b: string) {
  return Math.floor((Date.parse(b) - Date.parse(a)) / 86400000);
}

/**
 * Pre-approval checks. "block" checks must pass, or be overridden by an
 * authorised user with a recorded reason, before an estimate can be marked
 * financially reviewed.
 */
export function runEstimateChecks(e: EstimateForCheck): QualityCheck[] {
  const has = (c: CostCategory) => e.lines.some((l) => l.category === c && l.quantity > 0 && l.unitCostCents > 0);
  const needsDisposal = e.componentTypes.some((t) => DISPOSAL_SENSITIVE.includes(t));
  const needsDelivery = e.componentTypes.some((t) => DELIVERY_SENSITIVE.includes(t));

  const stale = e.lines.filter((l) => l.category === "material" && (!l.priceUpdatedDate || daysBetween(l.priceUpdatedDate, e.today) > 365));
  const unverifiedPrice = e.lines.filter((l) => l.priceConfidence === "Needs Review" || l.priceConfidence === "Estimate");
  const unverifiedQty = e.lines.filter((l) => !l.quantityVerified);
  const aiUnverified = e.lines.filter((l) => l.aiSuggested && !l.quantityVerified);
  const zeroLines = e.lines.filter((l) => !(l.quantity > 0) || !(l.unitCostCents > 0));
  const productivity = e.lines.filter((l) => l.category === "labour" && typeof l.hoursPerUnit === "number" && (l.hoursPerUnit <= 0 || l.hoursPerUnit > 20));

  const names = (ls: EstimateLineForCheck[]) => ls.slice(0, 5).map((l) => l.description).join(", ") + (ls.length > 5 ? ` and ${ls.length - 5} more` : "");

  return [
    { id: "lines", label: "Has priced cost lines", severity: "block", passed: e.lines.length > 0 && zeroLines.length === 0, detail: zeroLines.length ? `Missing quantity or unit cost: ${names(zeroLines)}` : undefined },
    { id: "materials", label: "Materials included", severity: "block", passed: has("material") },
    { id: "labour", label: "Labour included", severity: "block", passed: has("labour") || has("subcontractor") },
    { id: "measurements", label: "Linked to site measurements", severity: "warn", passed: e.measurementsLinked > 0 },
    { id: "disposal", label: "Disposal costed", severity: needsDisposal ? "block" : "warn", passed: !needsDisposal || has("disposal") },
    { id: "delivery", label: "Delivery costed", severity: "warn", passed: !needsDelivery || has("delivery") },
    { id: "qty-verified", label: "Quantities verified", severity: "block", passed: unverifiedQty.length === 0, detail: unverifiedQty.length ? names(unverifiedQty) : undefined },
    { id: "ai-verified", label: "AI-suggested quantities reviewed", severity: "block", passed: aiUnverified.length === 0, detail: aiUnverified.length ? names(aiUnverified) : undefined },
    { id: "price-age", label: "Supplier prices under 12 months old", severity: "warn", passed: stale.length === 0, detail: stale.length ? names(stale) : undefined },
    { id: "price-confidence", label: "Supplier prices confirmed", severity: "warn", passed: unverifiedPrice.length === 0, detail: unverifiedPrice.length ? names(unverifiedPrice) : undefined },
    { id: "productivity", label: "Productivity rates within normal range", severity: "warn", passed: productivity.length === 0, detail: productivity.length ? names(productivity) : undefined },
    { id: "scope", label: "Customer scope written", severity: "block", passed: e.hasCustomerScope },
    { id: "exclusions", label: "Exclusions and assumptions resolved", severity: "block", passed: e.exclusionsResolved },
  ];
}

export function blockingFailures(checks: QualityCheck[]) {
  return checks.filter((c) => c.severity === "block" && !c.passed);
}
