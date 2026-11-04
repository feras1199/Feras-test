import Link from "next/link";
import { Chip, Empty, PageHeader, Stat, statusTone } from "@/components/ui";
import { buildToday } from "@/lib/domain/today";
import { formatAud, formatPct } from "@/lib/finance/money";
import { formatDate, todayIn } from "@/lib/dates";
import { getRepo, getSettings, requirePage } from "@/lib/server/context";

export const dynamic = "force-dynamic";
export const metadata = { title: "Today" };

const KIND_LABEL = { "follow-up": "Follow-up", task: "Task", payment: "Payment", enquiry: "New enquiry" } as const;

export default async function TodayPage() {
  const s = await requirePage("dashboard.view");
  const today = todayIn(getSettings().business.timezone);
  const t = await buildToday(getRepo(), s.role, today);
  const hour = Number(new Intl.DateTimeFormat("en-AU", { hour: "numeric", hourCycle: "h23", timeZone: getSettings().business.timezone }).format(new Date()));
  const greeting = `Good ${hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening"}, ${s.name.split(" ")[0]}`;

  return (
    <>
      <PageHeader title={greeting} subtitle={`${formatDate(today)} · what needs attention`} />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Needs action" value={t.items.length} hint={`${t.items.filter((i) => i.overdue).length} overdue`} />
        <Stat label="Open enquiries" value={t.counts.openEnquiries} />
        <Stat label="Active projects" value={t.counts.activeProjects} />
        {t.money ? <Stat label="Overdue payments" value={formatAud(t.money.overdueCents, { whole: true })} hint={`${formatAud(t.money.outstandingCents, { whole: true })} outstanding in total`} /> : <Stat label="Open tasks" value={t.counts.openTasks} />}
      </div>

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold text-forest-900">Action list</h2>
        {t.items.length === 0 ? (
          <Empty title="Nothing due today">No follow-ups, tasks or payments are due or overdue.</Empty>
        ) : (
          <ul className="card divide-y divide-stone-100">
            {t.items.map((i) => (
              <li key={i.kind + i.id} className="flex items-center gap-3 p-4">
                <Chip tone={i.overdue ? "red" : i.kind === "enquiry" ? "blue" : "gold"}>{KIND_LABEL[i.kind]}</Chip>
                <div className="min-w-0 flex-1">
                  {i.href !== "#" ? <Link href={i.href} className="block truncate font-medium hover:underline">{i.title}</Link> : <span className="block truncate font-medium">{i.title}</span>}
                  <p className="truncate text-sm text-stone-600">{i.detail}</p>
                </div>
                <div className={`shrink-0 text-right text-xs ${i.overdue ? "font-semibold text-red-700" : "text-stone-500"}`}>{i.overdue ? "Overdue · " : ""}{formatDate(i.due)}</div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-forest-900">Active projects</h2>
        {t.activeProjects.length === 0 ? (
          <Empty title="No active projects" />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 [&>*]:min-w-0">
            {t.activeProjects.map((p) => (
              <div key={p.id} className="card p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium">{p.name}</p>
                  {p.health && <Chip tone={statusTone(p.health)}>{p.health}</Chip>}
                </div>
                {typeof p.progress === "number" && (
                  <div className="mt-3">
                    <div className="h-2 rounded-full bg-stone-100"><div className="h-2 rounded-full bg-forest-500" style={{ width: `${Math.min(100, p.progress * 100)}%` }} /></div>
                    <p className="mt-1 text-xs text-stone-500">{formatPct(p.progress, 0)} complete (as recorded)</p>
                  </div>
                )}
                {p.nextAction && <p className="mt-2 text-sm text-stone-700">Next: {p.nextAction}{p.nextActionDate ? ` · ${formatDate(p.nextActionDate)}` : ""}</p>}
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
