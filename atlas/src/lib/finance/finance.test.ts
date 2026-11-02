import { describe, expect, it } from "vitest";
import { toCents, toDollars, mulRate } from "./money";
import { priceJob, markupToMargin, marginToMarkup, exGst, incGst, checkOverride } from "./pricing";
import { splitSchedule, SCHEDULE_PRESETS, validateSchedule, depositWarning, paymentState } from "./payments";
import { estimateLabour, timesheetTotals } from "./labour";
import { preferredQuantity, orderQuantity, materialLineCost } from "./measurements";
import { componentFinancials, projectRollup, findLikelyDuplicateCosts, contractWithVariations } from "./reconciliation";
import { runEstimateChecks, blockingFailures } from "./estimateChecks";

describe("money", () => {
  it("converts without float noise", () => {
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents(28399.03459372486)).toBe(2839903);
    expect(toDollars(1234567)).toBe(12345.67);
    expect(mulRate(1000, 0.333)).toBe(333);
  });
});

describe("markup versus margin", () => {
  it("30% markup is a 23.08% margin, not 30%", () => {
    expect(markupToMargin(0.3)).toBeCloseTo(0.230769, 5);
    expect(marginToMarkup(0.3)).toBeCloseTo(0.428571, 5);
  });

  it("brief example: $10,000 cost, 30% markup, 10% GST", () => {
    const r = priceJob({ costs: { byCategory: { material: toCents(10000) } }, markupRate: 0.3 });
    expect(r.sellExGst).toBe(toCents(13000));
    expect(r.gst).toBe(toCents(1300));
    expect(r.sellIncGst).toBe(toCents(14300));
    expect(r.grossProfit).toBe(toCents(3000));
    expect(r.achievedMarkup).toBeCloseTo(0.3, 10);
    expect(r.grossMargin).toBeCloseTo(0.2308, 4);
  });
});

describe("GST", () => {
  it("inclusive and exclusive conversions round-trip", () => {
    expect(exGst(toCents(110))).toBe(toCents(100));
    expect(incGst(toCents(100))).toBe(toCents(110));
    expect(exGst(toCents(44))).toBe(toCents(40));
  });

  it("does not mark up GST paid to suppliers", () => {
    // $1,100 inc GST supplier invoice is $1,000 of cost, not $1,100.
    const cost = exGst(toCents(1100));
    const r = priceJob({ costs: { byCategory: { material: cost } }, markupRate: 0.3 });
    expect(r.sellExGst).toBe(toCents(1300));
    expect(r.sellIncGst).toBe(toCents(1430));
  });
});

describe("overhead, contingency and commission", () => {
  it("applies contingency to direct cost plus overhead, without double counting", () => {
    const r = priceJob({
      costs: { byCategory: { material: toCents(6000), labour: toCents(4000) }, overheadFixed: toCents(500), contingencyRate: 0.05 },
      markupRate: 0.3,
    });
    expect(r.directCost).toBe(toCents(10000));
    expect(r.overhead).toBe(toCents(500));
    expect(r.contingency).toBe(toCents(525));
    expect(r.costBase).toBe(toCents(11025));
    expect(r.sellExGst).toBe(toCents(14332.5));
  });

  it("6% commission on invoice inc GST, absorbed", () => {
    const r = priceJob({
      costs: { byCategory: { material: toCents(10000) } },
      markupRate: 0.3,
      commission: { rate: 0.06, base: "invoice_inc_gst", treatment: "absorb" },
    });
    expect(r.sellIncGst).toBe(toCents(14300));
    expect(r.commissionBase).toBe(toCents(14300));
    expect(r.commission).toBe(toCents(858));
    expect(r.grossProfit).toBe(toCents(3000));
    expect(r.operatingProfit).toBe(toCents(2142));
  });

  it("6% commission passed through keeps the target profit", () => {
    const r = priceJob({
      costs: { byCategory: { material: toCents(10000) } },
      markupRate: 0.3,
      commission: { rate: 0.06, base: "invoice_inc_gst", treatment: "pass_through" },
    });
    expect(Math.abs(r.operatingProfit - toCents(3000))).toBeLessThanOrEqual(2);
    expect(r.sellExGst).toBeGreaterThan(toCents(13000));
  });

  it("flags an override that is far above cost", () => {
    const r = priceJob({ costs: { byCategory: { material: toCents(70) } }, markupRate: 0.3, managerOverrideExGst: toCents(21800) });
    expect(r.overridden).toBe(true);
    expect(checkOverride(r, { minMargin: 0.1, maxMargin: 0.6 })).toMatch(/above/);
  });
});

