import { route } from "@/lib/server/api";
import { getRepo, getSettings } from "@/lib/server/context";
import { audit } from "@/lib/server/audit";
import { VariationCreate } from "@/lib/domain/projects";
import { assertComponent, getProject } from "@/lib/server/projects";
import { formatAud } from "@/lib/finance/money";
import { todayIn } from "@/lib/dates";

export const POST = route<{ id: string }>("variations.edit", async ({ req, params, session }) => {
  const i = VariationCreate.parse(await req.json());
  const repo = getRepo();
  const p = await getProject(repo, params.id);
  const componentIds = await assertComponent(repo, p.id, i.componentId);
  const rec = await repo.create("variations", {
    title: i.title, description: i.description, projectIds: [p.id], componentIds, requestedBy: i.requestedBy,
    requestDate: todayIn(getSettings().business.timezone), estimatedCost: i.estimatedCostCents, customerPrice: i.customerPriceIncGstCents,
    scheduleImpactDays: i.scheduleImpactDays, status: "Draft", customerApproved: false, revenueApplied: false, costApplied: false,
  });
  audit(session, { action: "variation.create", entity: "variations", recordId: rec.id, summary: `${p.name}: variation "${i.title}" ${formatAud(i.customerPriceIncGstCents)} inc GST (draft)` });
  return { variation: rec };
});
