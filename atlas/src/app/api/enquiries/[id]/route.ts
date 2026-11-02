import { route, HttpError } from "@/lib/server/api";
import { getRepo, getSettings } from "@/lib/server/context";
import { audit } from "@/lib/server/audit";
import { EnquiryUpdate, isOpen } from "@/lib/domain/crm";
import { todayIn } from "@/lib/dates";
import type { Rec } from "@/lib/data/entities";

// Customer "Lead Status" has no "Preliminary Estimate Ready" option.
const CUSTOMER_STATUS: Record<string, string> = { "Preliminary Estimate Ready": "Estimate Preparing" };

export const PATCH = route<{ id: string }>("crm.edit", async ({ req, params, session }) => {
  const input = EnquiryUpdate.parse(await req.json());
  const repo = getRepo();
  const before = await repo.get("enquiries", params.id);
  if (!before) throw new HttpError(404, "Enquiry not found");
  const today = todayIn(getSettings().business.timezone);

  const patch: Partial<Rec<"enquiries">> = {};
  for (const k of ["status", "reasonWonLost", "nextFollowUp", "nextAction", "assignedTo", "leadQuality", "notes"] as const) {
    if (input[k] !== undefined && input[k] !== before[k]) (patch as Record<string, unknown>)[k] = input[k];
  }
  const newStatus = input.status ?? before.status;
  if (input.status && isOpen(input.status) && !(input.nextFollowUp ?? before.nextFollowUp)) {
    throw new HttpError(400, "Set a follow-up date before moving this enquiry");
  }
  if (input.status && !isOpen(input.status)) patch.leadAtRisk = false;

  const customerId = before.customerIds?.[0];
  if (input.contacted) {
    patch.lastContactDate = today;
    if (newStatus === "New Enquiry") patch.status = "Contacted";
    await repo.create("communications", {
      title: `${input.contacted.channel} – ${before.title ?? "enquiry"}`,
      customerIds: customerId ? [customerId] : [],
      projectIds: before.projectIds ?? [],
      at: new Date().toISOString(),
      channel: input.contacted.channel,
      direction: "Outgoing",
      message: input.contacted.summary,
      loggedBy: session.name,
      status: "Complete",
    });
  }
  if (!Object.keys(patch).length) return { enquiry: before };
  const after = await repo.update("enquiries", params.id, patch);

  // Keep the customer's headline status and dates in step with their enquiry.
  if (customerId) {
    const cPatch: Partial<Rec<"customers">> = {};
    if (patch.status) cPatch.leadStatus = (CUSTOMER_STATUS[patch.status] ?? patch.status) as never;
    if (patch.reasonWonLost) cPatch.reasonWonLost = patch.reasonWonLost;
    if (patch.lastContactDate) cPatch.lastContactDate = patch.lastContactDate;
    if (patch.nextFollowUp !== undefined) cPatch.nextFollowUp = patch.nextFollowUp;
    if (patch.nextAction) cPatch.nextFollowUpAction = patch.nextAction;
    if (Object.keys(cPatch).length) await repo.update("customers", customerId, cPatch);
  }
  const changes = Object.keys(patch);
  audit(session, {
    action: patch.status ? "enquiry.move" : "enquiry.update",
    entity: "enquiries",
    recordId: params.id,
    summary: patch.status ? `${after.title}: ${before.status} → ${patch.status}` : `${after.title}: ${input.contacted ? `logged ${input.contacted.channel.toLowerCase()} contact` : `updated ${changes.join(", ")}`}`,
    before: Object.fromEntries(changes.map((k) => [k, (before as Record<string, unknown>)[k]])),
    after: patch,
  });
  return { enquiry: after };
});
