import { notFound } from "next/navigation";
import Link from "next/link";
import { Chip, PageHeader } from "@/components/ui";
import { InspectionEditor } from "@/components/inspections/InspectionEditor";
import { measurementQuantity } from "@/lib/domain/inspections";
import { can } from "@/lib/auth/roles";
import { getRepo, requirePage } from "@/lib/server/context";

export const dynamic = "force-dynamic";

export default async function InspectionPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requirePage("inspections.view");
  const { id } = await params;
  const repo = getRepo();
  const insp = await repo.get("inspections", id);
  if (!insp) notFound();
  const measurements = await repo.list("measurements", { where: (m) => !!m.inspectionIds?.includes(id) });
  return (
    <>
      <PageHeader title={insp.title ?? "Site inspection"} subtitle={insp.siteAddress ?? undefined} actions={<>
        {insp.complete && <Chip tone="green">Complete</Chip>}
        {can(s.role, "estimates.edit") && insp.customerIds?.[0] && <Link className="btn-primary" href={`/estimates/new?customer=${insp.customerIds[0]}${insp.enquiryIds?.[0] ? `&enquiry=${insp.enquiryIds[0]}` : ""}`}>Start estimate</Link>}
      </>} />
      <InspectionEditor
        editable={can(s.role, "inspections.edit")}
        inspection={{ id: insp.id, complete: !!insp.complete, scope: insp.scope ?? "", accessDifficulty: insp.accessDifficulty ?? "", accessWidthM: insp.accessWidthM ?? null, existingConditions: insp.existingConditions ?? "", slopeLevels: insp.slopeLevels ?? "", drainage: insp.drainage ?? "", services: insp.services ?? "", risks: insp.risks ?? "", priorities: insp.priorities ?? "", notes: insp.notes ?? "", budgetFit: insp.budgetFit ?? "" }}
        measurements={measurements.map((m) => ({ id: m.id, zone: m.zone ?? "", workType: m.workType ?? "Other", unit: m.unit ?? "m²", method: m.method ?? "Manual onsite", lengthM: m.lengthM ?? null, widthM: m.widthM ?? null, heightM: m.heightM ?? null, measuredQuantity: m.measuredQuantity ?? null, confidence: m.confidence ?? "Confirmed onsite", verified: !!m.verified, quantity: measurementQuantity(m) }))}
      />
    </>
  );
}
