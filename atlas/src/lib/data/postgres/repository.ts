import type { Pool, PoolClient } from "pg";
import { ENTITIES, type EntityName, type Rec } from "../entities";
import { applyListOptions, newRecordId, validateWrite, type ListOptions, type Repository } from "../repository";

/**
 * ATLAS's own database. One table holds every record as JSON, keyed by entity
 * and id, so the app's data model stays in code (entities.ts) and adding a
 * field needs no database migration. Business volumes here are thousands of
 * rows, not millions, so lists are filtered in the app like the other stores.
 *
 * There is no hard delete, same as everywhere else in ATLAS.
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS atlas_records (
  entity       text        NOT NULL,
  id           text        NOT NULL,
  created_time timestamptz NOT NULL DEFAULT now(),
  updated_time timestamptz NOT NULL DEFAULT now(),
  data         jsonb       NOT NULL,
  PRIMARY KEY (entity, id)
);
CREATE TABLE IF NOT EXISTS atlas_audit (
  seq     bigserial   PRIMARY KEY,
  at      timestamptz NOT NULL,
  entry   jsonb       NOT NULL
);
CREATE TABLE IF NOT EXISTS atlas_imports (
  seq         bigserial   PRIMARY KEY,
  at          timestamptz NOT NULL DEFAULT now(),
  by_user     text        NOT NULL,
  source      text        NOT NULL,
  mode        text        NOT NULL,
  summary     jsonb       NOT NULL
);
`;

type Row = { id: string; created_time: Date; data: Record<string, unknown> };

function toRec<E extends EntityName>(r: Row): Rec<E> {
  return { ...r.data, id: r.id, createdTime: r.created_time.toISOString() } as Rec<E>;
}

/** Drop id/createdTime and undefined values; keep only fields the entity defines. */
function payload(entity: EntityName, data: Record<string, unknown>) {
  const fields = ENTITIES[entity].fields as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (k === "id" || k === "createdTime" || v === undefined) continue;
    if (k in fields) out[k] = v;
  }
  return out;
}

export type ImportMode = "add-new" | "replace";
export interface ImportResult { entity: EntityName; added: number; replaced: number; skipped: number }

export class PostgresRepository implements Repository {
  readonly source = "postgres" as const;
  private ready: Promise<void> | null = null;

  constructor(private pool: Pool) {}

  /** Creates the tables on first use. Safe to run any number of times. */
  ensureSchema(): Promise<void> {
    this.ready ??= this.pool.query(SCHEMA_SQL).then(() => undefined).catch((e) => { this.ready = null; throw e; });
    return this.ready;
  }

  async list<E extends EntityName>(entity: E, opts?: ListOptions<E>): Promise<Rec<E>[]> {
    await this.ensureSchema();
    const { rows } = await this.pool.query<Row>("SELECT id, created_time, data FROM atlas_records WHERE entity = $1 ORDER BY created_time, id", [entity]);
    return applyListOptions(rows.map((r) => toRec<E>(r)), opts);
  }

  async get<E extends EntityName>(entity: E, id: string): Promise<Rec<E> | null> {
    await this.ensureSchema();
    const { rows } = await this.pool.query<Row>("SELECT id, created_time, data FROM atlas_records WHERE entity = $1 AND id = $2", [entity, id]);
    return rows[0] ? toRec<E>(rows[0]) : null;
  }

  async create<E extends EntityName>(entity: E, data: Partial<Rec<E>>): Promise<Rec<E>> {
    validateWrite(entity, data);
    await this.ensureSchema();
    const { rows } = await this.pool.query<Row>(
      "INSERT INTO atlas_records (entity, id, data) VALUES ($1, $2, $3::jsonb) RETURNING id, created_time, data",
      [entity, newRecordId(), JSON.stringify(payload(entity, data as Record<string, unknown>))],
    );
    return toRec<E>(rows[0]!);
  }

