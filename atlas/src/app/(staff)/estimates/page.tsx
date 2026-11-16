import Link from "next/link";
import { Chip, Empty, PageHeader, statusTone } from "@/components/ui";
import { formatAud } from "@/lib/finance/money";
import { formatDate } from "@/lib/dates";
import { can } from "@/lib/auth/roles";
import { getRepo, requirePage } from "@/lib/server/context";

export const dynamic = "force-dynamic";
export const metadata = { title: "Estimates" };

const ORDER = ["Draft", "Ready", "Quoted", "Accepted", "Declined", "Superseded"];

export default async function EstimatesPage() {
  const s = await requirePage("estimates.view");
  const repo = getRepo();
  const [rows, customers] = await Promise.all([repo.list("estimates"), repo.list("customers")]);
  const names = new Map(customers.map((c) => [c.id, c.name]));
  rows.sort((a, b) => ORDER.indexOf(a.status ?? "") - ORDER.indexOf(b.status ?? "") || (b.estimateDate ?? "").localeCompare(a.estimateDate ?? ""));
  return (
    <>
      <PageHeader title="Estimates and quotes" subtitle={`${rows.filter((r) => r.status === "Quoted").length} awaiting the customer · ${rows.filter((r) => r.status === "Draft").length} in draft`} actions={can(s.role, "estimates.edit") && <Link href="/estimates/new" className="btn-primary">New estimate</Link>} />
      {rows.length === 0 ? <Empty title="No estimates yet" action={can(s.role, "estimates.edit") ? { href: "/estimates/new", label: "Start the first estimate" } : undefined} /> : (
        <ul className="card divide-y divide-stone-100">
          {rows.map((e) => (
            <li key={e.id}>
              <Link href={`/estimates/${e.id}`} className="flex flex-wrap items-center gap-3 p-4 hover:bg-stone-50">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{e.title}</p>
                  <p className="text-xs text-stone-500">{names.get(e.customerIds?.[0] ?? "") ?? "No customer"} · {formatDate(e.estimateDate)}{e.validUntil && e.status === "Quoted" ? ` · valid until ${formatDate(e.validUntil)}` : ""}</p>
                </div>
                <span className="text-sm font-semibold">{typeof e.customerTotalIncGst === "number" ? `${formatAud(e.customerTotalIncGst)} inc GST` : "Not priced"}</span>
                <Chip tone={statusTone(e.status)}>{e.status ?? "Draft"}</Chip>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
