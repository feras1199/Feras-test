import { route } from "@/lib/server/api";
import { getRepo } from "@/lib/server/context";
import { audit } from "@/lib/server/audit";
import { LineInput, lineFields } from "@/lib/domain/estimates";
import { assertEditable, loadEstimate } from "@/lib/server/estimates";

export const POST = route<{ id: string }>("estimates.edit", async ({ req, params, session }) => {
  const repo = getRepo();
  const { estimate, settings } = await loadEstimate(repo, params.id);
  assertEditable(estimate);
  const i = LineInput.parse(await req.json());
  const line = await repo.create("estimateLines", { ...lineFields(i, settings.pricing.gstRate), estimateIds: [estimate.id], componentIds: [] });
  if (estimate.quoteReviewStatus === "Needs Estimating") await repo.update("estimates", estimate.id, { quoteReviewStatus: "Needs Review" });
  audit(session, { action: "estimate.line.add", entity: "estimateLines", recordId: line.id, summary: `${estimate.title}: added ${i.costType.toLowerCase()} "${i.description}"`, after: i });
  return { line };
});