  async update<E extends EntityName>(entity: E, id: string, data: Partial<Rec<E>>): Promise<Rec<E>> {
    validateWrite(entity, data);
    await this.ensureSchema();
    // jsonb || merges at the top level in one statement, so two people saving
    // different fields of the same record don't overwrite each other.
    const { rows } = await this.pool.query<Row>(
      "UPDATE atlas_records SET data = data || $3::jsonb, updated_time = now() WHERE entity = $1 AND id = $2 RETURNING id, created_time, data",
      [entity, id, JSON.stringify(payload(entity, data as Record<string, unknown>))],
    );
    if (!rows[0]) throw new Error(`${entity} ${id} not found`);
    return toRec<E>(rows[0]);
  }

  /**
   * Bulk load for the Airtable import. Keeps ids and created times so links
   * between imported records still work. Calculated fields are kept as a
   * snapshot of their last value. "add-new" never touches records already in
   * ATLAS; "replace" overwrites them with the imported copy. All or nothing.
   */
  async importRecords(batches: { entity: EntityName; records: Rec<EntityName>[] }[], mode: ImportMode, meta: { by: string; source: string }): Promise<ImportResult[]> {
    await this.ensureSchema();
    const client: PoolClient = await this.pool.connect();
    const results: ImportResult[] = [];
    try {
      await client.query("BEGIN");
      for (const { entity, records } of batches) {
        const r: ImportResult = { entity, added: 0, replaced: 0, skipped: 0 };
        for (const rec of records) {
          const created = rec.createdTime && !Number.isNaN(Date.parse(rec.createdTime)) ? rec.createdTime : new Date().toISOString();
          const sql = mode === "replace"
            ? "INSERT INTO atlas_records (entity, id, created_time, data) VALUES ($1,$2,$3,$4::jsonb) ON CONFLICT (entity, id) DO UPDATE SET data = EXCLUDED.data, updated_time = now() RETURNING (xmax = 0) AS inserted"
            : "INSERT INTO atlas_records (entity, id, created_time, data) VALUES ($1,$2,$3,$4::jsonb) ON CONFLICT (entity, id) DO NOTHING RETURNING true AS inserted";
          const { rows } = await client.query<{ inserted: boolean }>(sql, [entity, rec.id, created, JSON.stringify(payload(entity, rec as Record<string, unknown>))]);
          if (!rows[0]) r.skipped++;
          else if (rows[0].inserted) r.added++;
          else r.replaced++;
        }
        results.push(r);
      }
      await client.query("INSERT INTO atlas_imports (by_user, source, mode, summary) VALUES ($1,$2,$3,$4::jsonb)", [meta.by, meta.source, mode, JSON.stringify(results)]);
      await client.query("COMMIT");
      return results;
    } catch (e) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  /** Every record, for the owner's download-a-backup button. */
  async exportAll(): Promise<{ [E in EntityName]?: Rec<E>[] }> {
    await this.ensureSchema();
    const { rows } = await this.pool.query<Row & { entity: EntityName }>("SELECT entity, id, created_time, data FROM atlas_records ORDER BY entity, created_time, id");
    const out: Record<string, Rec<EntityName>[]> = {};
    for (const r of rows) (out[r.entity] ??= []).push(toRec(r));
    return out as never;
  }

  async counts(): Promise<Record<string, number>> {
    await this.ensureSchema();
    const { rows } = await this.pool.query<{ entity: string; n: string }>("SELECT entity, count(*) AS n FROM atlas_records GROUP BY entity");
    return Object.fromEntries(rows.map((r) => [r.entity, Number(r.n)]));
  }

  async writeAudit(entry: { at: string }): Promise<void> {
    await this.ensureSchema();
    await this.pool.query("INSERT INTO atlas_audit (at, entry) VALUES ($1, $2::jsonb)", [entry.at, JSON.stringify(entry)]);
  }

  async readAudit<T>(limit: number): Promise<T[]> {
    await this.ensureSchema();
    const { rows } = await this.pool.query<{ entry: T }>("SELECT entry FROM atlas_audit ORDER BY seq DESC LIMIT $1", [limit]);
    return rows.map((r) => r.entry);
  }
}
