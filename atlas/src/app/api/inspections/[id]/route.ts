import { route, HttpError } from "@/lib/server/api";
import { getRepo } from "@/lib/server/context";
import { audit } from "@/lib/server/audit";
import { InspectionUpdate } from "@/lib/domain/inspections";

export const PATCH = route<{ id: string }>("inspections.edit", async ({ req, params, session }) => {
  const i = InspectionUpdate.parse(await req.json());
  const repo = getRepo();
  const before = await repo.get("inspections", params.id);
  if (!before) throw new HttpError(404, "Inspection not found");
  // The title carries the visit date; keep it in step when the visit is moved.
  const moved = i.inspectionDate && before.inspectionDate && i.inspectionDate !== before.inspectionDate && before.title?.endsWith(before.inspectionDate);
  const after = await repo.update("inspections", params.id, { ...i, ...(moved ? { title: before.title!.slice(0, -before.inspectionDate!.length) + i.inspectionDate } : {}) });
  if (moved) {
    for (const e of before.enquiryIds ?? []) {
      const enq = await repo.get("enquiries", e);
      if (enq && enq.nextFollowUp === before.inspectionDate) await repo.update("enquiries", e, { nextFollowUp: i.inspectionDate });
    }
  }
  if (i.complete && !before.complete) {
    for (const e of before.enquiryIds ?? []) {
      const enq = await repo.get("enquiries", e);
      if (enq && ["New Enquiry", "Contacted", "Site Visit Booked"].includes(enq.status ?? "")) await repo.update("enquiries", e, { status: "Site Inspected", nextAction: "Prepare estimate" });
    }
  }
  audit(session, { action: "inspection.update", entity: "inspections", recordId: params.id, summary: `${after.title}: ${i.complete && !before.complete ? "marked complete" : moved ? `visit moved from ${before.inspectionDate} to ${i.inspectionDate}` : `updated ${Object.keys(i).join(", ")}`}` });
  return { inspection: after };
});
