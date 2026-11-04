import { notFound } from "next/navigation";
import Link from "next/link";
import { AcceptQuote } from "@/components/portal/AcceptQuote";
import { formatAud } from "@/lib/finance/money";
import { formatDate, todayIn } from "@/lib/dates";
import { currentSession, getRepo, getSettings } from "@/lib/server/context";
import { portalQuote } from "@/lib/server/portal";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your quote" };

export default async function PortalQuotePage({ params }: { params: Promise<{ id: string }> }) {
  const s = (await currentSession())!;
  const { id } = await params;
  const q = await portalQuote(getRepo(), s.customerId!, id);
  if (!q) notFound();
  const expired = q.validUntil < todayIn(getSettings().business.timezone);
  return (
    <article className="card space-y-6 p-6">
      <Link href="/portal" className="text-sm text-forest-700 underline">Back</Link>
      <header><p className="text-sm text-stone-600">{q.quoteNumber} · valid until {formatDate(q.validUntil)}</p><h1 className="font-display text-2xl font-semibold text-forest-900">{q.title}</h1></header>
      <section><h2 className="font-semibold">What's included</h2><p className="mt-1 whitespace-pre-line text-sm">{q.scope}</p>{q.items.length > 0 && <ul className="mt-2 list-inside list-disc text-sm">{q.items.map((i) => <li key={i.id}>{i.text}</li>)}</ul>}</section>
      <section><h2 className="font-semibold">Price</h2><dl className="mt-1 max-w-sm text-sm"><div className="flex justify-between"><dt>Excluding GST</dt><dd>{formatAud(q.price.exGst)}</dd></div><div className="flex justify-between"><dt>GST</dt><dd>{formatAud(q.price.gst)}</dd></div><div className="mt-1 flex justify-between border-t pt-1 text-base font-semibold"><dt>Total</dt><dd>{formatAud(q.price.incGst)}</dd></div></dl></section>
      {q.extras.length > 0 && <section><h2 className="font-semibold">Optional extras</h2><ul className="mt-1 text-sm">{q.extras.map((x) => <li key={x.id} className="flex justify-between"><span>{x.text}</span><span>{formatAud(x.incGst)}</span></li>)}</ul><p className="text-xs text-stone-500">Not included in the total. Ask us if you'd like to add any.</p></section>}
      <section><h2 className="font-semibold">Payments</h2><ul className="mt-1 text-sm">{q.schedule.map((x) => <li key={x.label} className="flex justify-between"><span>{x.label} ({Math.round(x.rate * 100)}%)</span><span>{formatAud(x.amount)}</span></li>)}</ul></section>
      {q.assumptions && <section><h2 className="font-semibold">Exclusions and assumptions</h2><p className="mt-1 whitespace-pre-line text-sm">{q.assumptions}</p></section>}
      {q.status === "Accepted" ? <p className="rounded-xl bg-forest-50 p-4 font-medium text-forest-900">You've accepted this quote. Thank you, we'll be in touch to book the start date.</p>
        : expired ? <p className="rounded-xl bg-gold-300/30 p-4">This quote has expired. Please contact us and we'll update it.</p>
        : <AcceptQuote id={q.id} total={formatAud(q.price.incGst)} />}
    </article>
  );
}
