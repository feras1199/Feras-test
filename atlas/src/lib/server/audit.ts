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

const g = globalThis as unknown as { __atlasAudit?: AuditEntry[] };
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
  return entry;
}

export function recentAudit(limit = 200): AuditEntry[] {
  return (g.__atlasAudit ?? []).slice(0, limit);
}
