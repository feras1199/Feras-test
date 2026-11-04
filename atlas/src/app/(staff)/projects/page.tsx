import Link from "next/link";
import { Chip, Empty, PageHeader, statusTone } from "@/components/ui";
import { formatAud, formatPct } from "@/lib/finance/money";
import { formatDate } from "@/lib/dates";
import { can } from "@/lib/auth/roles";
import { getRepo, requirePage } from "@/lib/server/context";

export const dynamic = "force-dynamic";
export const metadata = { title: "Projects" };

const ACTIVE = ["Accepted / Pre-start", "In Progress", "On Hold"];

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const s = await requirePage("projects.view");
  const { show } = await searchParams;
  const all = await getRepo().list("projects");
  const staffOnly = !can(s.role, "crm.view"); // workers and supervisors-only see live jobs
  const rows = all.filter((p) => (show === "all" && !staffOnly ? true : ACTIVE.includes(p.status ?? ""))).sort((a, b) => ACTIVE.indexOf(a.status ?? "") - ACTIVE.indexOf(b.status ?? "") || (a.startDate ?? "").localeCompare(b.startDate ?? ""));
  const money = can(s.role, "finance.view");
  return (
    <>
      <PageHeader title="Projects" subtitle={`${rows.length} ${show === "all" ? "in total" : "active"}`} actions={!staffOnly && <Link href={show === "all" ? "/projects" : "/projects?show=all"} className="btn-secondary">{show === "all" ? "Active only" : "Show all"}</Link>} />
      {rows.length === 0 ? <Empty title="No active projects">Projects are created when a customer accepts a quote.</Empty> : (
        <div className="grid gap-3 md:grid-cols-2 [&>*]:min-w-0">
          {rows.map((p) => (
            <Link key={p.id} href={`/projects/${p.id}`} className="card block p-4 transition hover:border-forest-300">
              <div className="flex items-start justify-between gap-2"><p className="font-semibold">{p.name}</p><Chip tone={statusTone(p.status)}>{p.status}</Chip></div>
              <p className="mt-1 text-sm text-stone-600">{[p.suburb, p.startDate && `Start ${formatDate(p.startDate)}`, p.completionDate && `Finish ${formatDate(p.completionDate)}`].filter(Boolean).join(" · ")}</p>
              {typeof p.progress === "number" && <div className="mt-3 h-2 rounded-full bg-stone-100"><div className="h-2 rounded-full bg-forest-500" style={{ width: `${Math.min(100, p.progress * 100)}%` }} /></div>}
              <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-stone-600">
                <span>{typeof p.progress === "number" ? `${formatPct(p.progress, 0)} complete` : "Progress not recorded"}{p.health ? ` · ${p.health}` : ""}</span>
                {money && typeof p.estValue === "number" && <span className="font-medium text-forest-900">{formatAud(p.estValue, { whole: true })} inc GST</span>}
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
