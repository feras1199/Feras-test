import "server-only";
import type { Repository } from "../data/repository";
import type { QuoteSnapshot } from "../domain/estimates";

/**
 * Everything the customer portal shows is built here from an explicit
 * allow-list of fields. Costs, rates, suppliers, margins, internal notes and
 * other customers' records are never read into these objects.
 */
export async function portalData(repo: Repository, customerId: string) {
  const mine = <T extends { customerIds?: string[] }>(r: T) => !!r.customerIds?.includes(customerId);
  const [customer, projects, estimates] = await Promise.all([repo.get("customers", customerId), repo.list("projects", { where: mine }), repo.list("estimates", { where: mine })]);
  const pids = new Set(projects.map((p) => p.id));
  const inMine = <T extends { projectIds?: string[] }>(r: T) => !!r.projectIds?.some((p) => pids.has(p));
  const [payments, schedule, updates, files] = await Promise.all([
    repo.list("payments", { where: (p) => inMine(p) && !p.archived }),
    repo.list("schedule", { where: (s) => inMine(s) && !!s.customerVisible }),
    repo.list("clientUpdates", { where: (u) => inMine(u) && !!u.customerVisible }),
    repo.list("files", { where: (f) => (inMine(f) || !!f.customerIds?.includes(customerId)) && !!f.customerVisible }),
  ]);
  return {
    customer: customer ? { name: customer.name ?? "" } : null,
    quotes: estimates
      .filter((e) => e.status === "Quoted" && e.snapshotJson)
      .map((e) => {
        const s = JSON.parse(e.snapshotJson!) as QuoteSnapshot;
        return { id: e.id, quoteNumber: s.quoteNumber, title: (e.title ?? "").replace(/^Q-\S+\s*/, ""), validUntil: s.validUntil, totalIncGst: s.pricing.sellIncGst };
      }),
    projects: projects.map((p) => ({
      id: p.id,
      name: p.name ?? "Your project",
      status: p.status ?? "",
      progress: typeof p.progress === "number" ? p.progress : null,
      startDate: p.startDate ?? null,
      completionDate: p.completionDate ?? null,
      schedule: schedule.filter((s) => s.projectIds?.includes(p.id)).sort((a, b) => (a.plannedStart ?? "").localeCompare(b.plannedStart ?? "")).map((s) => ({ id: s.id, title: s.title ?? "", start: s.plannedStart ?? null, finish: s.plannedFinish ?? null, status: s.status ?? "" })),
      updates: updates.filter((u) => u.projectIds?.includes(p.id)).sort((a, b) => (b.updateDate ?? "").localeCompare(a.updateDate ?? "")).map((u) => ({ id: u.id, date: u.updateDate ?? null, summary: u.summary ?? "", nextSteps: u.nextSteps ?? "", photos: (u.photos ?? []).map((ph) => ({ url: ph.url, name: ph.filename })) })),
      payments: payments.filter((x) => x.projectIds?.includes(p.id)).map((x) => ({ id: x.id, label: x.stageLabel || x.title || "Payment", amount: x.amount ?? 0, dueDate: x.dueDate ?? null, paid: x.status === "Paid" })),
      files: files.filter((f) => f.projectIds?.includes(p.id)).map((f) => ({ id: f.id, title: f.title ?? "File", type: f.fileType ?? "", link: f.externalLink || f.files?.[0]?.url || null })),
    })),
  };
}

export async function portalQuote(repo: Repository, customerId: string, estimateId: string) {
  const e = await repo.get("estimates", estimateId);
  if (!e || !e.customerIds?.includes(customerId) || !e.snapshotJson || !["Quoted", "Accepted"].includes(e.status ?? "")) return null;
  const s = JSON.parse(e.snapshotJson) as QuoteSnapshot;
  return {
    id: e.id,
    status: e.status!,
    quoteNumber: s.quoteNumber,
    title: (e.title ?? "").replace(/^Q-\S+\s*/, ""),
    validUntil: s.validUntil,
    scope: s.customerScope,
    assumptions: s.assumptions,
    items: s.lines.filter((l) => l.option === "Included" && !["Labour", "Disposal", "Delivery"].includes(l.costType)).map((l) => ({ id: l.id, text: l.customerDescription || l.description })),
    extras: s.optionalExtras.map((x) => ({ id: x.id, text: x.description, incGst: x.priceExGst + Math.round(x.priceExGst * s.gstRate) })),
    price: { exGst: s.pricing.sellExGst, gst: s.pricing.gst, incGst: s.pricing.sellIncGst },
    schedule: s.schedule.map((x) => ({ label: x.label, rate: x.rate, amount: x.amount })),
  };
}
