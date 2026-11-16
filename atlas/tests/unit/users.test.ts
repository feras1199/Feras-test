import { afterEach, describe, expect, it } from "vitest";
import { passwordVersion, stillAuthorised } from "@/lib/auth/users";

const H = "scrypt$16384$8$1$WDdsArAyy/zxs8GoQ9GFQQ==$2JrM3hcCwkfviQass3CUoiwsrAetNZSdkvBBfg5u6Yg=";
const set = (users: unknown[]) => (process.env.ATLAS_USERS_JSON = JSON.stringify(users));
afterEach(() => delete process.env.ATLAS_USERS_JSON);

describe("session revocation", () => {
  it("accepts a listed, active user with the same role", async () => {
    set([{ id: "u1", name: "A", email: "a@example.com", role: "manager", passwordHash: H }]);
    expect(await stillAuthorised({ uid: "u1", role: "manager", pv: passwordVersion({ passwordHash: H }) })).toBe(true);
  });
  it("ends sessions opened with an old password, and ones from before passwords were tracked", async () => {
    set([{ id: "u1", name: "A", email: "a@example.com", role: "manager", passwordHash: H }]);
    expect(await stillAuthorised({ uid: "u1", role: "manager", pv: passwordVersion({ passwordHash: "scrypt$16384$8$1$old$old" }) })).toBe(false);
    expect(await stillAuthorised({ uid: "u1", role: "manager" })).toBe(false);
  });
  it("rejects removed, deactivated or re-roled users", async () => {
    set([{ id: "u1", name: "A", email: "a@example.com", role: "worker", passwordHash: H }, { id: "u2", name: "B", email: "b@example.com", role: "owner", passwordHash: H, active: false }]);
    expect(await stillAuthorised({ uid: "u1", role: "manager" })).toBe(false);
    expect(await stillAuthorised({ uid: "u2", role: "owner" })).toBe(false);
    expect(await stillAuthorised({ uid: "u9", role: "owner" })).toBe(false);
  });
  it("rejects a customer whose linked record changed", async () => {
    set([{ id: "c1", name: "C", email: "c@example.com", role: "customer", passwordHash: H, customerId: "recNew00000000001" }]);
    expect(await stillAuthorised({ uid: "c1", role: "customer", customerId: "recOld00000000001" })).toBe(false);
  });
});

describe("owner login from host variables", () => {
  it("signs in the owner with ATLAS_OWNER_EMAIL / ATLAS_OWNER_PASSWORD, and nobody else", async () => {
    const { authenticate, loadUsers } = await import("@/lib/auth/users");
    const prev = { ...process.env };
    process.env.ATLAS_DATA_SOURCE = "postgres";
    delete process.env.ATLAS_USERS_JSON;
    process.env.ATLAS_OWNER_EMAIL = "boss@example.com";
    process.env.ATLAS_OWNER_PASSWORD = "a-long-owner-pass";
    try {
      expect(loadUsers().map((u) => u.role)).toEqual(["owner"]);
      expect((await authenticate("BOSS@example.com", "a-long-owner-pass"))?.role).toBe("owner");
      expect(await authenticate("boss@example.com", "wrong-password!!")).toBeNull();
      expect(await authenticate("owner@example.com", "atlas-demo-2026")).toBeNull();
      process.env.ATLAS_OWNER_PASSWORD = "short";
      expect(loadUsers()).toEqual([]);
    } finally {
      process.env = prev;
    }
  });
});
