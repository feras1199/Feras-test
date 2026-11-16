import { describe, expect, it } from "vitest";
import { MemoryRepository } from "@/lib/data/memory/repository";
import { buildFixtures } from "@/lib/data/memory/fixtures";
import { buildToday } from "@/lib/domain/today";

const now = new Date("2026-11-02T00:00:00Z");
const today = "2026-11-02";

describe("Today screen", () => {
  it("lists overdue follow-ups, tasks and payments from records", async () => {
    const repo = new MemoryRepository(undefined, buildFixtures(now));
    const t = await buildToday(repo, "owner", today);
    const kinds = t.items.map((i) => i.kind);
    expect(kinds).toContain("follow-up"); // Sam & Jo, follow-up yesterday
    expect(kinds).toContain("enquiry"); // Jordan, new
    expect(kinds).toContain("payment");
    expect(t.items[0]!.overdue).toBe(true);
    expect(t.money?.overdueCents).toBe(1_155_000);
    expect(t.counts.activeProjects).toBe(1);
  });
  it("hides money from workers", async () => {
    const repo = new MemoryRepository(undefined, buildFixtures(now));
    const t = await buildToday(repo, "worker", today);
    expect(t.money).toBeNull();
    expect(t.items.some((i) => i.kind === "payment" || i.kind === "enquiry")).toBe(false);
  });
});
