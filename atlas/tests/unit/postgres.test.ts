import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { PostgresRepository } from "@/lib/data/postgres/repository";
import { pullLibrariesFromAirtable } from "@/lib/server/airtablePull";
import { tableId } from "@/lib/data/mapper";

// Runs against a real database only when TEST_DATABASE_URL is set (it drops and recreates the ATLAS tables there).
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("PostgresRepository", () => {
  let pool: Pool;
  let repo: PostgresRepository;
  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    await pool.query("DROP TABLE IF EXISTS atlas_records, atlas_audit, atlas_imports, atlas_users, atlas_files");
    repo = new PostgresRepository(pool);
  });
  afterAll(async () => { await pool.end(); });

  it("creates, reads, lists and merges updates", async () => {
    const c = await repo.create("customers", { name: "Casey Demo", suburb: "Kellyville", doNotContact: false });
    expect(c.id).toMatch(/^rec[A-Za-z0-9]{14}$/);
    expect(await repo.get("customers", c.id)).toMatchObject({ name: "Casey Demo", suburb: "Kellyville" });
    await Promise.all([repo.update("customers", c.id, { phone: "0491 570 010" }), repo.update("customers", c.id, { email: "casey.demo@example.com" })]);
    expect(await repo.get("customers", c.id)).toMatchObject({ name: "Casey Demo", phone: "0491 570 010", email: "casey.demo@example.com" });
    const list = await repo.list("customers", { where: (x) => x.suburb === "Kellyville" });
    expect(list.map((x) => x.id)).toEqual([c.id]);
    expect(await repo.get("customers", "recNope0000000000")).toBeNull();
  });

  it("applies the same write rules as the other stores", async () => {
    await expect(repo.create("costItems", { effectiveUnitCostInc: 5 } as never)).rejects.toThrow(/calculated/);
    await expect(repo.create("costItems", { currentUnitCostInc: 1.5 })).rejects.toThrow(/integer cents/);
    await expect(repo.update("customers", "recNope0000000000", { name: "X" })).rejects.toThrow(/not found/);
  });

  it("imports keep ids, are re-runnable, and 'add-new' never overwrites ATLAS edits", async () => {
    const recs = [
      { id: "recDemoImpCost0001", createdTime: "2025-05-01T00:00:00.000Z", name: "Demo pavers", currentUnitCostInc: 5000, effectiveUnitCostInc: 50 },
      { id: "recDemoImpCost0002", createdTime: "2025-05-02T00:00:00.000Z", name: "Demo sand", currentUnitCostInc: 7000 },
    ] as never[];
    const r1 = await repo.importRecords([{ entity: "costItems", records: recs }], "add-new", { by: "test", source: "test" });
    expect(r1).toEqual([{ entity: "costItems", added: 2, replaced: 0, skipped: 0 }]);
    const got = await repo.get("costItems", "recDemoImpCost0001");
    expect(got).toMatchObject({ name: "Demo pavers", createdTime: "2025-05-01T00:00:00.000Z", effectiveUnitCostInc: 50 });
    await repo.update("costItems", "recDemoImpCost0001", { currentUnitCostInc: 5500 });
    const r2 = await repo.importRecords([{ entity: "costItems", records: recs }], "add-new", { by: "test", source: "test" });
    expect(r2[0]).toMatchObject({ added: 0, skipped: 2 });
    expect((await repo.get("costItems", "recDemoImpCost0001"))!.currentUnitCostInc).toBe(5500);
    const r3 = await repo.importRecords([{ entity: "costItems", records: recs }], "replace", { by: "test", source: "test" });
    expect(r3[0]).toMatchObject({ added: 0, replaced: 2 });
    expect((await repo.get("costItems", "recDemoImpCost0001"))!.currentUnitCostInc).toBe(5000);
  });

  it("rolls the whole import back if any record fails", async () => {
    const before = (await repo.list("costItems")).length;
    await expect(repo.importRecords([{ entity: "costItems", records: [{ id: "recDemoImpCost0009", name: "ok" }, { id: "recDemoImpCost0010", createdTime: "2025-01-01", name: "\u0000bad" }] as never[] }], "add-new", { by: "t", source: "t" })).rejects.toThrow();
    expect((await repo.list("costItems")).length).toBe(before);
  });

  it("stores and reads the audit trail newest first", async () => {
    await repo.writeAudit({ at: "2026-01-01T00:00:00.000Z", summary: "first" } as never);
    await repo.writeAudit({ at: "2026-01-02T00:00:00.000Z", summary: "second" } as never);
    const rows = await repo.readAudit<{ summary: string }>(5);
    expect(rows.map((r) => r.summary)).toEqual(["second", "first"]);
  });

  it("stores logins with unique emails (any case) and updates them", async () => {
    const u = await repo.createUser({ email: "Jo.Demo@example.com", name: "Jo Demo", role: "worker", passwordHash: "scrypt$x" });
    expect(u).toMatchObject({ role: "worker", active: true });
    await expect(repo.createUser({ email: "jo.demo@EXAMPLE.com", name: "Other", role: "worker", passwordHash: "scrypt$y" })).rejects.toThrow("email taken");
    const up = await repo.updateUser(u.id, { role: "supervisor", active: false });
    expect(up).toMatchObject({ role: "supervisor", active: false, passwordHash: "scrypt$x" });
    const c = await repo.updateUser(u.id, { role: "customer", customerId: "recDemoCust000001" });
    expect(c!.customerId).toBe("recDemoCust000001");
    expect(await repo.updateUser("usrNope", { name: "X" })).toBeNull();
    expect((await repo.listUsers()).map((x) => x.email)).toEqual(["Jo.Demo@example.com"]);
  });

  it("keeps photos and voice notes, and archives instead of deleting", async () => {
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    const f = await repo.addFile({ entity: "inspections", recordId: "recDemoInsp000001", kind: "photo", mime: "image/jpeg", name: "Photo", size: bytes.length, createdBy: "Test" }, bytes);
    expect(f.id).toMatch(/^fil/);
    const got = await repo.getFile(f.id);
    expect(Buffer.compare(got!.bytes, bytes)).toBe(0);
    expect(got!.meta).toMatchObject({ kind: "photo", recordId: "recDemoInsp000001", archived: false });
    expect((await repo.setFileArchived(f.id, true))!.archived).toBe(true);
    expect((await repo.listFiles("inspections", "recDemoInsp000001")).map((x) => x.archived)).toEqual([true]);
    expect(await repo.getFile("filNope")).toBeNull();
  });

  it("pulls the price lists straight from Airtable, read only, and re-running adds nothing twice", async () => {
    const methods: string[] = [];
    const page = (id: string) => ({ records: [{ id, createdTime: "2025-01-01T00:00:00.000Z", fields: {} }] });
    const fake = (async (url: string, init?: RequestInit) => {
      methods.push(init?.method ?? "GET");
      const body = url.includes(tableId("costItems")) ? page("recDemoPullCost001") : url.includes(tableId("productivity")) ? page("recDemoPullProd001") : page("recDemoPullOmit001");
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;
    const r1 = await pullLibrariesFromAirtable(repo, { token: "patTEST", by: "test", fetchImpl: fake });
    expect(r1.map((r) => [r.entity, r.added])).toEqual([["costItems", 1], ["productivity", 1], ["omissionRules", 1]]);
    const r2 = await pullLibrariesFromAirtable(repo, { token: "patTEST", by: "test", fetchImpl: fake });
    expect(r2.every((r) => r.added === 0 && r.skipped === 1)).toBe(true);
    expect(new Set(methods)).toEqual(new Set(["GET"]));
    const denied = (async () => new Response(JSON.stringify({ error: { type: "INVALID_PERMISSIONS_OR_MODEL_NOT_FOUND" } }), { status: 403 })) as unknown as typeof fetch;
    await expect(pullLibrariesFromAirtable(repo, { token: "patTEST", by: "test", fetchImpl: denied })).rejects.toThrow(/data.records:read/);
  });
});
