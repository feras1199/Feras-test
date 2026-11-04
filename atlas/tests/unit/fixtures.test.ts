import { describe, expect, it } from "vitest";
import options from "../../docs/airtable-select-options.json";
import { ENTITIES, type EntityName, type FieldSpec } from "@/lib/data/entities";
import { buildFixtures } from "@/lib/data/memory/fixtures";

const opts = options as Record<string, Record<string, string[]>>;

describe("fictional fixtures only use values Airtable accepts", () => {
  const store = buildFixtures(new Date("2026-11-02T00:00:00Z"));
  for (const [entity, rows] of Object.entries(store)) {
    it(entity, () => {
      const spec = ENTITIES[entity as EntityName];
      for (const row of rows as Record<string, unknown>[]) {
        for (const [k, v] of Object.entries(row)) {
          if (k === "id" || k === "createdTime") continue;
          const f = (spec.fields as Record<string, FieldSpec>)[k];
          expect(f, `${entity}.${k}`).toBeDefined();
          if (f!.kind === "select" && v) expect(opts[spec.table]?.[f!.field], `${entity}.${k}`).toContain(v);
          if (f!.kind === "currency" && v !== null) expect(Number.isInteger(v)).toBe(true);
          if (f!.kind === "links") expect(Array.isArray(v)).toBe(true);
        }
      }
    });
  }
  it("contains no real-looking contact details", () => {
    const json = JSON.stringify(store);
    for (const m of json.match(/[\w.+-]+@[\w.-]+/g) ?? []) expect(m.endsWith("@example.com")).toBe(true);
    for (const m of json.match(/04\d\d \d{3} \d{3}/g) ?? []) expect(m.startsWith("0491 570")).toBe(true);
  });
});
