import "server-only";
import type { Repository } from "../data/repository";
import type { Rec } from "../data/entities";
import { summarise } from "../domain/estimates";
import { getSettings } from "./context";
import { todayIn } from "../dates";
import { HttpError } from "./api";
import { quantityBasisFor } from "../domain/inspections";
import type { QuoteSnapshot } from "../domain/estimates";
import { addDays } from "../domain/dates";
import { dataSource } from "./context";
import { audit } from "./audit";
import { formatAud } from "../finance/money";
import type { SessionPayload } from "../auth/session";

export async function measurementLink(repo: Repository, id: string | undefined): Promise<Partial<Rec<"estimateLines">>> {
  if (!id) return { measurementIds: [] };
  const m = await repo.get("measurements", id);
  if (!m) throw new HttpError(400, "That measurement no longer exists");
  return { measurementIds: [m.id], quantityBasis: quantityBasisFor(m.unit) as never };
}

/** Measurements from inspections for the same customer or enquiry, for picking line quantities. */
export async function measurementsFor(repo: Repository, e: Rec<"estimates">) {
  const insp = await repo.list("inspections", { where: (i) => !!(i.customerIds?.some((c) => e.customerIds?.includes(c)) || i.enquiryIds?.some((x) => e.enquiryIds?.includes(x))) });
  const ids = new Set(insp.map((i) => i.id));
  return repo.list("measurements", { where: (m) => !!m.inspectionIds?.some((i) => ids.has(i)) });
}

/** Load an estimate with everything needed to price and check it. */
export async function loadEstimate(repo: Repository, id: string) {
  const estimate = await repo.get("estimates", id);
  if (!estimate) throw new HttpError(404, "Estimate not found");
  const settings = getSettings();
  const today = todayIn(settings.business.timezone);
  const [lines, components, costItems, measurements] = await Promise.all([
    repo.list("estimateLines", { where: (l) => !!l.estimateIds?.includes(id) }),
    estimate.projectIds?.length ? repo.list("components", { where: (c) => !!c.projectIds?.some((p) => estimate.projectIds!.includes(p)) }) : Promise.resolve([] as Rec<"components">[]),
    repo.list("costItems"),
    repo.list("measurements"),
  ]);
  const activeLines = lines.filter((l) => l.included !== false);
  const priceDates = Object.fromEntries(costItems.map((c) => [c.id, { date: c.priceUpdatedDate ?? null, confidence: c.confidence ?? null }]));
  const measurementsLinked = measurements.filter((m) => activeLines.some((l) => l.measurementIds?.includes(m.id))).length;
  const componentTypes = components.map((c) => c.componentType ?? "").filter(Boolean);
  const summary = summarise(estimate, activeLines, settings, { componentTypes, measurementsLinked, today, priceDates });
  return { estimate, lines: activeLines, removedLines: lines.filter((l) => l.included === false), summary, settings, today, components };
}

export function assertEditable(e: Rec<"estimates">) {
  if (e.quoteLocked) throw new HttpError(409, "This estimate is approved and locked. Create a revision to change it.");
}

/**
 * Acceptance creates the project (if needed) and the payment stages from the
 * approved snapshot. Used by staff and by the customer portal. Idempotent.
 */
export async function acceptEstimate(repo: Repository, e: Rec<"estimates">, actor: Pick<SessionPayload, "uid" | "name" | "role">, acceptedBy: string, method: string) {
  const settings = getSettings();
  const today = todayIn(settings.business.timezone);
  if (e.status !== "Quoted" && e.status !== "Ready") throw new HttpError(409, `Can't accept an estimate that is ${e.status}`);
  if (e.validUntil && e.validUntil < today && actor.role === "customer") throw new HttpError(409, "This quote has expired. Please contact us for an updated quote.");
  if (dataSource() === "airtable" && process.env.ATLAS_LEGACY_PAYMENT_AUTOMATIONS_OFF !== "1") {
    throw new HttpError(409, "The old Airtable payment automations are still on and would create duplicate payments. Turn them off, then set ATLAS_LEGACY_PAYMENT_AUTOMATIONS_OFF=1.");
  }
  const snap = JSON.parse(e.snapshotJson ?? "null") as QuoteSnapshot | null;
  if (!snap) throw new HttpError(409, "This estimate has no approved snapshot");
  let projectId = e.projectIds?.[0];
  if (!projectId) {
    const customer = e.customerIds?.[0] ? await repo.get("customers", e.customerIds[0]) : null;
    const p = await repo.create("projects", {
      name: `${customer?.name ?? "Customer"} – ${e.title?.replace(/^Q-\d{4}-\d+(-R\d+)?\s*/, "").replace(/ \(rev \d+\)$/, "") ?? "Project"}`,
      status: "Accepted / Pre-start",
      customerIds: e.customerIds ?? [],
      estimateIds: [e.id],
      enquiryIds: e.enquiryIds ?? [],
      estValue: snap.pricing.sellIncGst,
      estimatedCostSnapshot: snap.pricing.costBase,
      siteAddress: customer?.address ?? "",
      suburb: customer?.suburb ?? "",
      health: "On Track",
      progress: 0,
      dataMode: dataSource() === "airtable" ? "Live" : "Practice",
    });
    projectId = p.id;
  }
  const existing = await repo.list("payments", { where: (p) => !!p.paymentKey?.startsWith(`${e.id}:`) });
  const created: Rec<"payments">[] = [];
  if (!existing.length) {
    for (const s of snap.schedule) {
      created.push(await repo.create("payments", {
        title: `${snap.quoteNumber} ${s.label}`,
        projectIds: [projectId],
        stageLabel: s.label,
        stageRate: s.rate,
        amount: s.amount,
        contractSnapshot: snap.pricing.sellIncGst,
        dueDate: s.index === 0 ? addDays(today, settings.payments.dueDays) : null,
        status: "Pending",
        paymentKey: `${e.id}:${s.index}`,
        archived: false,
        notes: s.index === 0 ? "" : "Raise when the stage milestone is reached",
      }));
    }
  }
  const after = await repo.update("estimates", e.id, { status: "Accepted", acceptedDate: today, approvalStatus: "Accepted", projectIds: [projectId] });
  for (const enqId of e.enquiryIds ?? []) await repo.update("enquiries", enqId, { status: "Won", reasonWonLost: "Good fit / value", projectIds: [projectId] });
  for (const cId of e.customerIds ?? []) await repo.update("customers", cId, { leadStatus: "Won" });
  audit(actor, { action: "estimate.accept", entity: "estimates", recordId: e.id, summary: `${e.title} accepted by ${acceptedBy} (${method}). ${created.length} payment stages created totalling ${formatAud(created.reduce((a, p) => a + (p.amount ?? 0), 0))}`, after: { projectId, payments: created.map((p) => p.id) } });
  return { estimate: after, projectId, payments: created.length };
}
