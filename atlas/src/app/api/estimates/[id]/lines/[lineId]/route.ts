import { route, HttpError } from "@/lib/server/api";
import { getRepo } from "@/lib/server/context";
import { audit } from "@/lib/server/audit";
import { LineInput, lineFields } from "@/lib/domain/estimates";
import { assertEditable, loadEstimate } from "@/lib/server/estimates";

async function load(id: string, lineId: string) {
  const repo = getRepo();
  const ctx = await loadEstimate(repo, id);
  assertEditable(ctx.estimate);
  const line = await repo.get("estimateLines", lineId);
  if (!line || !line.estimateIds?.includes(id)) throw new HttpError(404, "Line not found on this estimate");
  return { repo, ...ctx, line };
}

export const PATCH = route<{ id: string; lineId: string }>("estimates.edit", async ({ req, params, session }) => {
  const { repo, estimate, settings, line } = await load(params.id, params.lineId);
  const i = LineInput.parse(await req.json());
  const after = await repo.update("estimateLines", line.id, lineFields(i, settings.pricing.gstRate));
  audit(session, { action: "estimate.line.update", entity: "estimateLines", recordId: line.id, summary: `${estimate.title}: changed "${i.description}"`, before: { quantity: line.quantity, unitCostSnapshot: line.unitCostSnapshot, costType: line.costType }, after: i });
  return { line: after };
});

/** Removing a line marks it excluded (kept for history), it is not deleted. */
export const DELETE = route<{ id: string; lineId: string }>("estimates.edit", async ({ params, session }) => {
  const { repo, estimate, line } = await load(params.id, params.lineId);
  await repo.update("estimateLines", line.id, { included: false });
  audit(session, { action: "estimate.line.remove", entity: "estimateLines", recordId: line.id, summary: `${estimate.title}: removed "${line.description}"` });
  return { ok: true };
});
