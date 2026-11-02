import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ENTITIES, type EntityName, type FieldSpec, type Rec } from "../entities";
import { applyListOptions, type ListOptions, type Repository } from "../repository";
import { buildFixtures } from "./fixtures";

type Store = { [E in EntityName]?: Rec<E>[] };

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
export function newRecordId(): string {
  const bytes = randomBytes(14);
  return "rec" + Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

/**
 * In-process store with clearly fictional data. Used by tests, local demos and
 * the end-to-end run. It applies the same read-only rules as Airtable so code
 * cannot rely on writing calculated fields. Optional JSON persistence for dev.
 */
export class MemoryRepository implements Repository {
  readonly source = "memory" as const;
  private store: Store;

  constructor(private persistPath?: string, seed: Store = buildFixtures()) {
    if (persistPath && fs.existsSync(persistPath)) {
      this.store = JSON.parse(fs.readFileSync(persistPath, "utf8")) as Store;
    } else {
      this.store = structuredClone(seed);
    }
  }

  private rows<E extends EntityName>(entity: E): Rec<E>[] {
    return ((this.store[entity] as Rec<E>[] | undefined) ??= [] as never);
  }

  private save() {
    if (!this.persistPath) return;
    fs.mkdirSync(path.dirname(this.persistPath), { recursive: true });
    fs.writeFileSync(this.persistPath, JSON.stringify(this.store));
  }

  private validate<E extends EntityName>(entity: E, data: Partial<Rec<E>>) {
    const fields = ENTITIES[entity].fields as Record<string, FieldSpec>;
    for (const [k, v] of Object.entries(data)) {
      if (k === "id" || k === "createdTime" || v === undefined) continue;
      const spec = fields[k];
      if (!spec) throw new Error(`Unknown field ${entity}.${k}`);
      if (spec.readOnly) throw new Error(`${entity}.${k} is calculated in Airtable and cannot be written`);
      if (spec.kind === "currency" && v !== null && !Number.isInteger(v)) throw new TypeError(`${spec.field} expects integer cents`);
      if (spec.kind === "date" && v !== null && v !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(String(v))) throw new TypeError(`${spec.field} expects YYYY-MM-DD`);
    }
  }

  async list<E extends EntityName>(entity: E, opts?: ListOptions<E>): Promise<Rec<E>[]> {
    return applyListOptions(structuredClone(this.rows(entity)), opts);
  }

  async get<E extends EntityName>(entity: E, id: string): Promise<Rec<E> | null> {
    const r = this.rows(entity).find((x) => x.id === id);
    return r ? structuredClone(r) : null;
  }

  async create<E extends EntityName>(entity: E, data: Partial<Rec<E>>): Promise<Rec<E>> {
    this.validate(entity, data);
    const { id: _i, createdTime: _c, ...rest } = data as Record<string, unknown>;
    const rec = { ...rest, id: newRecordId(), createdTime: new Date().toISOString() } as Rec<E>;
    this.rows(entity).push(rec);
    this.save();
    return structuredClone(rec);
  }

  async update<E extends EntityName>(entity: E, id: string, data: Partial<Rec<E>>): Promise<Rec<E>> {
    this.validate(entity, data);
    const rows = this.rows(entity);
    const i = rows.findIndex((x) => x.id === id);
    if (i < 0) throw new Error(`${entity} ${id} not found`);
    const { id: _i, createdTime: _c, ...rest } = data as Record<string, unknown>;
    rows[i] = { ...rows[i]!, ...rest } as Rec<E>;
    this.save();
    return structuredClone(rows[i]!);
  }
}
