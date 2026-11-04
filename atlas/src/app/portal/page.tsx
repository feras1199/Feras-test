import Link from "next/link";
import { Chip } from "@/components/ui";
import { formatAud } from "@/lib/finance/money";
import { formatDate } from "@/lib/dates";
import { currentSession, getRepo } from "@/lib/server/context";
import { portalData } from "@/lib/server/portal";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your project" };

const CUSTOMER_STATUS: Record<string, string> = { "Accepted / Pre-start": "Getting ready to start", "In Progress": "Underway", "On Hold": "On hold", Completed: "Completed", Proposed: "Proposed", Cancelled: "Cancelled" };

export default async function PortalPage() {
  const s = (await currentSession())!;
  const d = await portalData(getRepo(), s.customerId!);
  return (
    <div className="space-y-8">
      <h1 className="font-display text-3xl font-semibold text-forest-900">Hello {d.customer?.name.split(/[ &]/)[0] ?? s.name.split(" ")[0]}</h1>
      {d.quotes.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">Quotes for you</h2>
          {d.quotes.map((q) => (
            <Link key={q.id} href={`/portal/quote/${q.id}`} className="card mb-3 flex flex-wrap items-center justify-between gap-3 p-5 hover:border-forest-300">
              <span><span className="font-medium">{q.title}</span><span className="block text-sm text-stone-600">{q.quoteNumber} · valid until {formatDate(q.validUntil)}</span></span>
              <span className="text-right"><span className="block font-display text-xl font-semibold">{formatAud(q.totalIncGst)}</span><span className="text-xs text-stone-500">inc GST · view and accept</span></span>
            </Link>
          ))}
        </section>
      )}
      {d.projects.length === 0 && d.quotes.length === 0 && <p className="card p-5">There's nothing here yet. We'll let you know when your quote is ready.</p>}
      {d.projects.map((p) => (
        <section key={p.id} className="card space-y-5 p-5">
          <div className="flex flex-wrap items-start justify-between gap-2"><h2 className="font-display text-xl font-semibold text-forest-900">{p.name}</h2><Chip tone="green">{CUSTOMER_STATUS[p.status] ?? p.status}</Chip></div>
          {p.progress !== null && <div><div className="h-2.5 rounded-full bg-stone-100"><div className="h-2.5 rounded-full bg-forest-500" style={{ width: `${Math.min(100, p.progress * 100)}%` }} /></div><p className="mt-1 text-sm text-stone-600">About {Math.round(p.progress * 100)}% complete{p.completionDate ? ` · aiming to finish ${formatDate(p.completionDate)}` : ""}</p></div>}
          {p.updates.length > 0 && <div><h3 className="mb-2 font-semibold">Latest updates</h3>{p.updates.slice(0, 5).map((u) => <div key={u.id} className="mb-3 rounded-xl bg-stone-50 p-3 text-sm"><p className="text-xs text-stone-500">{formatDate(u.date)}</p><p className="whitespace-pre-line">{u.summary}</p>{u.nextSteps && <p className="mt-1 text-stone-600">Next: {u.nextSteps}</p>}</div>)}</div>}
          {p.schedule.length > 0 && <div><h3 className="mb-2 font-semibold">What's coming up</h3><ul className="space-y-1 text-sm">{p.schedule.map((x) => <li key={x.id} className="flex justify-between gap-2"><span>{x.title}</span><span className="text-stone-600">{formatDate(x.start)}{x.status === "Completed" ? " · done" : ""}</span></li>)}</ul></div>}
          {p.payments.length > 0 && <div><h3 className="mb-2 font-semibold">Payments</h3><ul className="divide-y divide-stone-100 text-sm">{p.payments.map((x) => <li key={x.id} className="flex justify-between gap-2 py-2"><span>{x.label}<span className="block text-xs text-stone-500">{x.paid ? "Paid, thank you" : x.dueDate ? `Due ${formatDate(x.dueDate)}` : "Invoiced when this stage is reached"}</span></span><span className="font-medium">{formatAud(x.amount)}</span></li>)}</ul></div>}
          {p.files.length > 0 && <div><h3 className="mb-2 font-semibold">Documents and photos</h3><ul className="space-y-1 text-sm">{p.files.map((f) => <li key={f.id}>{f.link ? <a href={f.link} target="_blank" rel="noreferrer" className="text-forest-700 underline">{f.title}</a> : f.title} <span className="text-xs text-stone-500">{f.type}</span></li>)}</ul></div>}
        </section>
      ))}
    </div>
  );
}
