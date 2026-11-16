import { describe, expect, it } from "vitest";
import { lineCostExGst, lineFields, scheduleFromEstimate, scheduleToFields, summarise, LineInput } from "@/lib/domain/estimates";
import { DEFAULT_SETTINGS } from "@/lib/config/settings";
import { SCHEDULE_PRESETS } from "@/lib/finance/payments";

const mkLine = (i: Partial<LineInput> & { id?: string }, gst = 0.1) => ({ id: i.id ?? "rec" + Math.random().toString(36).slice(2, 16).padEnd(14, "x"), createdTime: "", ...lineFields(LineInput.parse({ description: "Item", costType: "Material", quantity: 1, unitCostCents: 0, ...i }), gst) });

describe("estimate lines", () => {
  it("matches the Airtable Line Cost formula for GST-inclusive supplier prices", () => {
    // 50 m2 pavers at $44 inc GST with 8% waste = 54 m2 × $40 ex GST = $2,160
    const l = mkLine({ quantity: 50, wasteRate: 0.08, unitCostCents: 4400, priceIncludesGst: true });
    expect(lineCostExGst(l)).toBe(216000);
  });
  it("treats labour as GST-free person-hours with no waste", () => {
    const l = mkLine({ costType: "Labour", quantity: 18, wasteRate: 0.1, unitCostCents: 4500, priceIncludesGst: true });
    expect(l.inputGstRate).toBe(0);
    expect(l.wasteRate).toBe(0);
    expect(lineCostExGst(l)).toBe(81000);
  });
});

describe("schedule fields", () => {
  it("round-trips both presets through the five Airtable rate fields", () => {
    for (const p of Object.values(SCHEDULE_PRESETS)) {
      const back = scheduleFromEstimate(scheduleToFields(p.stages));
      expect(back.map((s) => s.rate)).toEqual(p.stages.map((s) => s.rate));
    }
  });
});

describe("summarise", () => {
  const today = "2026-11-02";
  const lines = [
    mkLine({ description: "Pavers", quantity: 1, unitCostCents: 600000, quantityVerified: true }),
    mkLine({ description: "Labour", costType: "Labour", quantity: 80, unitCostCents: 5000, quantityVerified: true }),
    mkLine({ description: "Skip", costType: "Disposal", quantity: 1, unitCostCents: 0 + 0, quantityVerified: true }),
    mkLine({ description: "Upgrade lighting", quantity: 1, unitCostCents: 100000, proposalOption: "Optional Upgrade" }),
  ];
  const est = { ...scheduleToFields(SCHEDULE_PRESETS.fiveStage!.stages), customerScope: "Supply and lay pavers", assumptionsResolved: true };

  it("prices $10,000 of cost at 30% markup to $14,300 inc GST, excluding optional extras", () => {
    const s = summarise(est, lines, DEFAULT_SETTINGS, { componentTypes: ["Paving"], measurementsLinked: 1, today });
    expect(s.pricing.costBase).toBe(1_000_000);
    expect(s.pricing.sellIncGst).toBe(1_430_000);
    expect(s.schedule!.reduce((a, p) => a + p.amount, 0)).toBe(1_430_000);
    expect(s.optionalExtras).toEqual([expect.objectContaining({ description: "Upgrade lighting", priceExGst: 130000 })]);
    expect(s.personHours).toBe(80);
  });
  it("blocks approval when disposal is missing for paving and when the deposit is over the cap", () => {
    const legacy = { ...est, ...scheduleToFields(SCHEDULE_PRESETS.legacy4!.stages) };
    const s = summarise(legacy, lines, DEFAULT_SETTINGS, { componentTypes: ["Paving"], measurementsLinked: 1, today });
    expect(s.blocking.map((c) => c.id)).toContain("disposal");
    expect(s.warnings.some((w) => w.includes("Deposit of 50%"))).toBe(true);
  });
  it("blocks an override outside the margin band", () => {
    const s = summarise({ ...est, managerOverride: 1_050_000 }, lines, DEFAULT_SETTINGS, { componentTypes: [], measurementsLinked: 1, today });
    expect(s.blocking.map((c) => c.id)).toContain("override");
  });
});
