import { route, HttpError } from "@/lib/server/api";
import { getRepo } from "@/lib/server/context";
import { audit } from "@/lib/server/audit";
import { InspectionCreate } from "@/lib/domain/inspections";

export const POST = route("inspections.edit", async ({ req, session }) => {
  const i = InspectionCreate.parse(await req.json());
  const repo = getRepo();
  const c = await repo.get("customers", i.customerId);
  if (!c) throw new HttpError(400, "Customer not found");
  const enq = i.enquiryId ? await repo.get("enquiries", i.enquiryId) : null;
  const rec = await repo.create("inspections", {
    title: `${c.name} – site inspection ${i.inspectionDate}`,
    customerIds: [c.id],
    enquiryIds: enq ? [enq.id] : [],
    projectIds: enq?.projectIds ?? [],
    inspectionDate: i.inspectionDate,
    inspector: session.name,
    siteAddress: [c.address, c.suburb].filter(Boolean).join(", "),
    budget: enq?.budget ?? c.budget ?? null,
    scope: enq?.serviceRequested ?? c.serviceRequested ?? "",
    complete: false,
  });
  if (enq && ["New Enquiry", "Contacted"].includes(enq.status ?? "")) await repo.update("enquiries", enq.id, { status: "Site Visit Booked", nextFollowUp: i.inspectionDate, nextAction: "Site inspection" });
  audit(session, { action: "inspection.create", entity: "inspections", recordId: rec.id, summary: `Site inspection booked: ${rec.title}` });
  return { inspection: rec };
});
