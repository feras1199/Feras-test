import Link from "next/link";
import { Chip, Empty, PageHeader } from "@/components/ui";
import { formatDate } from "@/lib/dates";
import { can } from "@/lib/auth/roles";
import { getRepo, requirePage } from "@/lib/server/context";

export const dynamic = "force-dynamic";
export const metadata = { title: "Site inspections" };

export default async function InspectionsPage() {
  const s = await requirePage("inspections.view");
  const rows = (await getRepo().list("inspections")).sort((a, b) => (b.inspectionDate ?? "").localeCompare(a.inspectionDate ?? ""));
  return (
    <>
      <PageHeader title="Site inspections" subtitle={`${rows.filter((r) => !r.complete).length} not yet complete`} actions={can(s.role, "inspections.edit") && <Link href="/inspections/new" className="btn-primary">Book inspection</Link>} />
      {rows.length === 0 ? <Empty title="No inspections yet" /> : (
        <ul className="card divide-y divide-stone-100">
          {rows.map((r) => (
            <li key={r.id}><Link href={`/inspections/${r.id}`} className="flex flex-wrap items-center gap-3 p-4 hover:bg-stone-50">
              <div className="min-w-0 flex-1"><p className="truncate font-medium">{r.title}</p><p className="text-xs text-stone-500">{r.siteAddress || "No address"} · {r.measurementIds?.length ?? 0} measurements</p></div>
              <span className="text-sm text-stone-600">{formatDate(r.inspectionDate)}</span>
              <Chip tone={r.complete ? "green" : "gold"}>{r.complete ? "Complete" : "Open"}</Chip>
            </Link></li>
          ))}
        </ul>
      )}
    </>
  );
}
