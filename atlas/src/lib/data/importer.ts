import { z } from "zod";
import { ROLES } from "../auth/roles";
import { AIRTABLE_SCHEMA } from "./airtable/schema.generated";
import { ENTITIES, type EntityName, type Rec } from "./entities";
import { decodeRecord } from "./mapper";

/**
 * Reads an uploaded data file into ATLAS records. Two formats:
 *
 * 1. "atlas-export": ATLAS's own backup download, records already in ATLAS shape.
 * 2. "airtable": raw Airtable records grouped by table id or table name, as the
 *    Airtable API or the Airtable connector returns them (cells keyed by field
 *    id or by field name). Decoded with the same mapper the live Airtable mode used.
 *
 * Nothing here talks to Airtable; it only reads the file it is given.
 */

const RECORD_ID = /^rec[A-Za-z0-9]{14}$/;

const AirtableRecord = z.object({
  id: z.string().regex(RECORD_ID),
  createdTime: z.string().optional(),
  cellValuesByFieldId: z.record(z.string(), z.unknown()).optional(),
  fields: z.record(z.string(), z.unknown()).optional(),
});

export const ImportFile = z.discriminatedUnion("format", [
  z.object({
    format: z.literal("atlas-export"),
    version: z.union([z.literal(1), z.literal(2)]),
    /** Version 2 backups also carry the logins added in the app (with their password hashes). */
    logins: z.array(z.object({ id: z.string().min(1).max(40), email: z.string().email(), name: z.string().min(1), role: z.string().min(1), customerId: z.string().optional(), passwordHash: z.string().startsWith("scrypt$"), active: z.boolean() })).optional(),
    entities: z.record(z.string(), z.array(z.object({ id: z.string().regex(RECORD_ID), createdTime: z.string().optional() }).passthrough())),
  }),
  z.object({
    format: z.literal("airtable"),
    tables: z.record(z.string(), z.array(AirtableRecord)),
  }),
]);
export type ImportFile = z.infer<typeof ImportFile>;

type SchemaTable = { id: string; fields: Record<string, { id: string; type: string }> };
const SCHEMA = AIRTABLE_SCHEMA as unknown as Record<string, SchemaTable>;

function entityForTable(key: string): EntityName | null {
  for (const e of Object.keys(ENTITIES) as EntityName[]) {
    const table = ENTITIES[e].table;
    if (table === key || SCHEMA[table]?.id === key) return e;
  }
  return null;
}

/** Linked records sometimes arrive as [{id, name}] instead of ["rec…"]; keep the ids. */
function normaliseCell(v: unknown): unknown {
  if (Array.isArray(v) && v.length && v.every((x) => x && typeof x === "object" && typeof (x as { id?: unknown }).id === "string" && RECORD_ID.test((x as { id: string }).id))) {
    return v.map((x) => (x as { id: string }).id);
  }
  return v;
}

export interface ParsedImport {
  source: string;
  batches: { entity: EntityName; records: Rec<EntityName>[] }[];
  /** Tables in the file that ATLAS doesn't use, so the owner can see what was left out. */
  ignored: string[];
  /** Logins found in an ATLAS backup. */
  logins?: { id: string; email: string; name: string; role: string; customerId?: string; passwordHash: string; active: boolean }[];
}

export function parseImport(raw: unknown): ParsedImport {
  const file = ImportFile.parse(raw);
  const batches: ParsedImport["batches"] = [];
  const ignored: string[] = [];

  if (file.format === "atlas-export") {
    for (const [key, records] of Object.entries(file.entities)) {
      if (!(key in ENTITIES)) { ignored.push(key); continue; }
      batches.push({ entity: key as EntityName, records: records as unknown as Rec<EntityName>[] });
    }
    return { source: "ATLAS backup file", batches, ignored, logins: file.logins?.filter((u) => (ROLES as readonly string[]).includes(u.role)) };
  }

  for (const [key, records] of Object.entries(file.tables)) {
    const entity = entityForTable(key);
    if (!entity) { ignored.push(key); continue; }
    const table = SCHEMA[ENTITIES[entity].table]!;
    const byName = table.fields;
    const out = records.map((r) => {
      const cells = r.cellValuesByFieldId ?? r.fields ?? {};
      const fields: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(cells)) {
        const id = k.startsWith("fld") ? k : byName[k]?.id;
        if (id) fields[id] = normaliseCell(v);
      }
      return decodeRecord(entity, { id: r.id, createdTime: r.createdTime, fields }) as Rec<EntityName>;
    });
    batches.push({ entity, records: out });
  }
  return { source: "Airtable export file", batches, ignored };
}