describe("payment schedules", () => {
  it("brief example: $47,200 on 50/25/15/10", () => {
    const s = splitSchedule(toCents(47200), SCHEDULE_PRESETS.legacy4!.stages);
    expect(s.map((p) => toDollars(p.amount))).toEqual([23600, 11800, 7080, 4720]);
  });

  it("always sums to the contract price, even with awkward cents", () => {
    for (const total of [1, 99, 100001, 2839903, 8649724, 33333333]) {
      for (const preset of Object.values(SCHEDULE_PRESETS)) {
        const s = splitSchedule(total, preset.stages);
        expect(s.reduce((a, p) => a + p.amount, 0)).toBe(total);
      }
    }
  });

  it("supports the five-stage schedule", () => {
    const s = splitSchedule(toCents(10000), SCHEDULE_PRESETS.fiveStage!.stages);
    expect(s.map((p) => toDollars(p.amount))).toEqual([1000, 3000, 3000, 2000, 1000]);
  });

  it("rejects schedules that do not total 100%", () => {
    expect(validateSchedule([{ label: "A", rate: 0.5 }, { label: "B", rate: 0.4 }])).toHaveLength(1);
    expect(() => splitSchedule(100, [{ label: "A", rate: 0.6 }])).toThrow();
  });

  it("warns when the deposit exceeds the cap", () => {
    expect(depositWarning(SCHEDULE_PRESETS.legacy4!.stages, { maxDepositRate: 0.1 })).toMatch(/exceeds/);
    expect(depositWarning(SCHEDULE_PRESETS.fiveStage!.stages, { maxDepositRate: 0.1 })).toBeNull();
  });

  it("derives payment state", () => {
    expect(paymentState({ amount: 100, received: 100, dueDate: "2026-01-01" }, "2026-11-02")).toBe("paid");
    expect(paymentState({ amount: 100, received: 0, dueDate: "2026-11-01" }, "2026-11-02")).toBe("overdue");
    expect(paymentState({ amount: 100, received: 40, dueDate: "2026-11-01" }, "2026-11-02")).toBe("part_paid");
    expect(paymentState({ amount: 100, received: 0, dueDate: null }, "2026-11-02")).toBe("scheduled");
  });
});

describe("labour", () => {
  it("distinguishes person-hours from crew-hours", () => {
    const l = estimateLabour({ quantity: 6, hoursPerUnit: 3, crewSize: 3, ratePerPersonHour: toCents(55) });
    expect(l.totalPersonHours).toBe(18);
    expect(l.crewHours).toBe(6);
    expect(l.cost).toBe(toCents(990));
  });

  it("applies difficulty, access, minimum and supervision", () => {
    const l = estimateLabour({ quantity: 1, hoursPerUnit: 0.5, crewSize: 2, ratePerPersonHour: toCents(60), difficultyFactor: 1.2, accessFactor: 1.25, minimumPersonHours: 4, supervisionPersonHours: 1 });
    expect(l.appliedMinimum).toBe(true);
    expect(l.totalPersonHours).toBe(5);
    expect(l.cost).toBe(toCents(300));
  });

  it("matches the Airtable timesheet formulas", () => {
    const perPerson = timesheetTotals({ start: "2026-10-15T07:00:00+11:00", finish: "2026-10-15T15:30:00+11:00", breakMinutes: 30, crewSize: 3, rate: toCents(50), rateBasis: "per_person" });
    expect(perPerson.labourHours).toBe(8);
    expect(perPerson.personHours).toBe(24);
    expect(perPerson.cost).toBe(toCents(1200));
    const crew = timesheetTotals({ start: "2026-10-15T07:00:00+11:00", finish: "2026-10-15T15:30:00+11:00", breakMinutes: 30, crewSize: 3, rate: toCents(150), rateBasis: "crew_total" });
    expect(crew.cost).toBe(toCents(1200));
  });
});

describe("measurements and materials", () => {
  it("calculates area, volume, wall face and linear metres", () => {
    expect(preferredQuantity({ unit: "m2", lengthM: 10, widthM: 5 })).toBe(50);
    expect(preferredQuantity({ unit: "m3", lengthM: 10, widthM: 5, heightOrDepthM: 0.2 })).toBe(10);
    expect(preferredQuantity({ unit: "m2", lengthM: 12, heightOrDepthM: 0.8 })).toBe(9.6);
    expect(preferredQuantity({ unit: "lm", lengthM: 18.5 })).toBe(18.5);
  });

  it("prefers a verified measured quantity and subtracts exclusions", () => {
    expect(preferredQuantity({ unit: "m2", lengthM: 10, widthM: 5, measuredQuantity: 47 })).toBe(47);
    expect(preferredQuantity({ unit: "m2", lengthM: 10, widthM: 5, exclusions: 4 })).toBe(46);
  });

  it("brief example: 50 m² paving, 8% waste, $40/m² = $2,160", () => {
    expect(orderQuantity(50, 0.08)).toBe(54);
    const line = materialLineCost({ quantity: 50, wasteRate: 0.08, unitCost: toCents(40), unitCostIncludesGst: false });
    expect(line.cost).toBe(toCents(2160));
  });

  it("strips GST from GST-inclusive library prices", () => {
    const line = materialLineCost({ quantity: 10, wasteRate: 0, unitCost: toCents(44), unitCostIncludesGst: true });
    expect(line.unitCostExGst).toBe(toCents(40));
    expect(line.cost).toBe(toCents(400));
  });
});

