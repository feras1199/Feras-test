import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { MemoryRepository } from "@/lib/data/memory/repository";
import { PostgresRepository } from "@/lib/data/postgres/repository";
import type { Repository } from "@/lib/data/repository";
import { deleteRecord, planDelete, restoreDeleted } from "@/lib/server/deletion";

const owner = { uid: "u1", name: "Owner Test", role: "owner" as const, exp: 0 } as never;
const manager = { uid: "u2", name: "Manager Test", role: "manager" as const, exp: 0 } as never;
const sales = { uid: "u3", name: "Sales Test", role: "sales" as const, exp: 0 } as never;

/** A customer with an enquiry, an inspection with a measurement and a photo, an accepted estimate, a project with a paid stage, and a task. */
async function seed(repo: Repository) {
  const other = await repo.create("customers", { name: "Kept Customer" });
  const c = await repo.create("customers", { name: "Doomed Customer" });
  const enq = await repo.create("enquiries", { title: "Doomed – paving", customerIds: [c.id], status: "Site Visit Booked" });
  const insp = await repo.create("inspections", { title: "Doomed – inspection", customerIds: [c.id], enquiryIds: [enq.id], inspectionDate: "2026-11-20" });
  const m = await repo.create("measurements", { title: "Patio", inspectionIds: [insp.id], zone: "Patio" });
  const est = await repo.create("estimates", { title: "Q-2026-009 Paving", quoteNumber: "Q-2026-009", customerIds: [c.id], enquiryIds: [enq.id], status: "Accepted" });
  const line = await repo.create("estimateLines", { description: "Pavers", estimateIds: [est.id], measurementIds: [m.id] });
  const proj = await repo.create("projects", { name: "Doomed – paving", customerIds: [c.id], estimateIds: [est.id], status: "In Progress" });
  const pay = await repo.create("payments", { title: "Deposit", projectIds: [proj.id], status: "Paid", amount: 10000 });
  const task = await repo.create("tasks", { title: "Call about pavers", customerIds: [c.id] });
  // An inspection of the kept customer that also names the doomed enquiry: it stays, the link goes.
  const keptInsp = await repo.create("inspections", { title: "Kept inspection", customerIds: [other.id], enquiryIds: [enq.id] });
  return { other, c, enq, insp, m, est, line, proj, pay, task, keptInsp };
}

function suite(name: string, make: () => Promise<Repository>) {
  describe(name, () => {
    it("plans a customer delete: everything that belongs to them, and links from kept records", async () => {
      const repo = await make();
      const s = await seed(repo);
      const plan = await planDelete(repo, "customers", s.c.id);
      const ids = plan.records.map((r) => r.rec.id).sort();
      expect(ids).toEqual([s.c, s.enq, s.insp, s.m, s.est, s.line, s.proj, s.pay, s.task].map((x) => x.id).sort());
      expect(plan.unlinks).toEqual([{ entity: "inspections", id: s.keptInsp.id, field: "enquiryIds", ids: [s.enq.id] }]);
      expect(plan.money).toEqual(["1 accepted quote", "1 payment already received"]);
      expect(plan.alsoDeleted).toContain("1 site inspection");
    });

    it("needs DELETE typed when money is involved, then deletes all of it, and restore puts it all back", async () => {
      const repo = await make();
      const s = await seed(repo);
      await expect(deleteRecord(repo, owner, "customers", s.c.id, true)).rejects.toThrow(/Type DELETE/);
      expect(await repo.get("customers", s.c.id)).not.toBeNull();
      const { batch } = await deleteRecord(repo, owner, "customers", s.c.id, "DELETE");
      expect(batch.records).toHaveLength(9);
      for (const [e, r] of [["customers", s.c], ["inspections", s.insp], ["payments", s.pay], ["measurements", s.m]] as const) expect(await repo.get(e, r.id)).toBeNull();
      expect(await repo.get("customers", s.other.id)).not.toBeNull();
      expect((await repo.get("inspections", s.keptInsp.id))?.enquiryIds).toEqual([]);

      const r = await restoreDeleted(repo, owner, batch.id);
      expect(r.restored).toBe(9);
      expect(await repo.get("inspections", s.insp.id)).toMatchObject({ title: "Doomed – inspection", customerIds: [s.c.id] });
      expect(await repo.get("payments", s.pay.id)).toMatchObject({ status: "Paid", amount: 10000 });
      expect((await repo.get("inspections", s.keptInsp.id))?.enquiryIds).toEqual([s.enq.id]);
      await expect(restoreDeleted(repo, owner, batch.id)).rejects.toThrow(/Already restored/);
    });

    it("deleting an inspection takes its measurements, leaves the customer, and unlinks the estimate line", async () => {
      const repo = await make();
      const s = await seed(repo);
      const { batch } = await deleteRecord(repo, owner, "inspections", s.insp.id, true);
      expect(batch.records.map((r) => r.entity).sort()).toEqual(["inspections", "measurements"]);
      expect(await repo.get("customers", s.c.id)).not.toBeNull();
      expect((await repo.get("estimateLines", s.line.id))?.measurementIds).toEqual([]);
    });

    it("only the owner deletes main records; staff can delete small items they can edit", async () => {
      const repo = await make();
      const s = await seed(repo);
      await expect(deleteRecord(repo, manager, "customers", s.c.id, "DELETE")).rejects.toThrow(/Only the owner/);
      await expect(deleteRecord(repo, sales, "inspections", s.insp.id, true)).rejects.toThrow(/Only the owner/);
      await expect(restoreDeleted(repo, manager, "delNope")).rejects.toThrow(/Only the owner/);
      await deleteRecord(repo, sales, "measurements", s.m.id, true);
      await deleteRecord(repo, sales, "tasks", s.task.id, true);
      expect(await repo.get("tasks", s.task.id)).toBeNull();
    });
  });
}

suite("Deleting (demo store)", async () => new MemoryRepository(undefined, {}));

const url = process.env.TEST_DATABASE_URL;
const pools: Pool[] = [];
afterAll(async () => { for (const p of pools) await p.end(); });
if (url) {
  suite("Deleting (database)", async () => {
    const pool = new Pool({ connectionString: url });
    pools.push(pool);
    await pool.query("DELETE FROM atlas_records; DELETE FROM atlas_deleted").catch(() => undefined);
    return new PostgresRepository(pool);
  });
}
