import "server-only";
import { z } from "zod";
import { ROLES } from "./roles";
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

/**
 * Users come from ATLAS_USERS_JSON until the additive "Atlas Users" table is
 * approved in Airtable. Demo users exist only in memory mode outside production.
 */
export function loadUsers(): AtlasUser[] {
  const raw = process.env.ATLAS_USERS_JSON;
  if (raw) return z.array(UserSchema).parse(JSON.parse(raw));
  if (demoLoginsEnabled()) return DEMO_USERS;
  return [];
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
  const u = loadUsers().find((x) => x.active && x.email.toLowerCase() === email.trim().toLowerCase());
  // Always run a hash comparison so response time doesn't reveal whether the email exists.
  const ok = await verifyPassword(password, u?.passwordHash ?? DEMO_HASH);
  return u && ok ? u : null;
}
