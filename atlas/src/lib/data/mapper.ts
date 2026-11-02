import { AIRTABLE_SCHEMA } from "./airtable/schema.generated";
import { ENTITIES, type EntityName, type FieldSpec, type Rec } from "./entities";

type SchemaField = { id: string; type: string };
const SCHEMA = AIRTABLE_SCHEMA as unknown as Record<string, { id: string; fields: Record<string, SchemaField> }>;

const TEXT_TYPES = new Set(["singleLineText", "multilineText", "richText", "email", "phoneNumber", "url"]);

export function tableId(entity: EntityName): string {
  return SCHEMA[ENTITIES[entity].table]!.id;
}

export function fieldMeta(entity: EntityName, key: string): { spec: FieldSpec; id: string; type: string } {
  const spec = (ENTITIES[entity].fields as Record<string, FieldSpec>)[key];
  if (!spec) throw new Error(`Unknown field ${entity}.${key}`);
  const f = SCHEMA[ENTITIES[entity].table]!.fields[spec.field];
  if (!f) throw new Error(`Field "${spec.field}" missing from schema for ${entity}`);
  return { spec, id: f.id, type: f.type };
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const cleaned = v.replace(/[$,\s]/g, "");
    if (cleaned === "") return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  if (Array.isArray(v) && v.length === 1) return num(v[0]);
  return null;
}

/** Convert one Airtable cell (by field id) into the ATLAS domain value. */
export function decodeValue(spec: FieldSpec, raw: unknown): unknown {
  if (raw === undefined || raw === null) {
    if (spec.kind === "checkbox") return false;
    if (spec.kind === "links" || spec.kind === "multiselect" || spec.kind === "attachments") return [];
    return null;
  }
  switch (spec.kind) {
    case "currency": {
      const n = num(raw);
      return n === null ? null : Math.round(n * 100);
    }
    case "number":
    case "percent":
      return num(raw);
    case "checkbox":
      return raw === true;
    case "links":
    case "multiselect":
      return Array.isArray(raw) ? raw.map(String) : [String(raw)];
    case "attachments":
      return Array.isArray(raw)
        ? raw.map((a: { url?: string; filename?: string; type?: string }) => ({ url: a.url ?? "", filename: a.filename ?? "file", type: a.type }))
        : [];
    case "collaborator":
      return typeof raw === "object" && raw && "name" in raw ? String((raw as { name: unknown }).name) : String(raw);
    case "computed": {
      if (Array.isArray(raw)) return raw.length ? raw.map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x))).join(", ") : null;
      if (typeof raw === "object" && raw && "specialValue" in raw) return null; // #ERROR / NaN
      if (typeof raw === "object" && raw && "error" in raw) return null;
      return typeof raw === "number" || typeof raw === "string" ? raw : String(raw);
    }
    case "select":
      return typeof raw === "object" && raw && "name" in raw ? String((raw as { name: unknown }).name) : String(raw);
    default:
      return typeof raw === "string" ? raw : String(raw);
  }
}

/** Convert a domain value into what the Airtable REST API expects for that field type. */
export function encodeValue(spec: FieldSpec, airtableType: string, value: unknown): unknown {
  if (value === undefined) return undefined;
  const isText = TEXT_TYPES.has(airtableType);
  switch (spec.kind) {
    case "currency":
      if (value === null) return isText ? "" : null;
      if (typeof value !== "number" || !Number.isInteger(value)) throw new TypeError(`${spec.field} expects integer cents`);
      return isText ? (value / 100).toFixed(2) : value / 100;
    case "number":
    case "percent":
      if (value === null) return isText ? "" : null;
      if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${spec.field} expects a number`);
      return isText ? String(value) : value;
    case "checkbox":
      return value === true;
    case "links":
    case "multiselect":
      if (!Array.isArray(value)) throw new TypeError(`${spec.field} expects an array`);
      return value.map(String);
    case "date":
      if (value === null || value === "") return null;
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new TypeError(`${spec.field} expects YYYY-MM-DD`);
      return value;
    case "select":
      return value === null || value === "" ? null : String(value);
    default:
      return value === null ? (isText ? "" : null) : String(value);
  }
}

export function decodeRecord<E extends EntityName>(entity: E, rec: { id: string; createdTime?: string; fields: Record<string, unknown> }): Rec<E> {
  const out: Record<string, unknown> = { id: rec.id, createdTime: rec.createdTime ?? "" };
  for (const key of Object.keys(ENTITIES[entity].fields)) {
    const { spec, id } = fieldMeta(entity, key);
    out[key] = decodeValue(spec, rec.fields[id]);
  }
  return out as Rec<E>;
}

/** Build a write payload keyed by field id. Read-only fields are rejected, not silently dropped. */
export function encodeFields<E extends EntityName>(entity: E, data: Partial<Rec<E>>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (key === "id" || key === "createdTime" || value === undefined) continue;
    const { spec, id, type } = fieldMeta(entity, key);
    if (spec.readOnly) throw new Error(`${entity}.${key} is calculated in Airtable and cannot be written`);
    out[id] = encodeValue(spec, type, value);
  }
  return out;
}
