import { describe, expect, it, vi } from "vitest";
import { decodeRecord, encodeFields, fieldMeta, tableId } from "@/lib/data/mapper";
import { MemoryRepository } from "@/lib/data/memory/repository";
import { AirtableRepository } from "@/lib/data/airtable/client";

describe("mapper", () => {
  it("converts currency to cents and back by field id", () => {
    const amount = fieldMeta("payments", "amount");
    const rec = decodeRecord("payments", { id: "recX", fields: { [amount.id]: 1155.5 } });
    expect(rec.amount).toBe(115550);
    expect(encodeFields("payments", { amount: 115550 })).toEqual({ [amount.id]: 1155.5 });
  });
  it("refuses to write calculated fields", () => {
    expect(() => encodeFields("estimateLines", { lineCost: 5 } as never)).toThrow(/calculated/);
  });
  it("refuses non-integer cents", () => {
    expect(() => encodeFields("payments", { amount: 10.5 })).toThrow(/integer cents/);
  });
  it("treats Airtable formula errors as empty", () => {
    const f = fieldMeta("estimateLines", "lineCost");
    expect(decodeRecord("estimateLines", { id: "recX", fields: { [f.id]: { specialValue: "NaN" } } }).lineCost).toBeNull();
  });
  it("defaults empty links and checkboxes", () => {
    const r = decodeRecord("projects", { id: "recX", fields: {} });
    expect(r.customerIds).toEqual([]);
    expect(r.readyForHandover).toBe(false);
  });
});

describe("memory repository", () => {
  it("creates, updates and isolates copies", async () => {
    const repo = new MemoryRepository(undefined, {});
    const c = await repo.create("customers", { name: "Test Demo", email: "t@example.com" });
    expect(c.id).toMatch(/^rec[A-Za-z0-9]{14}$/);
    c.name = "mutated";
    expect((await repo.get("customers", c.id))?.name).toBe("Test Demo");
    await repo.update("customers", c.id, { suburb: "Kellyville" });
    expect((await repo.list("customers", { where: (r) => r.suburb === "Kellyville" })).length).toBe(1);
  });
  it("rejects calculated fields like Airtable does", async () => {
    const repo = new MemoryRepository(undefined, {});
    await expect(repo.create("components", { label: "x" } as never)).rejects.toThrow(/calculated/);
  });
});

describe("airtable repository", () => {
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
  it("paginates and retries on 429", async () => {
    const calls: string[] = [];
    const responses = [
      new Response("{}", { status: 429 }),
      ok({ records: [{ id: "recAAAAAAAAAAAAAA", createdTime: "", fields: {} }], offset: "p2" }),
      ok({ records: [{ id: "recBBBBBBBBBBBBBB", createdTime: "", fields: {} }] }),
    ];
    const fetchMock = vi.fn(async (url: string) => {
      calls.push(url);
      return responses.shift()!;
    });
    vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 50 });
    const repo = new AirtableRepository("pat", "appTEST", fetchMock as unknown as typeof fetch);
    const p = repo.list("customers");
    await vi.runAllTimersAsync();
    const rows = await p;
    vi.useRealTimers();
    expect(rows.map((r) => r.id)).toEqual(["recAAAAAAAAAAAAAA", "recBBBBBBBBBBBBBB"]);
    expect(calls.length).toBe(3);
    expect(calls[0]).toContain(tableId("customers"));
    expect(calls[0]).toContain("returnFieldsByFieldId=true");
    expect(calls[2]).toContain("offset=p2");
  });
  it("sends writes by field id with typecast off", async () => {
    let body: { records: { fields: Record<string, unknown> }[]; typecast: boolean } | undefined;
    const fetchMock = vi.fn(async (_u: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return ok({ records: [{ id: "recCCCCCCCCCCCCCC", createdTime: "", fields: {} }] });
    });
    const repo = new AirtableRepository("pat", "appTEST", fetchMock as unknown as typeof fetch);
    await repo.create("customers", { name: "Demo" });
    expect(body!.typecast).toBe(false);
    expect(body!.records[0]!.fields).toEqual({ [fieldMeta("customers", "name").id]: "Demo" });
  });
});
