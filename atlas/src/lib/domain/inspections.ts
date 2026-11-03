import { z } from "zod";
import type { Rec } from "../data/entities";
import { preferredQuantity, type MeasureUnit } from "../finance/measurements";

export const UNITS = ["m²", "lm", "m³", "each", "hours", "allowance", "other"] as const;
export const WORK_TYPES = ["Paving", "Retaining Wall", "Excavation", "Turfing", "Planting", "Drainage", "Concrete Driveway", "Pergola / Fencing", "Lighting", "Other"] as const;
export const METHODS = ["Manual onsite", "Google Earth", "Plan / Drawing", "AI-assisted", "Other"] as const;
export const CONFIDENCE = ["Confirmed onsite", "High", "Medium", "Low / Verify"] as const;

const UNIT_MAP: Record<string, MeasureUnit> = { "m²": "m2", lm: "lm", "m³": "m3", each: "each", hours: "hours", allowance: "allowance", other: "other" };

export function measurementQuantity(m: Pick<Rec<"measurements">, "unit" | "lengthM" | "widthM" | "heightM" | "measuredQuantity">): number | null {
  return preferredQuantity({ unit: UNIT_MAP[m.unit ?? "other"] ?? "other", lengthM: m.lengthM, widthM: m.widthM, heightOrDepthM: m.heightM, measuredQuantity: m.measuredQuantity });
}

export function quantityBasisFor(unit: string | null | undefined) {
  return unit === "m²" ? "Measured area" : unit === "lm" ? "Measured length" : unit === "m³" ? "Measured volume" : unit === "each" ? "Count / each" : "Manual quantity";
}

const txt = (max = 5000) => z.string().trim().max(max).optional();
const recId = z.string().regex(/^rec[A-Za-z0-9]{14}$/);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const m = z.number().nonnegative().max(10_000).nullable().optional();

/** "HH:MM" 24-hour, e.g. "09:30". */
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Pick a time");
export const InspectionCreate = z.object({ customerId: recId, enquiryId: recId.optional(), inspectionDate: date, inspectionTime: time.optional() });

/** "9:30 am" from "09:30". */
export function formatTime(t: string | null | undefined): string {
  if (!t || !/^\d{2}:\d{2}$/.test(t)) return "";
  const [h, m] = t.split(":").map(Number) as [number, number];
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}
export const InspectionUpdate = z.object({
  inspectionDate: date.optional(),
  inspectionTime: time.nullable().optional(),
  siteAddress: txt(300),
  scope: txt(),
  accessDifficulty: z.enum(["Easy", "Moderate", "Difficult", "Unknown"]).optional(),
  accessWidthM: m,
  existingConditions: txt(),
  slopeLevels: txt(),
  drainage: txt(),
  services: txt(),
  risks: txt(),
  priorities: txt(),
  stylePreferences: txt(),
  notes: txt(),
  budgetFit: z.enum(["Likely Fits", "May Need Scope Change", "Budget Mismatch", "Unknown", "Good Fit"]).optional(),
  complete: z.boolean().optional(),
  followUpRequired: z.boolean().optional(),
});

export const MeasurementInput = z
  .object({
    zone: z.string().trim().min(1, "Name the area").max(120),
    workType: z.enum(WORK_TYPES),
    unit: z.enum(UNITS),
    method: z.enum(METHODS).default("Manual onsite"),
    lengthM: m,
    widthM: m,
    heightM: m,
    measuredQuantity: m,
    confidence: z.enum(CONFIDENCE).default("Confirmed onsite"),
    customerRequest: txt(1000),
    estimatorNotes: txt(1000),
    verified: z.boolean().default(false),
  })
  .refine((v) => measurementQuantity(v) !== null, { message: "Enter dimensions or a measured quantity", path: ["lengthM"] });
