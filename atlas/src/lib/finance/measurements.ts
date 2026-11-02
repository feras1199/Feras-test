import { type Cents, mulRate } from "./money";
import { exGst, DEFAULT_GST_RATE } from "./pricing";

export type MeasureUnit = "m2" | "lm" | "m3" | "each" | "hours" | "allowance" | "other";

export interface MeasurementInput {
  unit: MeasureUnit;
  lengthM?: number | null;
  widthM?: number | null;
  heightOrDepthM?: number | null;
  /** A manually measured/verified quantity always wins over the calculated one. */
  measuredQuantity?: number | null;
  /** Area or volume to subtract (garden beds left in, existing slab, etc.). */
  exclusions?: number | null;
}

const pos = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

export function calculatedQuantity(m: MeasurementInput): number | null {
  switch (m.unit) {
    case "m2":
      // Paving area = L × W. Wall face area = L × H (use heightOrDepthM as width).
      if (pos(m.lengthM) && pos(m.widthM)) return m.lengthM * m.widthM;
      if (pos(m.lengthM) && pos(m.heightOrDepthM)) return m.lengthM * m.heightOrDepthM;
      return null;
    case "m3":
      return pos(m.lengthM) && pos(m.widthM) && pos(m.heightOrDepthM) ? m.lengthM * m.widthM * m.heightOrDepthM : null;
    case "lm":
      return pos(m.lengthM) ? m.lengthM : null;
    default:
      return null;
  }
}

/** Same precedence as the Airtable "Preferred Quantity" formula, plus exclusions. */
export function preferredQuantity(m: MeasurementInput): number | null {
  const base = typeof m.measuredQuantity === "number" && Number.isFinite(m.measuredQuantity) ? m.measuredQuantity : calculatedQuantity(m);
  if (base === null) return null;
  return round3(Math.max(0, base - (m.exclusions ?? 0)));
}

export function orderQuantity(netQuantity: number, wasteRate: number): number {
  if (wasteRate < 0) throw new RangeError("Waste cannot be negative");
  return round3(netQuantity * (1 + wasteRate));
}

export interface MaterialLineInput {
  quantity: number;
  wasteRate: number;
  unitCost: Cents;
  /** True when the unit cost was recorded including GST (the Cost Library default). */
  unitCostIncludesGst: boolean;
  gstRate?: number;
}

/** Ex-GST material cost for an estimate line. */
export function materialLineCost(l: MaterialLineInput): { orderQty: number; unitCostExGst: Cents; cost: Cents } {
  const orderQty = orderQuantity(l.quantity, l.wasteRate);
  const unitCostExGst = l.unitCostIncludesGst ? exGst(l.unitCost, l.gstRate ?? DEFAULT_GST_RATE) : l.unitCost;
  return { orderQty, unitCostExGst, cost: mulRate(unitCostExGst, orderQty) };
}
