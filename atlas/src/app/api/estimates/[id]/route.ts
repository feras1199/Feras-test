import { route } from "@/lib/server/api";
import { getRepo } from "@/lib/server/context";
import { audit } from "@/lib/server/audit";
import { EstimateUpdate, scheduleToFields } from "@/lib/domain/estimates";
import { assertEditable, loadEstimate } from "@/lib/server/estimates";
import { validateSchedule } from "@/lib/finance/payments";
import { can } from "@/lib/auth/roles";
import { HttpError } from "@/lib/server/api";
import type { Rec } from "@/lib/data/entities";

export const GET = route<{ id: string }>("estimates.view", async ({ params }) => {
  const { estimate, lines, summary } = await loadEstimate(getRepo(), params.id);
  return { estimate, lines, summary };
});

export const PATCH = route<{ id: string }>("estimates.edit", async ({ req, params, session }) => {
  const repo = getRepo();
  const { estimate } = await loadEstimate(repo, params.id);
  const i = EstimateUpdate.parse(await req.json());
  const onlyNotes = Object.keys(i).every((k) => k === "internalReviewNotes");
  if (!onlyNotes) assertEditable(estimate);
  if ((i.managerOverride !== undefined || i.markupOverride !== undefined) && !can(session.role, "estimates.approve")) {
    throw new HttpError(403, "Only a manager or owner can change markup or override the price");
  }
  const { schedule, ...rest } = i;
  const patch: Partial<Rec<"estimates">> = { ...rest };
  if (schedule) {
    const errs = validateSchedule(schedule);
    if (errs.length) throw new HttpError(400, errs.join("; "));
    Object.assign(patch, scheduleToFields(schedule));
  }
  const after = await repo.update("estimates", params.id, patch);
  const keys = Object.keys(i);
  audit(session, { action: "estimate.update", entity: "estimates", recordId: params.id, summary: `${after.title}: updated ${keys.join(", ")}`, before: Object.fromEntries(Object.keys(patch).map((k) => [k, (estimate as Record<string, unknown>)[k]])), after: patch });
  return { estimate: after };
});
