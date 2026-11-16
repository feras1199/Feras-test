import { type Cents, mulRate } from "./money";

export interface LabourEstimateInput {
  quantity: number;
  /** Person-hours per unit of work from the Productivity Library. */
  hoursPerUnit: number;
  crewSize: number;
  /** Cost per person-hour, ex GST, in cents. */
  ratePerPersonHour: Cents;
  /** Multipliers, 1 = standard. */
  difficultyFactor?: number;
  accessFactor?: number;
  minimumPersonHours?: number;
  supervisionPersonHours?: number;
  /** Productive hours per crew day, used to estimate duration. */
  hoursPerDay?: number;
}

export interface LabourEstimate {
  productivePersonHours: number;
  supervisionPersonHours: number;
  totalPersonHours: number;
  /** Elapsed hours on site for the crew (person-hours / crew size). */
  crewHours: number;
  days: number;
  cost: Cents;
  appliedMinimum: boolean;
  explanation: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Person-hours are the unit of labour cost. Crew-hours are elapsed time.
 * Three people working six hours = 18 person-hours = 6 crew-hours.
 */
export function estimateLabour(i: LabourEstimateInput): LabourEstimate {
  if (i.crewSize <= 0) throw new RangeError("Crew size must be at least 1");
  if (i.quantity < 0 || i.hoursPerUnit < 0) throw new RangeError("Quantity and productivity must be positive");
  const difficulty = i.difficultyFactor ?? 1;
  const access = i.accessFactor ?? 1;
  const raw = i.quantity * i.hoursPerUnit * difficulty * access;
  const minimum = i.minimumPersonHours ?? 0;
  const appliedMinimum = raw < minimum;
  const productive = round2(Math.max(raw, minimum));
  const supervision = round2(i.supervisionPersonHours ?? 0);
  const total = round2(productive + supervision);
  const crewHours = round2(productive / i.crewSize);
  const hoursPerDay = i.hoursPerDay ?? 8;
  const days = Math.round((crewHours / hoursPerDay) * 10) / 10;
  const cost = mulRate(i.ratePerPersonHour, total);
  const explanation =
    `${i.quantity} × ${i.hoursPerUnit} h/unit` +
    (difficulty !== 1 ? ` × ${difficulty} difficulty` : "") +
    (access !== 1 ? ` × ${access} access` : "") +
    ` = ${round2(raw)} person-h` +
    (appliedMinimum ? ` (minimum ${minimum} h applied)` : "") +
    (supervision ? ` + ${supervision} supervision` : "") +
    `; crew of ${i.crewSize} ≈ ${crewHours} h on site (${days} days)`;
  return { productivePersonHours: productive, supervisionPersonHours: supervision, totalPersonHours: total, crewHours, days, cost, appliedMinimum, explanation };
}

export type RateBasis = "per_person" | "crew_total";

export interface TimesheetInput {
  start: string; // ISO datetime
  finish: string; // ISO datetime
  breakMinutes?: number;
  crewSize?: number;
  rate: Cents;
  rateBasis: RateBasis;
}

/** Mirrors the Airtable Timesheets formulas exactly so both agree. */
export function timesheetTotals(t: TimesheetInput) {
  const minutes = (Date.parse(t.finish) - Date.parse(t.start)) / 60000;
  if (!Number.isFinite(minutes)) throw new RangeError("Invalid start or finish time");
  const labourHours = Math.max(0, (minutes - (t.breakMinutes ?? 0)) / 60);
  const crew = t.crewSize && t.crewSize > 0 ? t.crewSize : 1;
  const personHours = labourHours * crew;
  const cost = t.rateBasis === "per_person" ? mulRate(t.rate, personHours) : mulRate(t.rate, labourHours);
  return { labourHours: round2(labourHours), personHours: round2(personHours), cost };
}
