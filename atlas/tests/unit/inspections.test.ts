import { describe, expect, it } from "vitest";
import { MeasurementInput, measurementQuantity } from "@/lib/domain/inspections";

describe("measurements", () => {
  it("calculates area, length and volume", () => {
    expect(measurementQuantity({ unit: "m²", lengthM: 10, widthM: 5, heightM: null, measuredQuantity: null })).toBe(50);
    expect(measurementQuantity({ unit: "m³", lengthM: 10, widthM: 5, heightM: 0.2, measuredQuantity: null })).toBe(10);
    expect(measurementQuantity({ unit: "lm", lengthM: 12.5, widthM: null, heightM: null, measuredQuantity: null })).toBe(12.5);
  });
  it("prefers a measured quantity", () => {
    expect(measurementQuantity({ unit: "m²", lengthM: 10, widthM: 5, heightM: null, measuredQuantity: 47.5 })).toBe(47.5);
  });
  it("requires something to measure", () => {
    expect(MeasurementInput.safeParse({ zone: "Rear", workType: "Paving", unit: "m²" }).success).toBe(false);
    expect(MeasurementInput.safeParse({ zone: "Rear", workType: "Paving", unit: "m²", lengthM: 4, widthM: 3 }).success).toBe(true);
  });
});
