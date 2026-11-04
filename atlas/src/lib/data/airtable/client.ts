import "server-only";
import { ENTITIES, type EntityName, type Rec } from "../entities";
import { decodeRecord, encodeFields, tableId } from "../mapper";
import { applyListOptions, type ListOptions, type Repository } from "../repository";

const API = "https://api.airtable.com/v0";
const MIN_INTERVAL_MS = 220; // Airtable allows 5 requests/second per base
const CACHE_TTL_MS = 30_000;
const MAX_RETRIES = 5;

export class AirtableError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

type AirtableRecord = { id: string; createdTime: string; fields: Record<string, unknown> };

/**
 * Server-only Airtable REST client. The token never leaves the server.
 * - reads and writes by field ID (returnFieldsByFieldId), so renaming a field in Airtable does not break the app
 * - serialises requests to stay under the 5 req/s limit
 * - retries 429 and 5xx with exponential backoff
 * - caches full-table reads briefly and invalidates them on write
 */
export class AirtableRepository implements Repository {
  readonly source = "airtable" as const;
  private queue: Promise<unknown> = Promise.resolve();
  private last = 0;
  private cache = new Map<string, { at: number; rows: AirtableRecord[] }>();

  constructor(private token: string, private baseId: string, private fetchImpl: typeof fetch = fetch) {
    if (!token || !baseId) throw new Error("AIRTABLE_TOKEN and AIRTABLE_BASE_ID are required");
  }

  private request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const run = async (): Promise<T> => {
      for (let attempt = 0; ; attempt++) {
        const wait = this.last + MIN_INTERVAL_MS - Date.now();
        if (wait > 0) await sleep(wait);
        this.last = Date.now();
        const res = await this.fetchImpl(`${API}/${this.baseId}/${path}`, {
          ...init,
          headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
          cache: "no-store",
        });
        if (res.ok) return (await res.json()) as T;
        if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
          await sleep(Math.min(30_000, 1000 * 2 ** attempt) + Math.random() * 250);
          continue;
        }
        let msg = res.statusText;
        try {
          const body = (await res.json()) as { error?: { message?: string; type?: string } | string };
          msg = typeof body.error === "string" ? body.error : (body.error?.message ?? body.error?.type ?? msg);
        } catch {}
        throw new AirtableError(res.status, `Airtable ${res.status}: ${msg}`);
      }
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }

  private async all(entity: EntityName): Promise<AirtableRecord[]> {
    const tid = tableId(entity);
    const hit = this.cache.get(tid);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.rows;
    const rows: AirtableRecord[] = [];
    let offset: string | undefined;
    do {
      const qs = new URLSearchParams({ returnFieldsByFieldId: "true", pageSize: "100" });
      if (offset) qs.set("offset", offset);
      const page = await this.request<{ records: AirtableRecord[]; offset?: string }>(`${tid}?${qs}`);
      rows.push(...page.records);
      offset = page.offset;
    } while (offset);
    this.cache.set(tid, { at: Date.now(), rows });
    return rows;
  }

  async list<E extends EntityName>(entity: E, opts?: ListOptions<E>): Promise<Rec<E>[]> {
    const rows = (await this.all(entity)).map((r) => decodeRecord(entity, r));
    return applyListOptions(rows, opts);
  }

  async get<E extends EntityName>(entity: E, id: string): Promise<Rec<E> | null> {
    if (!/^rec[A-Za-z0-9]{14}$/.test(id)) return null;
    try {
      const r = await this.request<AirtableRecord>(`${tableId(entity)}/${id}?returnFieldsByFieldId=true`);
      return decodeRecord(entity, r);
    } catch (e) {
      if (e instanceof AirtableError && e.status === 404) return null;
      throw e;
    }
  }

  async create<E extends EntityName>(entity: E, data: Partial<Rec<E>>): Promise<Rec<E>> {
    const tid = tableId(entity);
    const res = await this.request<{ records: AirtableRecord[] }>(`${tid}?returnFieldsByFieldId=true`, {
      method: "POST",
      body: JSON.stringify({ records: [{ fields: encodeFields(entity, data) }], typecast: false, returnFieldsByFieldId: true }),
    });
    this.cache.delete(tid);
    return decodeRecord(entity, res.records[0]!);
  }

  async update<E extends EntityName>(entity: E, id: string, data: Partial<Rec<E>>): Promise<Rec<E>> {
    const tid = tableId(entity);
    const res = await this.request<{ records: AirtableRecord[] }>(`${tid}?returnFieldsByFieldId=true`, {
      method: "PATCH",
      body: JSON.stringify({ records: [{ id, fields: encodeFields(entity, data) }], typecast: false, returnFieldsByFieldId: true }),
    });
    this.cache.delete(tid);
    return decodeRecord(entity, res.records[0]!);
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export const ENTITY_NAMES = Object.keys(ENTITIES) as EntityName[];
