import "server-only";
import fs from "node:fs";
import path from "node:path";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AirtableRepository } from "../data/airtable/client";
import { MemoryRepository } from "../data/memory/repository";
import type { Repository } from "../data/repository";
import { resolveSettings, type Settings } from "../config/settings";
import { SESSION_COOKIE, verifySession, type SessionPayload } from "../auth/session";
import { can, type Permission } from "../auth/roles";

const g = globalThis as unknown as { __atlasRepo?: Repository; __atlasSettings?: Settings };

export function dataSource(): "airtable" | "memory" {
  return process.env.ATLAS_DATA_SOURCE === "airtable" ? "airtable" : "memory";
}

export function getRepo(): Repository {
  if (g.__atlasRepo) return g.__atlasRepo;
  if (dataSource() === "airtable") {
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
  return verifySession(jar.get(SESSION_COOKIE)?.value, sessionSecret());
}

/** For server components: redirect to login, or to a forbidden page, when not allowed. */
export async function requirePage(perm: Permission): Promise<SessionPayload> {
  const s = await currentSession();
  if (!s) redirect("/login");
  if (!can(s.role, perm)) redirect(s.role === "customer" ? "/portal" : "/forbidden");
  return s;
}