describe("reconciliation", () => {
  const base = {
    status: "Completed",
    estimatedPersonHours: 20,
    unitemisedCostAdjustment: 0,
    unitemisedHoursAdjustment: 0,
    actualDays: 2,
  };

  it("computes component and project profit once, without double counting", () => {
    const paving = componentFinancials({ ...base, id: "a", name: "Paving", quotedRevenue: toCents(20000), finalRevenue: toCents(20000), estimatedCost: toCents(14000), actualCostLines: [toCents(8000), toCents(1500)], submittedLabourCost: toCents(4000), submittedPersonHours: 60 });
    const turf = componentFinancials({ ...base, id: "b", name: "Turf", quotedRevenue: toCents(5000), finalRevenue: toCents(5500), estimatedCost: toCents(3500), actualCostLines: [toCents(2000)], submittedLabourCost: toCents(1000), submittedPersonHours: 16 });
    expect(paving.reconciledCost).toBe(toCents(13500));
    expect(paving.actualProfit).toBe(toCents(6500));
    expect(paving.profitPerDay).toBe(toCents(3250));
    expect(turf.actualProfit).toBe(toCents(2500));
    const p = projectRollup([paving, turf], toCents(25500));
    expect(p.revenue).toBe(toCents(25500));
    expect(p.reconciledCost).toBe(toCents(16500));
    expect(p.profit).toBe(toCents(9000));
    expect(p.status).toBe("ok");
    expect(projectRollup([paving, turf], toCents(26000)).status).toBe("mismatch");
  });

  it("does not report actual profit before completion", () => {
    const c = componentFinancials({ ...base, status: "Active", id: "c", name: "Wall", quotedRevenue: 100, finalRevenue: null, estimatedCost: 50, actualCostLines: [10], submittedLabourCost: 0, submittedPersonHours: 0 });
    expect(c.actualProfit).toBeNull();
  });

  it("finds likely duplicate cost entries", () => {
    const groups = findLikelyDuplicateCosts([
      { id: "1", projectId: "p", componentId: "c", supplier: "Bunnings", amount: 5000, date: "2026-10-01", reference: "" },
      { id: "2", projectId: "p", componentId: "c", supplier: "bunnings ", amount: 5000, date: "2026-10-01", reference: "" },
      { id: "3", projectId: "p", componentId: "c", supplier: "Bunnings", amount: 5000, date: "2026-10-02", reference: "" },
      { id: "4", projectId: "p", componentId: "c", supplier: "X", amount: 900, date: "2026-10-02", reference: "INV-9" },
      { id: "5", projectId: "p", componentId: "d", supplier: "X", amount: 900, date: "2026-10-03", reference: "inv-9" },
    ]);
    expect(groups).toEqual([["1", "2"], ["4", "5"]]);
  });

  it("only approved variations change the contract value", () => {
    const r = contractWithVariations(toCents(40000), [
      { status: "Approved", customerPrice: toCents(1500), estimatedCost: toCents(1000) },
      { status: "Pending", customerPrice: toCents(3000), estimatedCost: toCents(2000) },
      { status: "Rejected", customerPrice: toCents(800), estimatedCost: toCents(500) },
    ]);
    expect(r.current).toBe(toCents(41500));
    expect(r.pendingVariations).toBe(toCents(3000));
  });
});

describe("estimate quality checks", () => {
  it("blocks approval when disposal, labour or verification is missing", () => {
    const checks = runEstimateChecks({
      componentTypes: ["Excavation"],
      lines: [{ description: "Road base", category: "material", quantity: 5, unitCostCents: 6000, quantityVerified: false, aiSuggested: true, priceUpdatedDate: "2024-01-01", priceConfidence: "Needs Review" }],
      measurementsLinked: 0,
      hasCustomerScope: true,
      exclusionsResolved: true,
      today: "2026-11-02",
    });
    const ids = blockingFailures(checks).map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(["labour", "disposal", "qty-verified", "ai-verified"]));
    expect(checks.find((c) => c.id === "price-age")?.passed).toBe(false);
  });
});
