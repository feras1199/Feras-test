import { route, HttpError } from "@/lib/server/api";
import { getRepo } from "@/lib/server/context";
import { audit } from "@/lib/server/audit";
import { CustomerInput, findDuplicates } from "@/lib/domain/customers";

export const GET = route<{ id: string }>("crm.view", async ({ params }) => {
  const c = await getRepo().get("customers", params.id);
  if (!c) throw new HttpError(404, "Customer not found");
  return { customer: c };
});

export const PATCH = route<{ id: string }>("crm.edit", async ({ req, params, session }) => {
  const repo = getRepo();
  const before = await repo.get("customers", params.id);
  if (!before) throw new HttpError(404, "Customer not found");
  const raw = (await req.json()) as Record<string, unknown>;
  // An empty string means "clear this field"; everything else is validated.
  const cleared = Object.keys(raw).filter((k) => raw[k] === "" && k !== "name");
  const input = CustomerInput.partial().parse(Object.fromEntries(Object.entries(raw).filter(([k]) => !cleared.includes(k))));
  const dupes = findDuplicates({ ...before, ...input }, await repo.list("customers"), params.id).filter((d) => d.strength === "strong");
  if (dupes.length && !input.confirmNotDuplicate) throw Object.assign(new HttpError(409, "Another customer has the same email or phone"), { dupes });
  const { confirmNotDuplicate: _c, ...rest } = input;
  const proposed: Record<string, unknown> = { ...rest, ...Object.fromEntries(cleared.map((k) => [k, null])) };
  // Only write fields that actually changed, so the audit trail stays meaningful.
  const data = Object.fromEntries(Object.entries(proposed).filter(([k, v]) => ((before as Record<string, unknown>)[k] ?? null) !== (v ?? null)));
  if (!Object.keys(data).length) return { customer: before };
  const after = await repo.update("customers", params.id, data);
  const changed = Object.fromEntries(Object.keys(data).map((k) => [k, (before as Record<string, unknown>)[k]]));
  audit(session, { action: "customer.update", entity: "customers", recordId: params.id, summary: `Updated ${after.name}: ${Object.keys(data).join(", ")}`, before: changed, after: data });
  return { customer: after };
});
