import "server-only";
import { ENTITIES, type EntityName, type Rec } from "../data/entities";
import type { Repository } from "../data/repository";
import { PostgresRepository, type ImportMode } from "../data/postgres/repository";
import type { ParsedImport } from "../data/importer";
import { HttpError } from "./api";

/** Everything ATLAS holds, in the format the importer reads back. */
export async function buildExport(repo: Repository) {
  const entities: { [E in EntityName]?: Rec<E>[] } = {};
  for (const e of Object.keys(ENTITIES) as EntityName[]) {
    const rows = await repo.list(e);
    if (rows.length) (entities as Record<string, unknown>)[e] = rows;
  }
  return { format: "atlas-export" as const, version: 1 as const, exportedAt: new Date().toISOString(), source: repo.source, entities };
}

export interface ImportPreview {
  source: string;
  ignored: string[];
  tables: { entity: EntityName; label: string; inFile: number; alreadyInAtlas: number }[];
}

export async function previewImport(repo: Repository, parsed: ParsedImport): Promise<ImportPreview> {
  const tables: ImportPreview["tables"] = [];
  for (const b of parsed.batches) {
    const existing = new Set((await repo.list(b.entity)).map((r) => r.id));
    tables.push({ entity: b.entity, label: ENTITIES[b.entity].table, inFile: b.records.length, alreadyInAtlas: b.records.filter((r) => existing.has(r.id)).length });
  }
  return { source: parsed.source, ignored: parsed.ignored, tables };
}

export async function runImport(repo: Repository, parsed: ParsedImport, mode: ImportMode, by: string) {
  if (!(repo instanceof PostgresRepository)) throw new HttpError(409, "Importing needs ATLAS's own database. Set ATLAS_DATA_SOURCE=postgres and DATABASE_URL first.");
  return repo.importRecords(parsed.batches, mode, { by, source: parsed.source });
}
