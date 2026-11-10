import "server-only";
import { z } from "zod";
import { ROLES } from "./roles";
import { createHash, timingSafeEqual } from "node:crypto";
import { verifyPassword } from "./password";

const UserSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  email: z.string().email(),
  role: z.enum(ROLES),
  passwordHash: z.string().startsWith("scrypt$"),
  customerId: z.string().optional(),
  active: z.boolean().default(true),
});
export type AtlasUser = z.infer<typeof UserSchema>;

/** Logins kept in ATLAS's own database, added and managed from Settings > People. */
export interface UserStore {
  list(): Promise<AtlasUser[]>;
}
const g = globalThis as unknown as { __atlasUserStore?: UserStore };
export function setUserStore(store: UserStore | undefined) {
  g.__atlasUserStore = store;
}
export function hasUserStore() {
  return !!g.__atlasUserStore;
}

/** Where each login comes from: host variables can't be edited in the app. */
export type UserSource = "host" | "database" | "demo";

/**
 * Everyone who can sign in: the owner from host variables, ATLAS_USERS_JSON,
 * then people added in the app. An email set on the host wins over the same
 * email in the database.
 */
export async function allUsers(): Promise<(AtlasUser & { source: UserSource })[]> {
  const base = loadUsers().map((u) => ({ ...u, source: (demoLoginsEnabled() && !process.env.ATLAS_USERS_JSON && u.passwordHash === DEMO_HASH ? "demo" : "host") as UserSource }));
  const store = g.__atlasUserStore;
  if (!store) return base;
  const taken = new Set(base.map((u) => u.email.toLowerCase()));
  const ids = new Set(base.map((u) => u.id));
  const db = (await store.list()).filter((u) => !taken.has(u.email.toLowerCase()) && !ids.has(u.id));
  return [...base, ...db.map((u) => ({ ...u, source: "database" as const }))];
}

/**
 * Users come from ATLAS_USERS_JSON until the additive "Atlas Users" table is
 * approved in Airtable. Demo users exist only in memory mode outside production.
 */
let parsed: { raw: string; users: AtlasUser[] } | null = null;
export function loadUsers(): AtlasUser[] {
  const raw = process.env.ATLAS_USERS_JSON;
  const owner = envOwner();
  if (raw) {
    if (parsed?.raw !== raw) parsed = { raw, users: z.array(UserSchema).parse(JSON.parse(raw)) };
    return owner && !parsed.users.some((u) => u.email.toLowerCase() === owner.email.toLowerCase()) ? [owner, ...parsed.users] : parsed.users;
  }
  if (owner) return [owner];
  if (demoLoginsEnabled()) return DEMO_USERS;
  return [];
}

/**
 * The owner's first login, set as two secret variables on the host
 * (ATLAS_OWNER_EMAIL and ATLAS_OWNER_PASSWORD) so it can be done from a phone
 * without making a password hash. Other people go in ATLAS_USERS_JSON.
 */
const ENV_OWNER_MARK = "env$owner";
function envOwner(): AtlasUser | null {
  const email = process.env.ATLAS_OWNER_EMAIL?.trim();
  const pw = process.env.ATLAS_OWNER_PASSWORD;
  if (!email || !pw) return null;
  if (pw.length < 12) {
    console.error(JSON.stringify({ type: "atlas.config", error: "ATLAS_OWNER_PASSWORD must be at least 12 characters; owner login disabled" }));
    return null;
  }
  return { id: "u-owner-env", name: process.env.ATLAS_OWNER_NAME?.trim() || "Owner", email, role: "owner", passwordHash: ENV_OWNER_MARK, active: true };
}

function sameSecret(a: string, b: string) {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function demoLoginsEnabled() {
  return (process.env.ATLAS_DATA_SOURCE ?? "memory") === "memory" && (process.env.NODE_ENV !== "production" || process.env.ATLAS_ALLOW_DEMO_LOGINS === "1");
}

// Password for every demo user: "atlas-demo-2026" (hash precomputed with scripts/hash-password.mjs).
const DEMO_HASH = "scrypt$16384$8$1$WDdsArAyy/zxs8GoQ9GFQQ==$2JrM3hcCwkfviQass3CUoiwsrAetNZSdkvBBfg5u6Yg=";
export const DEMO_PASSWORD = "atlas-demo-2026";
const DEMO_USERS: AtlasUser[] = [
  { id: "u-owner", name: "Demo Owner", email: "owner@example.com", role: "owner", passwordHash: DEMO_HASH, active: true },
  { id: "u-manager", name: "Demo Manager", email: "manager@example.com", role: "manager", passwordHash: DEMO_HASH, active: true },
  { id: "u-sales", name: "Demo Estimator", email: "sales@example.com", role: "sales", passwordHash: DEMO_HASH, active: true },
  { id: "u-super", name: "Demo Supervisor", email: "supervisor@example.com", role: "supervisor", passwordHash: DEMO_HASH, active: true },
  { id: "u-worker", name: "Demo Worker", email: "worker@example.com", role: "worker", passwordHash: DEMO_HASH, active: true },
  { id: "u-customer", name: "Taylor Demo", email: "taylor.demo@example.com", role: "customer", passwordHash: DEMO_HASH, customerId: "recDemoCust000003", active: true },
];

export async function authenticate(email: string, password: string): Promise<AtlasUser | null> {
  const u = (await allUsers()).find((x) => x.active && x.email.toLowerCase() === email.trim().toLowerCase());
  // Always run a hash comparison so response time doesn't reveal whether the email exists.
  if (u?.passwordHash === ENV_OWNER_MARK) {
    await verifyPassword(password, DEMO_HASH); // keep timing similar
    return sameSecret(password, process.env.ATLAS_OWNER_PASSWORD ?? "") ? u : null;
  }
  const ok = await verifyPassword(password, u?.passwordHash ?? DEMO_HASH);
  return u && ok ? u : null;
}

/**
 * A signed cookie stays valid until it expires, so each request also checks the
 * user is still listed, active, and has the same role and customer link.
 * Removing or deactivating someone signs them out on their next click.
 */
export async function stillAuthorised(p: { uid: string; role: string; customerId?: string; pv?: string }) {
  const u = (await allUsers()).find((x) => x.id === p.uid);
  return !!u && u.active && u.role === p.role && (u.customerId ?? undefined) === (p.customerId ?? undefined) && p.pv === passwordVersion(u);
}

/**
 * A short fingerprint of a login's current password, kept in the session. When
 * the password is changed or reset the fingerprint no longer matches, so every
 * session opened with the old password stops working on its next click.
 */
export function passwordVersion(u: Pick<AtlasUser, "passwordHash">): string {
  const basis = u.passwordHash === ENV_OWNER_MARK ? `env:${process.env.ATLAS_OWNER_PASSWORD ?? ""}` : u.passwordHash;
  return createHash("sha256").update(basis).digest("hex").slice(0, 16);
}
