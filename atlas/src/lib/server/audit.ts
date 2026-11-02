import "server-only";
import type { SessionPayload } from "../auth/session";

export interface AuditEntry {
  at: string;
  userId: string;
  userName: string;
  role: string;
  action: string; // e.g. "customer.create", "login.success"
  entity?: string;
  recordId?: string;
  summary: string;
  before?: unknown;
  after?: unknown;
}

interface AuditStore { write(e: AuditEntry): Promise<void>; read(limit: number): Promise<AuditEntry[]> }
const g = globalThis as unknown as { __atlasAudit?: AuditEntry[]; __atlasAuditStore?: AuditStore };

/** With ATLAS's own database, audit entries are kept there permanently as well. */
export function setAuditStore(store: AuditStore) {
  g.__atlasAuditStore = store;
}
const MAX = 2000;

/**
 * Every write goes through here. Entries are kept in process (shown on the
 * Audit page) and written as one JSON line to the server log so the hosting
 * platform retains them. Once the additive "Atlas Audit Log" table is approved
 * in Airtable, entries will also be stored there.
 */
export function audit(user: Pick<SessionPayload, "uid" | "name" | "role"> | null, e: Omit<AuditEntry, "at" | "userId" | "userName" | "role">) {
  const entry: AuditEntry = { at: new Date().toISOString(), userId: user?.uid ?? "anonymous", userName: user?.name ?? "anonymous", role: user?.role ?? "none", ...e };
  const log = (g.__atlasAudit ??= []);
  log.unshift(entry);
  if (log.length > MAX) log.length = MAX;
  console.info(JSON.stringify({ type: "atlas.audit", ...entry }));
  g.__atlasAuditStore?.write(entry).catch((err) => console.error(JSON.stringify({ type: "atlas.audit.store_failed", error: String(err), entry })));
  return entry;
}

export async function recentAudit(limit = 200): Promise<{ rows: AuditEntry[]; stored: boolean }> {
  const store = g.__atlasAuditStore;
  if (store) {
    try {
      return { rows: await store.read(limit), stored: true };
    } catch (err) {
      console.error(JSON.stringify({ type: "atlas.audit.read_failed", error: String(err) }));
    }
  }
  return { rows: (g.__atlasAudit ?? []).slice(0, limit), stored: false };
}
