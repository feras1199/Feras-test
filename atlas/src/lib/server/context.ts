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
import { mergeSettings, resolveSettings, type Settings } from "../config/settings";
import { SESSION_COOKIE, verifySession, type SessionPayload } from "../auth/session";
import { can, type Permission } from "../auth/roles";
import { setUserStore, stillAuthorised, type AtlasUser } from "../auth/users";

const g = globalThis as unknown as {
  __atlasRepo?: Repository;
  __atlasBaseSettings?: Settings;
  __atlasSettingsOverride?: Settings;
  __atlasSettingsMeta?: { updatedTime: string; updatedBy: string };
  __atlasSettingsCache?: { at: number; value: { settings: Settings; meta: SettingsMeta } };
};

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
    setUserStore({ list: async () => (await repo.listUsers()) as AtlasUser[] });
    g.__atlasRepo = repo;
    // Loaded lazily to keep context.ts free of import cycles.
    void import("./airtablePull").then((m) => m.autoSeedLibraries(repo)).catch(() => undefined);
  } else if (dataSource() === "airtable") {
    g.__atlasRepo = new AirtableRepository(process.env.AIRTABLE_TOKEN ?? "", process.env.AIRTABLE_BASE_ID ?? "");
  } else {
    const persist = process.env.ATLAS_MEMORY_PERSIST === "1" ? path.join(process.cwd(), "data", "local-store.json") : undefined;
    g.__atlasRepo = new MemoryRepository(persist);
  }
  return g.__atlasRepo;
}

/**
 * The settings ATLAS started with: ATLAS_SETTINGS_JSON, else data/settings.json,
 * else the built-in defaults. With ATLAS's own database these only seed the
 * stored settings on first run; after that the owner edits them in the app.
 */
export function baseSettings(): Settings {
  if (g.__atlasBaseSettings) return g.__atlasBaseSettings;
  let overrides: unknown = undefined;
  if (process.env.ATLAS_SETTINGS_JSON) overrides = JSON.parse(process.env.ATLAS_SETTINGS_JSON);
  else {
    const f = path.join(process.cwd(), "data", "settings.json");
    if (fs.existsSync(f)) overrides = JSON.parse(fs.readFileSync(f, "utf8"));
  }
  g.__atlasBaseSettings = resolveSettings(overrides);
  return g.__atlasBaseSettings;
}

const SETTINGS_KEY = "business";
/** Re-read from the database at most this often, so a save on another server instance shows up soon. */
const SETTINGS_TTL_MS = 15_000;

export interface SettingsMeta { stored: boolean; updatedTime?: string; updatedBy?: string }

async function loadSettings(): Promise<{ settings: Settings; meta: SettingsMeta }> {
  const repo = getRepo();
  if (repo instanceof PostgresRepository) {
    let doc = await repo.getSettingsDoc(SETTINGS_KEY);
    if (!doc) {
      await repo.putSettingsDoc(SETTINGS_KEY, baseSettings(), "ATLAS (first start)", { onlyIfMissing: true });
      doc = await repo.getSettingsDoc(SETTINGS_KEY);
    }
    try {
      // Merged over the start-up settings so a field added to ATLAS later gets its default.
      return { settings: resolveSettings(mergeSettings(baseSettings(), doc?.data)), meta: { stored: true, updatedTime: doc?.updatedTime, updatedBy: doc?.updatedBy } };
    } catch (e) {
      console.error(JSON.stringify({ type: "atlas.settings", error: `stored settings invalid, using start-up settings: ${String(e)}` }));
      return { settings: baseSettings(), meta: { stored: false } };
    }
  }
  // Demo and Airtable modes keep edits in memory until the server restarts.
  return { settings: g.__atlasSettingsOverride ?? baseSettings(), meta: { stored: false, updatedTime: g.__atlasSettingsMeta?.updatedTime, updatedBy: g.__atlasSettingsMeta?.updatedBy } };
}

/** Business rules for every calculation. Owner edits are stored in ATLAS's database. */
export async function getSettings(): Promise<Settings> {
  return (await getSettingsWithMeta()).settings;
}

export async function getSettingsWithMeta(): Promise<{ settings: Settings; meta: SettingsMeta }> {
  const c = g.__atlasSettingsCache;
  if (c && Date.now() - c.at < SETTINGS_TTL_MS) return c.value;
  const value = await loadSettings();
  g.__atlasSettingsCache = { at: Date.now(), value };
  return value;
}

export async function saveSettings(next: Settings, by: string): Promise<void> {
  const repo = getRepo();
  if (repo instanceof PostgresRepository) await repo.putSettingsDoc(SETTINGS_KEY, next, by);
  else {
    g.__atlasSettingsOverride = next;
    g.__atlasSettingsMeta = { updatedTime: new Date().toISOString(), updatedBy: by };
  }
  g.__atlasSettingsCache = undefined;
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
  return s && (await stillAuthorised(s)) ? s : null;
}

/** For server components: redirect to login, or to a forbidden page, when not allowed. */
export async function requirePage(perm: Permission): Promise<SessionPayload> {
  const s = await currentSession();
  if (!s) redirect("/login");
  if (!can(s.role, perm)) redirect(s.role === "customer" ? "/portal" : "/forbidden");
  return s;
}
