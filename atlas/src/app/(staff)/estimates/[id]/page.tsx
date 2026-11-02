import { notFound } from "next/navigation";
import { EstimateBuilder } from "@/components/estimates/EstimateBuilder";
import { lineCostExGst } from "@/lib/domain/estimates";
import { can } from "@/lib/auth/roles";
import { HttpError } from "@/lib/server/api";
import { loadEstimate, measurementsFor } from "@/lib/server/estimates";
import { measurementQuantity } from "@/lib/domain/inspections";
import { getRepo, requirePage } from "@/lib/server/context";

export const dynamic = "force-dynamic";

export default async function EstimatePage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requirePage("estimates.view");
  const { id } = await params;
  const repo = getRepo();
  const ctx = await loadEstimate(repo, id).catch((e) => {
    if (e instanceof HttpError && e.status === 404) notFound();
    throw e;
  });
  const { estimate: e, lines, summary, settings } = ctx;
  const [customer, costItems, measurements] = await Promise.all([e.customerIds?.[0] ? repo.get("customers", e.customerIds[0]) : null, repo.list("costItems", { where: (c) => c.active !== false }), measurementsFor(repo, e)]);
  return (
    <EstimateBuilder
      estimate={{
        id: e.id, title: e.title ?? "", status: e.status ?? "Draft", locked: !!e.quoteLocked, quoteNumber: e.quoteNumber ?? "", customerScope: e.customerScope ?? "", assumptions: e.assumptions ?? "",
        assumptionsResolved: !!e.assumptionsResolved, markupOverride: e.markupOverride ?? null, managerOverride: e.managerOverride ?? null, commissionRate: e.commissionRate ?? null,
        validUntil: e.validUntil ?? null, internalReviewNotes: e.internalReviewNotes ?? "", projectId: e.projectIds?.[0] ?? null,
      }}
      customer={customer ? { id: customer.id, name: customer.name ?? "", suburb: customer.suburb ?? "" } : null}
      lines={lines.map((l) => ({ id: l.id, description: l.description ?? "", costType: l.costType ?? "Other", quantity: l.quantity ?? 0, unit: l.unitSnapshot ?? "", wasteRate: l.wasteRate ?? 0, unitCostCents: l.unitCostSnapshot ?? 0, priceIncludesGst: (l.inputGstRate ?? 0) > 0, proposalOption: l.proposalOption ?? "Included", customerDescription: l.customerDescription ?? "", quantityVerified: !!l.quantityVerified, measurementId: l.measurementIds?.[0] ?? null, costExGst: lineCostExGst(l) }))}
      summary={summary}
      settings={{ defaultMarkup: settings.pricing.defaultMarkup, commissionRate: settings.commission.rate, commissionEnabled: settings.commission.enabled, schedules: settings.payments.schedules, gstRate: settings.pricing.gstRate }}
      costItems={costItems.map((c) => ({ id: c.id, name: c.name ?? "", unit: c.unit ?? "", priceIncCents: c.currentUnitCostInc ?? null, category: c.category ?? "" })).filter((c) => c.name)}
      measurements={measurements.map((m) => ({ id: m.id, label: `${m.zone ?? "Area"} · ${m.workType ?? ""}`, quantity: measurementQuantity(m), unit: m.unit ?? "" })).filter((m) => m.quantity !== null) as { id: string; label: string; quantity: number; unit: string }[]}
      perms={{ edit: can(s.role, "estimates.edit"), approve: can(s.role, "estimates.approve"), owner: s.role === "owner" }}
    />
  );
}
