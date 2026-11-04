import Link from "next/link";
import { Chip, Empty, PageHeader, statusTone } from "@/components/ui";
import { formatDate } from "@/lib/dates";
import { getRepo, requirePage } from "@/lib/server/context";
import { can } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";
export const metadata = { title: "Customers" };

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const s = await requirePage("crm.view");
  const { q = "" } = await searchParams;
  const needle = q.trim().toLowerCase();
  const rows = (await getRepo().list("customers", { sort: (a, b) => (b.enquiryDate ?? "").localeCompare(a.enquiryDate ?? "") })).filter(
    (c) => !needle || [c.name, c.email, c.phone, c.suburb].some((v) => v?.toLowerCase().includes(needle)),
  );
  return (
    <>
      <PageHeader title="Customers" subtitle={`${rows.length} ${needle ? "matching" : "in total"}`} actions={can(s.role, "crm.edit") && <Link href="/customers/new" className="btn-primary">New customer</Link>} />
      <form className="mb-4" role="search">
        <label htmlFor="cq" className="sr-only">Filter customers</label>
        <input id="cq" name="q" defaultValue={q} placeholder="Filter by name, email, phone or suburb" className="input max-w-md" />
      </form>
      {rows.length === 0 ? (
        <Empty title={needle ? "No customers match" : "No customers yet"} action={can(s.role, "crm.edit") ? { href: "/customers/new", label: "Add the first customer" } : undefined} />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="hidden bg-stone-50 text-xs uppercase tracking-wide text-stone-500 sm:table-header-group">
              <tr><th className="p-3">Name</th><th className="p-3">Contact</th><th className="p-3">Suburb</th><th className="p-3">Status</th><th className="p-3">Next follow-up</th></tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {rows.map((c) => (
                <tr key={c.id} className="block p-3 sm:table-row sm:p-0">
                  <td className="block sm:table-cell sm:p-3"><Link href={`/customers/${c.id}`} className="font-medium text-forest-800 hover:underline">{c.name || "(no name)"}</Link></td>
                  <td className="block text-stone-600 sm:table-cell sm:p-3">{[c.phone, c.email].filter(Boolean).join(" · ") || "–"}</td>
                  <td className="hidden sm:table-cell sm:p-3">{c.suburb || "–"}</td>
                  <td className="block pt-1 sm:table-cell sm:p-3">{c.leadStatus ? <Chip tone={statusTone(c.leadStatus)}>{c.leadStatus}</Chip> : "–"}</td>
                  <td className="hidden sm:table-cell sm:p-3">{formatDate(c.nextFollowUp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
