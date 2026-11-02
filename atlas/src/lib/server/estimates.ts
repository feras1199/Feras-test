import "server-only";
import type { Repository } from "../data/repository";
import type { Rec } from "../data/entities";
import { summarise } from "../domain/estimates";
import { getSettings } from "./context";
import { todayIn } from "../dates";
import { HttpError } from "./api";
import { quantityBasisFor } from "../domain/inspections";

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
