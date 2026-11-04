import { describe, expect, it } from "vitest";
import { parseImport } from "@/lib/data/importer";
import { tableId, fieldMeta } from "@/lib/data/mapper";

const fid = (key: string) => fieldMeta("costItems", key).id;

describe("parseImport (Airtable file)", () => {
  it("decodes connector-style records keyed by field id, and by table id", () => {
    const file = {
      format: "airtable",
      tables: {
        [tableId("costItems")]: [
          { id: "recDemoCostImp001", createdTime: "2026-01-02T00:00:00.000Z", cellValuesByFieldId: { [fid("name")]: "Demo gravel", [fid("unit")]: "Tonne", [fid("currentUnitCostInc")]: 65.5, [fid("active")]: true, [fid("confidence")]: { id: "selX", name: "Estimate" } } },
        ],
        tblNotUsedByAtlas1: [],
      },
    };
    const p = parseImport(file);
    expect(p.ignored).toEqual(["tblNotUsedByAtlas1"]);
    expect(p.batches).toHaveLength(1);
    const r = p.batches[0]!.records[0] as Record<string, unknown>;
    expect(p.batches[0]!.entity).toBe("costItems");
    expect(r).toMatchObject({ id: "recDemoCostImp001", name: "Demo gravel", unit: "Tonne", currentUnitCostInc: 6550, active: true, confidence: "Estimate", supplier: null });
  });

  it("accepts REST-style records keyed by field name and table name, and link objects", () => {
    const p = parseImport({ format: "airtable", tables: { "Cost Library": [{ id: "recDemoCostImp002", fields: { "Item Name": "Demo sand", "Cost Price History": [{ id: "recDemoHistImp001", name: "x" }] } }] } });
    expect(p.batches[0]!.records[0]).toMatchObject({ name: "Demo sand", priceHistoryIds: ["recDemoHistImp001"], active: false });
  });

  it("reads an ATLAS backup and rejects anything else", () => {
    const p = parseImport({ format: "atlas-export", version: 1, entities: { costItems: [{ id: "recDemoCostImp003", name: "X" }], nope: [] } });
    expect(p.batches[0]!.records).toHaveLength(1);
    expect(p.ignored).toEqual(["nope"]);
    expect(() => parseImport({ format: "csv" })).toThrow();
    expect(() => parseImport({ format: "airtable", tables: { "Cost Library": [{ id: "not-a-record-id" }] } })).toThrow();
  });
});
