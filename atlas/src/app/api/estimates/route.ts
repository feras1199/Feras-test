import { route, HttpError } from "@/lib/server/api";
import { getRepo, getSettings } from "@/lib/server/context";
import { audit } from "@/lib/server/audit";
import { EstimateCreate, scheduleToFields } from "@/lib/domain/estimates";
import { addDays } from "@/lib/domain/dates";
import { todayIn } from "@/lib/dates";

export const GET = route("estimates.view", async () => ({ estimates: await getRepo().list("estimates") }));

export const POST = route("estimates.edit", async ({ req, session }) => {
  const i = EstimateCreate.parse(await req.json());
  const repo = getRepo();
  const settings = getSettings();
  const customer = await repo.get("customers", i.customerId);
  if (!customer) throw new HttpError(400, "Customer not found");
  const enquiry = i.enquiryId ? await repo.get("enquiries", i.enquiryId) : null;
  const today = todayIn(settings.business.timezone);
  const year = today.slice(0, 4);
  const existing = await repo.list("estimates", { where: (e) => !!e.quoteNumber?.startsWith(`Q-${year}-`) });
  const next = Math.max(0, ...existing.map((e) => Number(e.quoteNumber!.slice(7)) || 0)) + 1;
  const quoteNumber = `Q-${year}-${String(next).padStart(3, "0")}`;
  const rec = await repo.create("estimates", {
    title: `${quoteNumber} ${i.title}`,
    quoteNumber,
    customerIds: [customer.id],
    enquiryIds: enquiry ? [enquiry.id] : [],
    projectIds: enquiry?.projectIds ?? [],
    estimateDate: today,
    status: "Draft",
    estimateType: i.estimateType,
    pricingBasis: "Net costs + GST",
    revision: 1,
    validUntil: addDays(today, settings.pricing.quoteValidityDays),
    quoteReviewStatus: "Needs Estimating",
    approvalStatus: "Not Sent",
    quoteLocked: false,
    ...scheduleToFields(settings.payments.schedules[settings.payments.defaultSchedule]!.stages),
  });
  if (enquiry && ["New Enquiry", "Contacted", "Site Visit Booked", "Site Inspected"].includes(enquiry.status ?? "")) {
    await repo.update("enquiries", enquiry.id, { status: "Estimate Preparing" });
  }
  audit(session, { action: "estimate.create", entity: "estimates", recordId: rec.id, summary: `Started estimate ${rec.title}` });
  return { estimate: rec };
});
