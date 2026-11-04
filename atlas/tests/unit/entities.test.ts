import { describe, expect, it } from "vitest";
import { ENTITIES } from "@/lib/data/entities";
import { AIRTABLE_SCHEMA } from "@/lib/data/airtable/schema.generated";

const READ_ONLY_TYPES = new Set(["formula", "rollup", "lookup", "multipleLookupValues", "count", "createdTime", "lastModifiedTime", "autoNumber", "createdBy", "lastModifiedBy", "button"]);

describe("entity mapping matches the live Airtable schema", () => {
  for (const [name, spec] of Object.entries(ENTITIES)) {
    it(name, () => {
      const table = (AIRTABLE_SCHEMA as Record<string, { fields: Record<string, { id: string; type: string }> }>)[spec.table];
      expect(table, `table ${spec.table}`).toBeDefined();
      for (const [key, f] of Object.entries(spec.fields) as [string, { field: string; readOnly?: boolean; local?: boolean }][]) {
        if (f.local) continue; // lives in ATLAS's own database only
        const field = table!.fields[f.field];
        expect(field, `${name}.${key} -> "${f.field}"`).toBeDefined();
        // A computed Airtable field must never be mapped as writable.
        if (READ_ONLY_TYPES.has(field!.type)) {
          expect(f.readOnly, `${name}.${key} ("${f.field}", ${field!.type}) must be readOnly`).toBe(true);
        }
      }
      expect(Object.keys(spec.fields)).toContain(spec.primary);
    });
  }
});
