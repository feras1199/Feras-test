import Link from "next/link";
import { Chip, Empty, PageHeader, Stat } from "@/components/ui";
import { ActionButton, QuickForm } from "@/components/QuickForm";
import { formatAud, formatPct, sumCents } from "@/lib/finance/money";
import { paymentState } from "@/lib/finance/payments";
import { formatDate, todayIn } from "@/lib/dates";
import { addDays } from "@/lib/domain/dates";
import { projectFinancials } from "@/lib/domain/projects";
import { accounting } from "@/lib/integrations/quickbooks";
import { can } from "@/lib/auth/roles";
import { getRepo, getSettings, requirePage } from "@/lib/server/context";

export const dynamic = "force-dynamic";
export const metadata = { title: "Finance" };

export default async function FinancePage() {
  const s = await requirePage("finance.view");
  const repo = getRepo();
  const settings = getSettings();
  const today = todayIn(settings.business.timezone);
  const [payments, projects, estimates, components, costs, timesheets, variations] = await Promise.all([repo.list("payments"), repo.list("projects"), repo.list("estimates"), repo.list("components"), repo.list("actualCosts"), repo.list("timesheets"), repo.list("variations")]);
  const projName = new Map(projects.map((p) => [p.id, p.name]));
  const live = payments.filter((p) => !p.archived);
  const state = (p: (typeof live)[number]) => paymentState({ amount: p.amount ?? 0, received: p.status === "Paid" || p.receivedDate ? p.amount ?? 0 : 0, dueDate: p.dueDate ?? null }, today);
  const overdue = live.filter((p) => state(p) === "overdue");
  const dueSoon = live.filter((p) => state(p) === "due" && (p.dueDate ?? "") <= addDays(today, 14));
  const toRaise = live.filter((p) => state(p) === "scheduled");
  const monthStart = today.slice(0, 8) + "01";
  const receivedMonth = sumCents(live.filter((p) => p.status === "Paid" && (p.receivedDate ?? "") >= monthStart).map((p) => p.amount));
  const quoted = estimates.filter((e) => e.status === "Quoted");
  const wonMonth = estimates.filter((e) => e.status === "Accepted" && (e.acceptedDate ?? "") >= monthStart);
  const qb = await accounting().status();
  const canEdit = can(s.role, "finance.edit");
  const of = (pid: string) => <T extends { projectIds?: string[] }>(r: T[]) => r.filter((x) => x.projectIds?.includes(pid));
  const jobs = projects.filter((p) => ["In Progress", "Completed", "Accepted / Pre-start"].includes(p.status ?? "")).map((p) => ({ p, f: projectFinancials(p, of(p.id)(components), of(p.id)(costs), of(p.id)(timesheets), of(p.id)(variations), of(p.id)(payments), today, settings.pricing.gstRate) }));

  const PayRow = ({ p, tone }: { p: (typeof live)[number]; tone: "red" | "gold" | "stone" }) => (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
      <span><span className="font-medium">{p.title}</span><span className="block text-xs text-stone-500">{projName.get(p.projectIds?.[0] ?? "") ?? "No project"}{p.dueDate ? ` · due ${formatDate(p.dueDate)}` : ""}</span></span>
      <span className="flex flex-wrap items-center gap-2"><span className="font-semibold">{formatAud(p.amount ?? 0)}</span>
        {tone === "red" && <Chip tone="red">Overdue</Chip>}
        {canEdit && tone !== "stone" && <details className="relative"><summary className="btn-secondary !min-h-[36px] cursor-pointer list-none !px-3 text-xs">Mark received</summary><div className="absolute right-0 z-10 mt-1 w-72 rounded-xl border border-stone-200 bg-white p-3 shadow-card"><QuickForm endpoint={`/api/payments/${p.id}`} method="PATCH" extra={{ action: "received", confirm: true }} submitLabel={`Confirm ${formatAud(p.amount ?? 0)} received`} fields={[{ name: "receivedDate", label: "Date received", type: "date", required: true, defaultValue: today, full: true }, { name: "method", label: "Method", type: "select", required: true, defaultValue: "Bank Transfer", options: ["Bank Transfer", "Card", "Cash", "Cheque", "Other"], full: true }]} /></div></details>}
        {canEdit && tone === "stone" && <ActionButton endpoint={`/api/payments/${p.id}`} body={{ action: "raise" }} label="Raise now" confirmText={`Mark ${p.title} (${formatAud(p.amount ?? 0)}) as due in ${settings.payments.dueDays} days? ATLAS won't send an invoice; send it from your accounting system.`} />}
      </span>
    </li>
  );

  return (
    <>
      <PageHeader title="Finance" subtitle="Money owed, received and earned. Amounts are inc GST unless marked." />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Overdue" value={formatAud(sumCents(overdue.map((p) => p.amount)), { whole: true })} hint={`${overdue.length} payment(s)`} />
        <Stat label="Due in 14 days" value={formatAud(sumCents(dueSoon.map((p) => p.amount)), { whole: true })} hint={`${dueSoon.length} payment(s)`} />
        <Stat label="Received this month" value={formatAud(receivedMonth, { whole: true })} />
        <Stat label="Quotes awaiting answer" value={formatAud(sumCents(quoted.map((e) => e.customerTotalIncGst)), { whole: true })} hint={`${quoted.length} quote(s) · ${wonMonth.length} won this month`} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        <section className="card p-5"><h2 className="mb-2 font-semibold">Overdue and due soon</h2>
          {overdue.length + dueSoon.length === 0 ? <Empty title="Nothing overdue or due in the next 14 days" /> : <ul className="divide-y divide-stone-100">{overdue.map((p) => <PayRow key={p.id} p={p} tone="red" />)}{dueSoon.map((p) => <PayRow key={p.id} p={p} tone="gold" />)}</ul>}
        </section>
        <section className="card p-5"><h2 className="mb-2 font-semibold">Stages to raise at milestones</h2>
          {toRaise.length === 0 ? <Empty title="No stages waiting" /> : <ul className="divide-y divide-stone-100">{toRaise.map((p) => <PayRow key={p.id} p={p} tone="stone" />)}</ul>}
        </section>
        {can(s.role, "profit.view") && (
          <section className="card p-5 lg:col-span-2"><h2 className="mb-2 font-semibold">Job profitability</h2>
            {jobs.length === 0 ? <Empty title="No jobs underway or completed" /> : (
              <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-stone-500"><tr><th className="py-2">Project</th><th className="py-2 text-right">Contract inc GST</th><th className="py-2 text-right">Received</th><th className="py-2 text-right">Cost ex GST</th><th className="py-2 text-right">Est. cost</th><th className="py-2 text-right">Cost used</th><th className="py-2 text-right">Profit on finished work</th></tr></thead>
                <tbody className="divide-y divide-stone-100">{jobs.map(({ p, f }) => (
                  <tr key={p.id}><td className="py-2"><Link className="underline" href={`/projects/${p.id}`}>{p.name}</Link>{f.rollupStatus === "mismatch" && <span className="block text-xs text-gold-600">Component revenue doesn't match contract</span>}</td><td className="py-2 text-right">{formatAud(f.contract.current, { whole: true })}</td><td className="py-2 text-right">{formatAud(f.payments.received, { whole: true })}</td><td className="py-2 text-right">{formatAud(f.totalCost, { whole: true })}</td><td className="py-2 text-right">{formatAud(f.estimatedCost, { whole: true })}</td><td className={`py-2 text-right ${f.costUsed !== null && f.costUsed > 1 ? "text-red-700" : ""}`}>{f.costUsed === null ? "–" : formatPct(f.costUsed, 0)}</td><td className="py-2 text-right">{f.completedCount ? `${formatAud(f.completedProfit, { whole: true })} (${formatPct(f.completedRevenue ? f.completedProfit / f.completedRevenue : null)})` : "–"}</td></tr>
                ))}</tbody>
              </table></div>
            )}
            <p className="mt-2 text-xs text-stone-500">Cost used = recorded costs and submitted labour (ex GST) as a share of the estimated cost. Profit is only counted for components completed with final revenue, so work in progress never shows as profit.</p>
          </section>
        )}
        <section className="card p-5 lg:col-span-2"><h2 className="mb-1 font-semibold">QuickBooks</h2>
          <p className="text-sm"><Chip tone="stone">Not connected</Chip> <span className="ml-2 text-stone-600">{qb.detail}</span></p>
          <p className="mt-2 text-xs text-stone-500">ATLAS does not create invoices or read payments from QuickBooks yet. Mark payments received here after they land in the bank.</p>
        </section>
      </div>
    </>
  );
}
