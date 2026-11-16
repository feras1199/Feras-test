import { notFound } from "next/navigation";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { PrintButton } from "@/components/estimates/PrintButton";
import { formatAud } from "@/lib/finance/money";
import { formatDate } from "@/lib/dates";
import { lineCostExGst, type QuoteSnapshot } from "@/lib/domain/estimates";
import { HttpError } from "@/lib/server/api";
import { loadEstimate } from "@/lib/server/estimates";
import { getRepo, requirePage } from "@/lib/server/context";

export const dynamic = "force-dynamic";
export const metadata = { title: "Quote" };

/** Customer-facing quote. Shows prices and scope only: never costs, markup or margins. */
export default async function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  await requirePage("estimates.view");
  const { id } = await params;
  const repo = getRepo();
  const ctx = await loadEstimate(repo, id).catch((e) => { if (e instanceof HttpError && e.status === 404) notFound(); throw e; });
  const { estimate: e, summary, lines, settings } = ctx;
  const customer = e.customerIds?.[0] ? await repo.get("customers", e.customerIds[0]) : null;
  const snap: QuoteSnapshot | null = e.quoteLocked && e.snapshotJson ? JSON.parse(e.snapshotJson) : null;
  const draft = !snap;
  const total = snap?.pricing ?? summary.pricing;
  const schedule = snap?.schedule ?? summary.schedule ?? [];
  const items = (snap?.lines ?? lines.map((l) => ({ id: l.id, description: l.description ?? "", costType: l.costType ?? "", quantity: l.quantity ?? 0, unit: l.unitSnapshot ?? "", costExGst: lineCostExGst(l), customerDescription: l.customerDescription ?? "", option: l.proposalOption ?? "Included" })))
    .filter((l) => l.option === "Included" && l.costType !== "Labour" && l.costType !== "Disposal" && l.costType !== "Delivery");
  const extras = snap?.optionalExtras ?? summary.optionalExtras;
  const gstRate = snap?.gstRate ?? settings.pricing.gstRate;
  const scope = snap?.customerScope ?? e.customerScope ?? "";
  const assumptions = snap?.assumptions ?? e.assumptions ?? "";
  const b = settings.business;

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2 print:hidden">
        <Link href={`/estimates/${e.id}`} className="btn-secondary">Back to estimate</Link>
        <PrintButton />
        {draft && <p className="self-center text-sm text-red-700">Draft preview: approve the price before sending.</p>}
      </div>
      <article className="relative mx-auto max-w-3xl overflow-hidden break-words bg-white p-6 shadow-card sm:p-10 print:max-w-none print:p-0 print:shadow-none">
        {draft && <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center text-[120px] font-bold text-red-500/10">DRAFT</div>}
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-stone-200 pb-6">
          <div className="flex items-center gap-3"><Logo className="h-12 w-12" /><div><p className="font-display text-xl font-semibold text-forest-900">{b.name}</p><p className="text-xs text-stone-600">{[b.abn && `ABN ${b.abn}`, b.licenceNumber && `Licence ${b.licenceNumber}`, b.phone, b.email].filter(Boolean).join(" · ")}</p></div></div>
          <div className="text-right text-sm"><p className="font-display text-2xl font-semibold text-forest-900">Quote</p><p>{snap?.quoteNumber ?? e.quoteNumber}</p><p className="text-stone-600">Issued {formatDate(e.sentDate ?? e.estimateDate)}</p><p className="text-stone-600">Valid until {formatDate(snap?.validUntil ?? e.validUntil)}</p></div>
        </header>
        <section className="mt-6 text-sm"><p className="text-xs uppercase tracking-wide text-stone-500">Prepared for</p><p className="font-medium">{customer?.name}</p><p>{[customer?.address, customer?.suburb].filter(Boolean).join(", ")}</p></section>
        <section className="mt-6"><h2 className="font-display text-lg font-semibold text-forest-900">Scope of work</h2><p className="mt-2 whitespace-pre-line text-sm leading-relaxed">{scope || "Scope to be confirmed."}</p>
          {items.length > 0 && <ul className="mt-3 list-inside list-disc text-sm text-stone-700">{items.map((l) => <li key={l.id}>{l.customerDescription || l.description}{l.quantity && l.unit ? ` (${l.quantity} ${l.unit})` : ""}</li>)}</ul>}
        </section>
        <section className="mt-6"><h2 className="font-display text-lg font-semibold text-forest-900">Price</h2>
          <dl className="mt-2 max-w-sm text-sm">
            <div className="flex justify-between py-1"><dt>Price excluding GST</dt><dd>{formatAud(total.sellExGst)}</dd></div>
            <div className="flex justify-between py-1"><dt>GST ({Math.round(gstRate * 100)}%)</dt><dd>{formatAud(total.gst)}</dd></div>
            <div className="flex justify-between border-t border-stone-300 py-2 text-base font-semibold"><dt>Total including GST</dt><dd>{formatAud(total.sellIncGst)}</dd></div>
          </dl>
        </section>
        {extras.length > 0 && <section className="mt-6"><h2 className="font-display text-lg font-semibold text-forest-900">Optional extras</h2><ul className="mt-2 text-sm">{extras.map((x) => <li key={x.id} className="flex justify-between py-1"><span>{x.description}</span><span>{formatAud(x.priceExGst + Math.round(x.priceExGst * gstRate))} inc GST</span></li>)}</ul><p className="text-xs text-stone-500">Not included in the total above.</p></section>}
        <section className="mt-6"><h2 className="font-display text-lg font-semibold text-forest-900">Payment schedule</h2>
          <table className="mt-2 w-full text-sm"><tbody>{schedule.map((s) => <tr key={s.index} className="border-b border-stone-100"><td className="py-1.5">{s.label}</td><td className="py-1.5 text-right text-stone-600">{Math.round(s.rate * 1000) / 10}%</td><td className="py-1.5 text-right font-medium">{formatAud(s.amount)}</td></tr>)}</tbody></table>
        </section>
        {assumptions && <section className="mt-6"><h2 className="font-display text-lg font-semibold text-forest-900">Exclusions and assumptions</h2><p className="mt-2 whitespace-pre-line text-sm">{assumptions}</p></section>}
        <section className="mt-10 grid gap-8 text-sm sm:grid-cols-2 print:grid-cols-2"><div><p className="border-t border-stone-400 pt-1">Customer signature</p></div><div><p className="border-t border-stone-400 pt-1">Date</p></div></section>
      </article>
    </div>
  );
}
