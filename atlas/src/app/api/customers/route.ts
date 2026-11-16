import { route, HttpError } from "@/lib/server/api";
import { getRepo } from "@/lib/server/context";
import { audit } from "@/lib/server/audit";
import { CustomerInput, findDuplicates } from "@/lib/domain/customers";
import { todayIn } from "@/lib/dates";

export const GET = route("crm.view", async () => {
  const rows = await getRepo().list("customers", { sort: (a, b) => (b.enquiryDate ?? "").localeCompare(a.enquiryDate ?? "") });
  return { customers: rows };
});

export const POST = route("crm.edit", async ({ req, session }) => {
  const input = CustomerInput.parse(await req.json());
  const repo = getRepo();
  const dupes = findDuplicates(input, await repo.list("customers"));
  if (dupes.length && !input.confirmNotDuplicate) {
    throw Object.assign(new HttpError(409, "This looks like an existing customer"), { dupes });
  }
  const { confirmNotDuplicate: _c, ...data } = input;
  const rec = await repo.create("customers", { ...data, leadStatus: "New Enquiry", enquiryDate: todayIn() });
  audit(session, { action: "customer.create", entity: "customers", recordId: rec.id, summary: `Created customer ${rec.name}`, after: data });
  return { customer: rec };
});
