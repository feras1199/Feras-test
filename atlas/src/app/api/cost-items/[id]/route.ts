import { HttpError, route } from "@/lib/server/api";
import { getRepo } from "@/lib/server/context";
import { audit } from "@/lib/server/audit";
import { CostItemUpdate, toCostOption } from "@/lib/domain/costLibrary";
import { formatAud } from "@/lib/finance/money";
import { todayIn } from "@/lib/dates";

/** Change a Cost Library item. A price change is also written to the price history. Items are switched off, never deleted. */
export const PATCH = route<{ id: string }>("costs.manage", async ({ req, params, session }) => {
  const u = CostItemUpdate.parse(await req.json());
  const repo = getRepo();
  const before = await repo.get("costItems", params.id);
  if (!before) throw new HttpError(404, "That item isn't in the Cost Library");
  const oldPrice = toCostOption(before)?.priceIncCents ?? null;
  const today = todayIn();
  const priceChanged = u.priceIncCents !== undefined && u.priceIncCents !== oldPrice;
  const { priceIncCents, ...rest } = u;
  const after = await repo.update("costItems", params.id, {
    ...rest,
    ...(priceChanged ? { currentUnitCostInc: priceIncCents, priceUpdatedDate: today, priceSource: `Updated in ATLAS by ${session.name}`, needsPriceUpdate: false } : {}),
  });
  if (priceChanged && priceIncCents !== null && priceIncCents !== undefined) {
    await repo.create("priceHistory", { title: `${after.name} ${today}`, costItemIds: [after.id], supplier: after.supplier ?? "", unitCostInc: priceIncCents, effectiveDate: today, source: `ATLAS, ${session.name}` });
  }
  const changes = [
    priceChanged ? `price ${oldPrice === null ? "none" : formatAud(oldPrice)} → ${priceIncCents === null || priceIncCents === undefined ? "none" : formatAud(priceIncCents)}` : "",
    u.active === false && before.active !== false ? "switched off" : u.active === true && before.active !== true ? "switched on" : "",
    ...Object.keys(rest).filter((k) => k !== "active" && (rest as Record<string, unknown>)[k] !== (before as Record<string, unknown>)[k]),
  ].filter(Boolean);
  audit(session, { action: "costItem.update", entity: "costItems", recordId: after.id, summary: `Cost Library: ${after.name}${changes.length ? `: ${changes.join(", ")}` : " (no change)"}`, before: { price: oldPrice, active: before.active }, after: u });
  return { item: toCostOption(after) };
});
