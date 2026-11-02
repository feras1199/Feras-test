import { route } from "@/lib/server/api";
import { getRepo } from "@/lib/server/context";
import { audit } from "@/lib/server/audit";
import { CostCreate } from "@/lib/domain/projects";
import { assertComponent, getProject } from "@/lib/server/projects";
import { formatAud } from "@/lib/finance/money";

export const POST = route<{ id: string }>("costs.create", async ({ req, params, session }) => {
  const i = CostCreate.parse(await req.json());
  const repo = getRepo();
  const p = await getProject(repo, params.id);
  const componentIds = await assertComponent(repo, p.id, i.componentId);
  const rec = await repo.create("actualCosts", {
    title: `${i.description} – ${i.supplier}`,
    projectIds: [p.id],
    componentIds,
    costType: i.costType,
    supplier: i.supplier,
    quantity: 1,
    unitCostInc: i.amountIncGstCents,
    costDate: i.costDate,
    reference: i.reference ?? "",
    unplanned: i.unplanned,
    reviewed: false,
    marketingCost: false,
    notes: [i.notes, `Entered by ${session.name}`].filter(Boolean).join("\n"),
  });
  audit(session, { action: "cost.create", entity: "actualCosts", recordId: rec.id, summary: `${p.name}: ${i.costType.toLowerCase()} cost ${formatAud(i.amountIncGstCents)} inc GST from ${i.supplier}${componentIds.length ? "" : " (not allocated to a component)"}` });
  return { cost: rec };
});
