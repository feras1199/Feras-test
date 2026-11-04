import { route, HttpError } from "@/lib/server/api";
import { getRepo } from "@/lib/server/context";
import { audit } from "@/lib/server/audit";
import { InspectionUpdate } from "@/lib/domain/inspections";

export const PATCH = route<{ id: string }>("inspections.edit", async ({ req, params, session }) => {
  const i = InspectionUpdate.parse(await req.json());
  const repo = getRepo();
  const before = await repo.get("inspections", params.id);
  if (!before) throw new HttpError(404, "Inspection not found");
  const after = await repo.update("inspections", params.id, i);
  if (i.complete && !before.complete) {
    for (const e of before.enquiryIds ?? []) {
      const enq = await repo.get("enquiries", e);
      if (enq && ["New Enquiry", "Contacted", "Site Visit Booked"].includes(enq.status ?? "")) await repo.update("enquiries", e, { status: "Site Inspected", nextAction: "Prepare estimate" });
    }
  }
  audit(session, { action: "inspection.update", entity: "inspections", recordId: params.id, summary: `${after.title}: ${i.complete && !before.complete ? "marked complete" : `updated ${Object.keys(i).join(", ")}`}` });
  return { inspection: after };
});
