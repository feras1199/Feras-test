import { route, HttpError } from "@/lib/server/api";
import { getRepo } from "@/lib/server/context";
import { audit } from "@/lib/server/audit";
import { CUSTOMER_FIELD_LABELS, CustomerFill, planCustomerFill } from "@/lib/domain/aiFill";
import { findDuplicates } from "@/lib/domain/customers";

/**
 * Fills empty boxes on a customer from something Ask ATLAS read. Boxes that
 * already hold something are left as they are, even if they changed since the suggestion.
 */
export const POST = route<{ id: string }>("crm.edit", async ({ req, params, session }) => {
  const repo = getRepo();
  const before = await repo.get("customers", params.id);
  if (!before) throw new HttpError(404, "Customer not found");
  const input = CustomerFill.parse(await req.json());
  const { updates, differs } = planCustomerFill(before, input);
  const keys = Object.keys(updates) as (keyof typeof updates)[];
  if (keys.length) {
    const dupes = findDuplicates({ ...before, ...updates }, await repo.list("customers"), params.id).filter((d) => d.strength === "strong");
    if (dupes.length) throw new HttpError(409, `Another customer (${dupes[0]!.name}) already has that ${dupes[0]!.reasons.join(" and ").replace("same ", "")}. Nothing was changed.`);
  }
  const after = keys.length ? await repo.update("customers", params.id, updates) : before;
  if (keys.length) audit(session, { action: "customer.ai_fill", entity: "customers", recordId: params.id, summary: `Filled ${keys.map((k) => CUSTOMER_FIELD_LABELS[k]).join(", ")} on ${before.name} from Ask ATLAS`, before: Object.fromEntries(keys.map((k) => [k, null])), after: updates });
  return { customer: after, filled: keys.map((k) => CUSTOMER_FIELD_LABELS[k]), kept: differs.map((d) => CUSTOMER_FIELD_LABELS[d.field]) };
});
