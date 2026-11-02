import "server-only";
import fs from "node:fs";
import path from "node:path";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AirtableRepository } from "../data/airtable/client";
import { MemoryRepository } from "../data/memory/repository";
import { PostgresRepository } from "../data/postgres/repository";
import { setAuditStore } from "./audit";
import type { Repository } from "../data/repository";
import { resolveSettings, type Settings } from "../config/settings";
import { SESSION_COOKIE, verifySession, type SessionPayload } from "../auth/session";
import { can, type Permission } from "../auth/roles";
import { stillAuthorised } from "../auth/users";

const g = globalThis as unknown as { __atlasRepo?: Repository; __atlasSettings?: Settings };

export type DataSource = "postgres" | "airtable" | "memory";

export function dataSource(): DataSource {
  const v = process.env.ATLAS_DATA_SOURCE;
  return v === "postgres" ? "postgres" : v === "airtable" ? "airtable" : "memory";
}

/** Real business data (not the fictional demo store). */
export function isLive(): boolean {
  return dataSource() !== "memory";
}

export function getRepo(): Repository {
  if (g.__atlasRepo) return g.__atlasRepo;
  if (dataSource() === "postgres") {
    if (!process.env.DATABASE_URL) throw new Error("ATLAS_DATA_SOURCE=postgres needs DATABASE_URL");
    // Loaded lazily so demo and Airtable modes don't need the driver.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Pool } = require("pg") as typeof import("pg");
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: Number(process.env.DATABASE_POOL_MAX ?? 5) });
    const repo = new PostgresRepository(pool);
    setAuditStore({ write: (e) => repo.writeAudit(e), read: (n) => repo.readAudit(n) });
    g.__atlasRepo = repo;
  } else if (dataSource() === "airtable") {
    g.__atlasRepo = new AirtableRepository(process.env.AIRTABLE_TOKEN ?? "", process.env.AIRTABLE_BASE_ID ?? "");
  } else {
    const persist = process.env.ATLAS_MEMORY_PERSIST === "1" ? path.join(process.cwd(), "data", "local-store.json") : undefined;
    g.__atlasRepo = new MemoryRepository(persist);
  }
  return g.__atlasRepo;
}

export function getSettings(): Settings {
  if (g.__atlasSettings) return g.__atlasSettings;
  let overrides: unknown = undefined;
  if (process.env.ATLAS_SETTINGS_JSON) overrides = JSON.parse(process.env.ATLAS_SETTINGS_JSON);
  else {
    const f = path.join(process.cwd(), "data", "settings.json");
    if (fs.existsSync(f)) overrides = JSON.parse(fs.readFileSync(f, "utf8"));
  }
  g.__atlasSettings = resolveSettings(overrides);
  return g.__atlasSettings;
}

export function sessionSecret(): string {
  const s = process.env.ATLAS_SESSION_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === "production") throw new Error("ATLAS_SESSION_SECRET is required in production");
  return "dev-only-secret-not-for-production-use-0123456789";
}

export async function currentSession(): Promise<SessionPayload | null> {
  const jar = await cookies();
  const s = await verifySession(jar.get(SESSION_COOKIE)?.value, sessionSecret());
  return s && stillAuthorised(s) ? s : null;
}

/** For server components: redirect to login, or to a forbidden page, when not allowed. */
export async function requirePage(perm: Permission): Promise<SessionPayload> {
  const s = await currentSession();
  if (!s) redirect("/login");
  if (!can(s.role, perm)) redirect(s.role === "customer" ? "/portal" : "/forbidden");
  return s;
}
