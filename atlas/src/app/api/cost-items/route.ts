import { route } from "@/lib/server/api";
import { getRepo } from "@/lib/server/context";
import { audit } from "@/lib/server/audit";
import { CostItemCreate, toCostOption, toCostOptions } from "@/lib/domain/costLibrary";
import { todayIn } from "@/lib/dates";

/** The whole Cost Library for the estimate type-ahead. Internal costs, so staff with cost access only. */
export const GET = route("costs.view", async () => {
  return { items: toCostOptions(await getRepo().list("costItems")) };
});

/** Saves a new item typed into an estimate line, so it can be picked straight away next time. */
export const POST = route("estimates.edit", async ({ req, session }) => {
  const i = CostItemCreate.parse(await req.json());
  const repo = getRepo();
  const key = i.name.toLowerCase().replace(/\s+/g, " ");
  const existing = (await repo.list("costItems")).find((c) => (c.name ?? "").toLowerCase().replace(/\s+/g, " ").trim() === key);
  if (existing) return { item: toCostOption(existing), existed: true };
  const rec = await repo.create("costItems", {
    name: i.name,
    unit: i.unit,
    category: i.category,
    supplier: i.supplier,
    currentUnitCostInc: i.priceIncCents,
    active: true,
    confidence: "Needs Review",
    priceUpdatedDate: todayIn(),
    priceSource: `Added in ATLAS by ${session.name}`,
  });
  audit(session, { action: "costItem.create", entity: "costItems", recordId: rec.id, summary: `Cost Library: added "${i.name}"`, after: i });
  return { item: toCostOption(rec), existed: false };
});
