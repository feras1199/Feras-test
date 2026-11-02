import { route, HttpError } from "@/lib/server/api";
import { getRepo, getSettings } from "@/lib/server/context";
import { audit } from "@/lib/server/audit";
import { EnquiryCreate } from "@/lib/domain/crm";
import { addDays } from "@/lib/domain/dates";
import { todayIn } from "@/lib/dates";

export const GET = route("crm.view", async () => ({ enquiries: await getRepo().list("enquiries") }));

export const POST = route("crm.edit", async ({ req, session }) => {
  const input = EnquiryCreate.parse(await req.json());
  const repo = getRepo();
  const customer = await repo.get("customers", input.customerId);
  if (!customer) throw new HttpError(400, "That customer no longer exists");
  const today = todayIn(getSettings().business.timezone);
  const short = input.serviceRequested.split(/[.,\n]/)[0]!.slice(0, 60);
  const rec = await repo.create("enquiries", {
    title: `${customer.name} – ${short}`,
    customerIds: [customer.id],
    enquiryDate: today,
    status: "New Enquiry",
    serviceRequested: input.serviceRequested,
    leadSource: input.leadSource ?? (customer.leadSource as never) ?? undefined,
    budget: input.budgetCents,
    nextFollowUp: input.nextFollowUp ?? addDays(today, 1),
    nextAction: input.nextAction || "First contact",
    assignedTo: input.assignedTo || session.name,
    leadQuality: "Unknown",
  });
  audit(session, { action: "enquiry.create", entity: "enquiries", recordId: rec.id, summary: `New enquiry: ${rec.title}`, after: input });
  return { enquiry: rec };
});
