import { route, HttpError } from "@/lib/server/api";
import { getRepo } from "@/lib/server/context";
import { audit } from "@/lib/server/audit";
import { lineFields } from "@/lib/domain/estimates";
import { AiLinesInput, aiLineToInput } from "@/lib/domain/aiFill";
import { toCostOption } from "@/lib/domain/costLibrary";
import { assertEditable, loadEstimate } from "@/lib/server/estimates";

/**
 * Adds the lines Ask ATLAS suggested, after the person pressed Confirm. Prices come
 * from the Cost Library at this moment, every line is marked "AI suggested" with its
 * quantity unchecked, existing lines are never touched, and the scope is only written if empty.
 */
export const POST = route<{ id: string }>("estimates.edit", async ({ req, params, session }) => {
  const repo = getRepo();
  const { estimate, settings } = await loadEstimate(repo, params.id);
  assertEditable(estimate);
  const input = AiLinesInput.parse(await req.json());
  // Check everything first so a bad line doesn't leave half the suggestion saved.
  const prepared = await Promise.all(
    input.lines.map(async (l) => {
      const raw = l.costItemId ? await repo.get("costItems", l.costItemId) : null;
      const item = raw ? toCostOption(raw) : null;
      if (l.costItemId && !item) throw new HttpError(409, `"${l.description}" points to a Cost Library item that no longer exists. Ask ATLAS again.`);
      return aiLineToInput(l, item);
    }),
  );
  const created = [];
  for (const i of prepared) {
    created.push(await repo.create("estimateLines", { ...lineFields(i, settings.pricing.gstRate), aiSuggested: true, measurementIds: [], estimateIds: [estimate.id], componentIds: [] }));
  }
  const scopeWritten = !!input.customerScope && !estimate.customerScope?.trim();
  const patch: Record<string, unknown> = {};
  if (scopeWritten) patch.customerScope = input.customerScope;
  if (estimate.quoteReviewStatus === "Needs Estimating") patch.quoteReviewStatus = "Needs Review";
  if (Object.keys(patch).length) await repo.update("estimates", estimate.id, patch as never);
  audit(session, { action: "estimate.ai_lines", entity: "estimates", recordId: estimate.id, summary: `${estimate.title}: added ${created.length} AI-suggested line(s) from Ask ATLAS${scopeWritten ? " and wrote the customer scope" : ""}`, after: { lines: prepared.map((p) => ({ description: p.description, quantity: p.quantity, unit: p.unit, costItemId: p.costItemId ?? null })) } });
  return { added: created.length, scopeWritten, scopeKept: !!input.customerScope && !scopeWritten };
});
