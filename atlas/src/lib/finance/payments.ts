import type { Cents } from "./money";

export interface ScheduleStage {
  label: string;
  /** Fraction of the contract price, e.g. 0.5 for 50%. */
  rate: number;
}

export interface ScheduledPayment {
  index: number;
  label: string;
  rate: number;
  amount: Cents;
}

export const SCHEDULE_PRESETS: Record<string, { name: string; stages: ScheduleStage[] }> = {
  legacy4: {
    name: "Historical 4-stage (50/25/15/10)",
    stages: [
      { label: "Deposit", rate: 0.5 },
      { label: "Progress 1", rate: 0.25 },
      { label: "Progress 2", rate: 0.15 },
      { label: "Final", rate: 0.1 },
    ],
  },
  fiveStage: {
    name: "5-stage (10/30/30/20/10)",
    stages: [
      { label: "Deposit", rate: 0.1 },
      { label: "Progress 1", rate: 0.3 },
      { label: "Progress 2", rate: 0.3 },
      { label: "Progress 3", rate: 0.2 },
      { label: "Final", rate: 0.1 },
    ],
  },
};

/** Basis points avoid float drift when checking that rates sum to 100%. */
function toBasisPoints(rate: number): number {
  return Math.round(Number((rate * 10000).toPrecision(12)));
}

export function validateSchedule(stages: ScheduleStage[]): string[] {
  const errors: string[] = [];
  if (stages.length === 0) errors.push("Schedule has no stages");
  for (const s of stages) {
    if (!s.label.trim()) errors.push("Every stage needs a label");
    if (!(s.rate > 0)) errors.push(`Stage "${s.label}" must be more than 0%`);
  }
  const total = stages.reduce((acc, s) => acc + toBasisPoints(s.rate), 0);
  if (total !== 10000) errors.push(`Stages total ${(total / 100).toFixed(2)}%, not 100%`);
  return errors;
}

/**
 * Split a contract price into stage amounts. Each stage is rounded to the
 * cent; the final stage absorbs the rounding remainder so the schedule always
 * sums exactly to the contract price.
 */
export function splitSchedule(contractCents: Cents, stages: ScheduleStage[]): ScheduledPayment[] {
  const errors = validateSchedule(stages);
  if (errors.length) throw new Error(errors.join("; "));
  if (!Number.isInteger(contractCents) || contractCents < 0) throw new RangeError("Contract price must be whole cents");

  const out: ScheduledPayment[] = [];
  let allocated = 0;
  stages.forEach((s, i) => {
    const isLast = i === stages.length - 1;
    const amount = isLast ? contractCents - allocated : Math.round((contractCents * toBasisPoints(s.rate)) / 10000);
    allocated += amount;
    out.push({ index: i, label: s.label, rate: s.rate, amount });
  });
  return out;
}

export interface DepositRule {
  /** Maximum deposit as a fraction of the contract price. NSW HBA: 0.10 for residential building work. */
  maxDepositRate: number;
}

/** Returns a warning when the first stage (the deposit) exceeds the configured cap. */
export function depositWarning(stages: ScheduleStage[], rule: DepositRule): string | null {
  const first = stages[0];
  if (!first) return null;
  if (toBasisPoints(first.rate) > toBasisPoints(rule.maxDepositRate)) {
    return `Deposit of ${(first.rate * 100).toFixed(0)}% exceeds the configured cap of ${(rule.maxDepositRate * 100).toFixed(0)}%. In NSW, deposits for residential building work are generally capped at 10%. Confirm before issuing.`;
  }
  return null;
}

export type PaymentState = "scheduled" | "due" | "overdue" | "part_paid" | "paid";

export function paymentState(p: { amount: Cents; received: Cents; dueDate?: string | null }, today: string): PaymentState {
  if (p.received >= p.amount && p.amount > 0) return "paid";
  if (p.received > 0) return "part_paid";
  if (!p.dueDate) return "scheduled";
  if (p.dueDate < today) return "overdue";
  return "due";
}
