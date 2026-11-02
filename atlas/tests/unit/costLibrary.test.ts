import { describe, expect, it } from "vitest";
import { CostItemCreate, parseLegacyCost, searchCostItems, toCostOption, toCostOptions } from "@/lib/domain/costLibrary";
import type { Rec } from "@/lib/data/entities";

const rec = (id: string, f: Partial<Rec<"costItems">>) => ({ id, createdTime: "2026-01-01T00:00:00.000Z", ...f }) as Rec<"costItems">;

describe("toCostOption", () => {
  it("prefers the library's effective price (dollars), then current price (cents), then old text", () => {
    expect(toCostOption(rec("a", { name: "A", effectiveUnitCostInc: 45.5 as never, currentUnitCostInc: 9999 }))!.priceIncCents).toBe(4550);
    expect(toCostOption(rec("b", { name: "B", currentUnitCostInc: 1234 }))!.priceIncCents).toBe(1234);
    expect(toCostOption(rec("c", { name: "C", legacyCostText: "$1,250.00 per tonne" }))!.priceIncCents).toBe(125000);
    expect(toCostOption(rec("d", { name: "D" }))!.priceIncCents).toBeNull();
  });

  it("tidies messy categories and spots labour", () => {
    const o = toCostOption(rec("a", { name: "  Paver  layer ", category: "Labour \n" }))!;
    expect(o).toMatchObject({ name: "Paver layer", category: "Labour", lineType: "Labour" });
    expect(toCostOption(rec("b", { name: "Mulch", category: "Mulch " }))!.lineType).toBe("Material");
  });

  it("drops nameless rows and keeps unticked Active items", () => {
    const out = toCostOptions([rec("a", { name: "" }), rec("b", { name: "Zed", active: false }), rec("c", { name: "Alpha", active: true })]);
    expect(out.map((o) => o.name)).toEqual(["Alpha", "Zed"]);
  });

  it("parses legacy text safely", () => {
    expect(parseLegacyCost("about 80")).toBe(8000);
    expect(parseLegacyCost("call supplier")).toBeNull();
    expect(parseLegacyCost(null)).toBeNull();
  });
});

describe("searchCostItems", () => {
  const items = toCostOptions([
    rec("1", { name: "Sandstone paver 400×400", category: "Paver", supplier: "Demo Stone", currentUnitCostInc: 7900, active: true }),
    rec("2", { name: "Bedding sand", category: "Soil", currentUnitCostInc: 7200 }),
    rec("3", { name: "Blue metal 20 mm", category: "Gravel", supplier: "Demo Yard" }),
    rec("4", { name: "Bluestone paver", category: "Paver" }),
  ]);

  it("finds items from the first letter or two, name-start matches first", () => {
    expect(searchCostItems(items, "s")[0]!.name).toBe("Sandstone paver 400×400");
    expect(searchCostItems(items, "sa").map((i) => i.name)).toEqual(["Sandstone paver 400×400", "Bedding sand"]);
  });

  it("matches category and supplier, and needs every word", () => {
    expect(searchCostItems(items, "gravel").map((i) => i.id)).toEqual(["3"]);
    expect(searchCostItems(items, "demo yard").map((i) => i.id)).toEqual(["3"]);
    expect(searchCostItems(items, "blue paver").map((i) => i.id)).toEqual(["4"]);
  });

  it("is case and punctuation insensitive, and empty text returns nothing", () => {
    expect(searchCostItems(items, "BLUE-METAL").map((i) => i.id)).toEqual(["3"]);
    expect(searchCostItems(items, "   ")).toEqual([]);
  });

  it("respects the limit", () => {
    expect(searchCostItems(items, "p", 1)).toHaveLength(1);
  });
});

describe("CostItemCreate", () => {
  it("needs a name and whole-cent price", () => {
    expect(CostItemCreate.safeParse({ name: "X", priceIncCents: 100 }).success).toBe(false);
    expect(CostItemCreate.safeParse({ name: "Gravel", priceIncCents: 10.5 }).success).toBe(false);
    expect(CostItemCreate.parse({ name: " Gravel ", priceIncCents: 100 })).toMatchObject({ name: "Gravel", unit: "", category: "" });
  });
});

describe("short queries", () => {
  it("two letters only match word starts, not the middle of words", () => {
    const items = toCostOptions([rec("1", { name: "Skip bin", category: "Disposal" }), rec("2", { name: "Bedding sand" })]);
    expect(searchCostItems(items, "sa").map((i) => i.id)).toEqual(["2"]);
    expect(searchCostItems(items, "posa").map((i) => i.id)).toEqual(["1"]);
  });
});
