import { notFound } from "next/navigation";
import Link from "next/link";
import { Chip, PageHeader } from "@/components/ui";
import { InspectionEditor } from "@/components/inspections/InspectionEditor";
import { ContactButtons } from "@/components/ContactButtons";
import { SiteMedia } from "@/components/inspections/SiteMedia";
import { voiceAiStatus } from "@/lib/server/voiceNotes";
import { fileStoreOf } from "@/lib/data/repository";
import { formatTime, measurementQuantity } from "@/lib/domain/inspections";
import { formatDate } from "@/lib/dates";
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
  const customer = insp.customerIds?.[0] ? await repo.get("customers", insp.customerIds[0]) : null;
  const store = fileStoreOf(repo);
  const files = store ? (await store.listFiles("inspections", id)).filter((f) => !f.archived) : [];
  return (
    <>
      <PageHeader title={insp.title ?? "Site inspection"} subtitle={[insp.inspectionDate ? `${formatDate(insp.inspectionDate)}${insp.inspectionTime ? `, ${formatTime(insp.inspectionTime)}` : ""}` : "", insp.siteAddress].filter(Boolean).join(" · ") || undefined} actions={<>
        {insp.complete && <Chip tone="green">Complete</Chip>}
        {can(s.role, "estimates.edit") && insp.customerIds?.[0] && <Link className="btn-primary" href={`/estimates/new?customer=${insp.customerIds[0]}${insp.enquiryIds?.[0] ? `&enquiry=${insp.enquiryIds[0]}` : ""}`}>Start estimate</Link>}
      </>} />
      <div className="mb-4"><ContactButtons phone={customer?.phone} email={customer?.email} address={insp.siteAddress || customer?.address} suburb={insp.siteAddress ? null : customer?.suburb} doNotContact={!!customer?.doNotContact} /></div>
      <div className="mb-6">
        <SiteMedia inspectionId={insp.id} available={!!store} editable={can(s.role, "inspections.edit")} files={files.flatMap((f) => (f.kind === "document" ? [] : [{ id: f.id, kind: f.kind, name: f.name, durationS: f.durationS, createdBy: f.createdBy, createdTime: f.createdTime, transcript: f.transcript }]))} ai={voiceAiStatus()} summary={insp.aiMeetingSummary ?? ""} />
      </div>
      <InspectionEditor
        key={insp.aiFilledJson ?? "manual"}
        editable={can(s.role, "inspections.edit")}
        inspection={{ id: insp.id, complete: !!insp.complete, scope: insp.scope ?? "", accessDifficulty: insp.accessDifficulty ?? "", accessWidthM: insp.accessWidthM ?? null, existingConditions: insp.existingConditions ?? "", slopeLevels: insp.slopeLevels ?? "", drainage: insp.drainage ?? "", services: insp.services ?? "", risks: insp.risks ?? "", priorities: insp.priorities ?? "", notes: insp.notes ?? "", budgetFit: insp.budgetFit ?? "" }}
        measurements={measurements.map((m) => ({ id: m.id, zone: m.zone ?? "", workType: m.workType ?? "Other", unit: m.unit ?? "m²", method: m.method ?? "Manual onsite", lengthM: m.lengthM ?? null, widthM: m.widthM ?? null, heightM: m.heightM ?? null, measuredQuantity: m.measuredQuantity ?? null, confidence: m.confidence ?? "Confirmed onsite", verified: !!m.verified, quantity: measurementQuantity(m) }))}
      />
    </>
  );
}
