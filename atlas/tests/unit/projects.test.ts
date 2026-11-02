import { describe, expect, it } from "vitest";
import { buildFixtures } from "@/lib/data/memory/fixtures";
import { actualCostExGst, projectFinancials, TimesheetCreate } from "@/lib/domain/projects";

const f = buildFixtures(new Date("2026-11-02T00:00:00Z"));
const project = f.projects!.find((p) => p.name === "Taylor Demo – Front Yard")!;
const of = <T extends { projectIds?: string[] }>(rows: T[] | undefined) => (rows ?? []).filter((r) => r.projectIds?.includes(project.id));

describe("project financials", () => {
  const pf = projectFinancials(project, of(f.components), of(f.actualCosts), of(f.timesheets), of(f.variations), of(f.payments), "2026-11-02");
  it("reconciles a completed component from costs and submitted timesheets", () => {
    const planting = pf.components.find((c) => c.name === "Planting")!;
    // Plants $2,750 inc GST = $2,500 ex; 2 days × 8 h (7:00–15:30 less 30 min) × 2 people × $45 = $1,440
    expect(planting.reconciledCost).toBe(250_000 + 144_000);
    expect(planting.actualProfit).toBe(650_000 - 394_000);
  });
  it("keeps unsubmitted timesheets out of actuals and reports unallocated costs", () => {
    expect(pf.unsubmittedTimesheets).toBe(1);
    expect(pf.unallocatedCost).toBe(45_000); // skip bin $495 inc GST
  });
  it("only counts approved variations in the contract", () => {
    expect(pf.contract.current).toBe(3_850_000);
    expect(pf.contract.pendingVariations).toBe(85_800);
  });
  it("tracks payments received and overdue", () => {
    expect(pf.payments.received).toBe(385_000);
    expect(pf.payments.overdue).toBe(1_155_000);
    expect(pf.payments.scheduled).toBe(3_850_000);
  });
  it("does not strip GST from labour costs", () => {
    expect(actualCostExGst({ unitCostInc: 11000, quantity: 1, costType: "Labour" })).toBe(11000);
    expect(actualCostExGst({ unitCostInc: 11000, quantity: 1, costType: "Material" })).toBe(10000);
  });
});

describe("timesheet entry", () => {
  it("rejects finish before start and rework without a reason", () => {
    const base = { projectId: "recDemoProj000001", workDate: "2026-11-02", startTime: "07:00", finishTime: "15:30" };
    expect(TimesheetCreate.safeParse(base).success).toBe(true);
    expect(TimesheetCreate.safeParse({ ...base, finishTime: "06:00" }).success).toBe(false);
    expect(TimesheetCreate.safeParse({ ...base, workType: "Rework" }).success).toBe(false);
  });
});

import { zonedToUtc } from "@/lib/dates";
describe("zonedToUtc", () => {
  it("handles Sydney daylight saving", () => {
    expect(zonedToUtc("2026-11-02", "07:00")).toBe("2026-11-01T20:00:00.000Z"); // AEDT +11
    expect(zonedToUtc("2026-06-15", "07:00")).toBe("2026-06-14T21:00:00.000Z"); // AEST +10
  });
});
