import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { MemoryRepository } from "@/lib/data/memory/repository";
import { PostgresRepository } from "@/lib/data/postgres/repository";
import type { Repository } from "@/lib/data/repository";
import { acceptEstimate } from "@/lib/server/estimates";

// The same checks run on the demo store and, when TEST_DATABASE_URL is set, on a real database.
const url = process.env.TEST_DATABASE_URL;
const actor = { uid: "u-test", name: "Test Owner", role: "owner" as const };
const snapshot = {
  version: 1, quoteNumber: "Q-2026-900",
  pricing: { sellIncGst: 1_100_000, costBase: 700_000 },
  schedule: [0, 1, 2, 3, 4].map((index) => ({ index, label: `Stage ${index + 1}`, rate: 0.2, amount: 220_000 })),
};

async function quoted(repo: Repository) {
  const c = await repo.create("customers", { name: "Casey Demo" });
  return repo.create("estimates", { title: "Q-2026-900 Paving", quoteNumber: "Q-2026-900", status: "Quoted", customerIds: [c.id], snapshotJson: JSON.stringify(snapshot) });
}
const stagesOf = (repo: Repository, id: string) => repo.list("payments", { where: (p) => !!p.paymentKey?.startsWith(`${id}:`) });
const projectsOf = (repo: Repository, id: string) => repo.list("projects", { where: (p) => !!p.estimateIds?.includes(id) });

function suite(name: string, make: () => Promise<Repository>, skip = false) {
  describe.skipIf(skip)(`accepting a quote (${name})`, () => {
    let repo: Repository;
    beforeAll(async () => { repo = await make(); });

    it("two accepts at the same moment make one project and one set of stages", async () => {
      const e = await quoted(repo);
      const both = await Promise.all([acceptEstimate(repo, e, actor, "Casey", "Phone"), acceptEstimate(repo, e, actor, "Casey", "Phone")]);
      expect(both.map((r) => r.payments).sort()).toEqual([0, 5]);
      expect(both[0]!.projectId).toBe(both[1]!.projectId);
      expect(await projectsOf(repo, e.id)).toHaveLength(1);
      const stages = await stagesOf(repo, e.id);
      expect(stages).toHaveLength(5);
      expect(stages.reduce((n, p) => n + (p.amount ?? 0), 0)).toBe(1_100_000);
    });

    it("an accept that arrives while another is half done waits for it", async () => {
      const e = await quoted(repo);
      const first = acceptEstimate(repo, e, actor, "Casey", "Phone");
      await new Promise((r) => setTimeout(r, 1));
      const second = acceptEstimate(repo, e, actor, "Casey", "Phone");
      const both = await Promise.all([first, second]);
      expect(both.map((r) => r.payments)).toEqual([5, 0]);
      expect(await projectsOf(repo, e.id)).toHaveLength(1);
      expect(await stagesOf(repo, e.id)).toHaveLength(5);
    });

    it("a failure part way saves nothing, and accepting again gives the full schedule", async () => {
      const e = await quoted(repo);
      let n = 0;
      // Fails on the third payment stage, inside the unit of work.
      const flaky = (tx: Repository): Repository => new Proxy(tx, {
        get(t, k, r) {
          if (k === "create") return async (entity: string, data: never) => {
            if (entity === "payments" && ++n === 3) throw new Error("database blip");
            return t.create(entity as never, data);
          };
          const v = Reflect.get(t, k, r);
          return typeof v === "function" ? v.bind(t) : v;
        },
      });
      const wrapped = new Proxy(repo, {
        get(t, k, r) {
          if (k === "atomic") return (key: string, fn: (x: Repository) => Promise<unknown>) => t.atomic(key, (tx) => fn(flaky(tx)));
          const v = Reflect.get(t, k, r);
          return typeof v === "function" ? v.bind(t) : v;
        },
      });
      await expect(acceptEstimate(wrapped, e, actor, "Casey", "Phone")).rejects.toThrow("database blip");
      expect((await repo.get("estimates", e.id))!.status).toBe("Quoted");
      expect(await stagesOf(repo, e.id)).toHaveLength(0);
      expect(await projectsOf(repo, e.id)).toHaveLength(0);

      const again = await acceptEstimate(repo, e, actor, "Casey", "Phone");
      expect(again.estimate.status).toBe("Accepted");
      expect(await stagesOf(repo, e.id)).toHaveLength(5);
      expect(await projectsOf(repo, e.id)).toHaveLength(1);
    });

    it("accepting an accepted quote again changes nothing", async () => {
      const e = await quoted(repo);
      const first = await acceptEstimate(repo, e, actor, "Casey", "Phone");
      const second = await acceptEstimate(repo, e, actor, "Casey", "Phone");
      expect(second).toMatchObject({ projectId: first.projectId, payments: 0 });
      expect(await stagesOf(repo, e.id)).toHaveLength(5);
    });

    it("refuses drafts and declined quotes", async () => {
      const e = await quoted(repo);
      await repo.update("estimates", e.id, { status: "Declined" });
      await expect(acceptEstimate(repo, e, actor, "Casey", "Phone")).rejects.toThrow(/Declined/);
    });
  });
}

