import "server-only";
import { AirtableError, AirtableRepository } from "../data/airtable/client";
import { ENTITIES, type EntityName, type Rec } from "../data/entities";
import type { ImportMode, ImportResult, PostgresRepository } from "../data/postgres/repository";
import { HttpError } from "./api";

/** The Whispering Leaf base. Not a secret: it is useless without a token. */
export const DEFAULT_BASE_ID = "appygHLmJTH1ew5r6";

/** The price lists an estimate needs. Customers and jobs are not pulled this way. */
export const LIBRARY_ENTITIES = ["costItems", "productivity", "omissionRules"] as const satisfies readonly EntityName[];

/**
 * Reads the Cost Library, Productivity Rates and Omission Rules straight from
 * Airtable (read only, nothing in Airtable changes) and saves them into ATLAS's
 * own database. The token is used for this one read and never stored.
 */
export async function pullLibrariesFromAirtable(
  repo: PostgresRepository,
  opts: { token: string; baseId?: string; mode?: ImportMode; by: string; fetchImpl?: typeof fetch },
): Promise<ImportResult[]> {
  const at = new AirtableRepository(opts.token, opts.baseId || DEFAULT_BASE_ID, opts.fetchImpl);
  const batches: { entity: EntityName; records: Rec<EntityName>[] }[] = [];
  try {
    for (const entity of LIBRARY_ENTITIES) batches.push({ entity, records: (await at.list(entity)) as Rec<EntityName>[] });
  } catch (e) {
    if (e instanceof AirtableError) {
      if (e.status === 401) throw new HttpError(400, "Airtable didn't accept that token. Check you copied all of it.");
      if (e.status === 403 || e.status === 404) throw new HttpError(400, `That token can't read the Whispering Leaf base. When creating it, add the scope data.records:read and give it access to the base. (${ENTITIES[LIBRARY_ENTITIES[batches.length]!].table})`);
      throw new HttpError(502, "Airtable didn't answer properly. Try again in a minute.");
    }
    throw new HttpError(502, "Couldn't reach Airtable. Try again in a minute.");
  }
  return repo.importRecords(batches, opts.mode ?? "add-new", { by: opts.by, source: "Airtable (pulled directly)" });
}

const g = globalThis as unknown as { __atlasAutoSeed?: Promise<void> };

/**
 * When the server has AIRTABLE_TOKEN set and the Cost Library is empty, fill it
 * from Airtable once. Runs in the background on first use; failures are logged
 * and the owner can still import from Settings.
 */
export function autoSeedLibraries(repo: PostgresRepository): Promise<void> {
  const token = process.env.AIRTABLE_TOKEN;
  if (!token) return Promise.resolve();
  g.__atlasAutoSeed ??= (async () => {
    try {
      const counts = await repo.counts();
      if (counts.costItems) return;
      const r = await pullLibrariesFromAirtable(repo, { token, baseId: process.env.AIRTABLE_BASE_ID, by: "ATLAS (automatic first load)" });
      console.info(JSON.stringify({ type: "atlas.autoseed", results: r }));
    } catch (e) {
      console.error(JSON.stringify({ type: "atlas.autoseed.failed", error: e instanceof Error ? e.message : String(e) }));
    }
  })();
  return g.__atlasAutoSeed;
}
