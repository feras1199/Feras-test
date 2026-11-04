import { Empty, PageHeader } from "@/components/ui";
import { recentAudit } from "@/lib/server/audit";
import { requirePage } from "@/lib/server/context";

export const dynamic = "force-dynamic";
export const metadata = { title: "Audit log" };

export default async function AuditPage() {
  await requirePage("audit.view");
  const { rows, stored } = await recentAudit();
  return (
    <>
      <PageHeader title="Audit log" subtitle={stored ? "Sign-ins and every change made through ATLAS, newest first. Kept permanently in the ATLAS database." : "Sign-ins and every change made through ATLAS since the server last started. Entries are also written to the server log."} />
      {rows.length === 0 ? <Empty title="No activity recorded yet" /> : (
        <ul className="card divide-y divide-stone-100">
          {rows.map((r, i) => (
            <li key={i} className="p-3 text-sm">
              <div className="flex flex-wrap justify-between gap-2"><span className="font-medium">{r.summary}</span><time className="text-stone-500">{new Date(r.at).toLocaleString("en-AU", { timeZone: "Australia/Sydney" })}</time></div>
              <div className="text-xs text-stone-500">{r.userName} · {r.role} · {r.action}{r.recordId ? ` · ${r.recordId}` : ""}</div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