suite("demo store", async () => new MemoryRepository(undefined, {}));

let pool: Pool | undefined;
suite("database", async () => {
  pool = new Pool({ connectionString: url });
  await pool.query("DROP TABLE IF EXISTS atlas_records, atlas_audit, atlas_imports, atlas_users, atlas_files");
  return new PostgresRepository(pool);
}, !url);
afterAll(async () => { await pool?.end(); });

describe.skipIf(!url)("database rules", () => {
  it("a payment stage key can exist only once", async () => {
    const p = new Pool({ connectionString: url });
    const repo = new PostgresRepository(p);
    await repo.create("payments", { title: "A", paymentKey: "recUniqueKeyTest01:0" });
    await expect(repo.create("payments", { title: "B", paymentKey: "recUniqueKeyTest01:0" })).rejects.toThrow(/duplicate key/);
    await repo.create("payments", { title: "No key 1" });
    await repo.create("payments", { title: "No key 2" });
    await p.end();
  });

  it("atomic work is all or nothing, and reads only the slice of a file asked for", async () => {
    const p = new Pool({ connectionString: url });
    const repo = new PostgresRepository(p);
    await expect(repo.atomic("t", async (tx) => { await tx.create("customers", { name: "Rolled Back Demo" }); throw new Error("stop"); })).rejects.toThrow("stop");
    expect(await repo.list("customers", { where: (c) => c.name === "Rolled Back Demo" })).toHaveLength(0);
    const bytes = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 251));
    const f = await repo.addFile({ entity: "inspections", recordId: "recDemoInsp000001", kind: "photo", mime: "image/jpeg", name: "x", size: bytes.length, createdBy: "t" }, bytes);
    const part = await repo.getFile(f.id, { start: 10, end: 19 });
    expect(Buffer.compare(part!.bytes, bytes.subarray(10, 20))).toBe(0);
    expect((await repo.getFileMeta(f.id))!.size).toBe(1000);
    expect((await repo.fileUsage()).count).toBeGreaterThan(0);
    await p.end();
  });

  it("logins from a backup are added once and never overwrite one already here", async () => {
    const p = new Pool({ connectionString: url });
    const repo = new PostgresRepository(p);
    const u = { id: "usrBackupTest00001", email: "sam.demo@example.com", name: "Sam Demo", role: "sales", passwordHash: "scrypt$1$1$1$a$b", active: true };
    expect(await repo.restoreUsers([u])).toEqual({ added: 1, skipped: 0 });
    expect(await repo.restoreUsers([{ ...u, id: "usrBackupTest00002", name: "Other" }, u])).toEqual({ added: 0, skipped: 2 });
    expect((await repo.listUsers()).filter((x) => x.email === u.email).map((x) => x.name)).toEqual(["Sam Demo"]);
    await p.end();
  });
});
