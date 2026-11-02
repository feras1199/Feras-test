import { afterEach, describe, expect, it } from "vitest";
import { stillAuthorised } from "@/lib/auth/users";

const H = "scrypt$16384$8$1$WDdsArAyy/zxs8GoQ9GFQQ==$2JrM3hcCwkfviQass3CUoiwsrAetNZSdkvBBfg5u6Yg=";
const set = (users: unknown[]) => (process.env.ATLAS_USERS_JSON = JSON.stringify(users));
afterEach(() => delete process.env.ATLAS_USERS_JSON);

describe("session revocation", () => {
  it("accepts a listed, active user with the same role", () => {
    set([{ id: "u1", name: "A", email: "a@example.com", role: "manager", passwordHash: H }]);
    expect(stillAuthorised({ uid: "u1", role: "manager" })).toBe(true);
  });
  it("rejects removed, deactivated or re-roled users", () => {
    set([{ id: "u1", name: "A", email: "a@example.com", role: "worker", passwordHash: H }, { id: "u2", name: "B", email: "b@example.com", role: "owner", passwordHash: H, active: false }]);
    expect(stillAuthorised({ uid: "u1", role: "manager" })).toBe(false);
    expect(stillAuthorised({ uid: "u2", role: "owner" })).toBe(false);
    expect(stillAuthorised({ uid: "u9", role: "owner" })).toBe(false);
  });
  it("rejects a customer whose linked record changed", () => {
    set([{ id: "c1", name: "C", email: "c@example.com", role: "customer", passwordHash: H, customerId: "recNew00000000001" }]);
    expect(stillAuthorised({ uid: "c1", role: "customer", customerId: "recOld00000000001" })).toBe(false);
  });
});
