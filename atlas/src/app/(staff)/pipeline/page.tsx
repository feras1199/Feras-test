import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { Pipeline, type Card } from "@/components/crm/Pipeline";
import { enquiryFlags, PIPELINE, isOpen } from "@/lib/domain/crm";
import { todayIn } from "@/lib/dates";
import { can } from "@/lib/auth/roles";
import { getRepo, getSettings, requirePage } from "@/lib/server/context";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pipeline" };

export default async function PipelinePage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const s = await requirePage("crm.view");
  const { show } = await searchParams;
  const today = todayIn(getSettings().business.timezone);
  const repo = getRepo();
  const [enquiries, customers] = await Promise.all([repo.list("enquiries"), repo.list("customers")]);
  const byId = new Map(customers.map((c) => [c.id, c]));
  const closed = show === "closed";
  const cards: Card[] = enquiries
    .filter((e) => (closed ? !isOpen(e.status) : isOpen(e.status)))
    .map((e) => {
      const c = byId.get(e.customerIds?.[0] ?? "");
      return {
        id: e.id,
        title: e.title ?? "Enquiry",
        customerId: c?.id ?? null,
        customerName: c?.name ?? "No customer linked",
        phone: c?.phone ?? null,
        suburb: c?.suburb ?? null,
        status: e.status ?? "New Enquiry",
        service: e.serviceRequested ?? null,
        budget: e.budget ?? null,
        nextFollowUp: e.nextFollowUp ?? null,
        nextAction: e.nextAction ?? null,
        assignedTo: e.assignedTo ?? null,
        reason: e.reasonWonLost ?? null,
        flags: enquiryFlags(e, today),
      };
    });
  const columns = closed ? ["Won", "Lost", "On Hold"].map((x) => ({ status: x, label: x })) : PIPELINE.map((p) => ({ status: p.status, label: p.label }));
  const atRisk = cards.filter((c) => c.flags.length).length;
  return (
    <>
      <PageHeader
        title="Pipeline"
        subtitle={closed ? `${cards.length} closed or on hold` : `${cards.length} open enquiries · ${atRisk} need attention`}
        actions={
          <>
            <Link href={closed ? "/pipeline" : "/pipeline?show=closed"} className="btn-secondary">{closed ? "Show open" : "Won, lost, on hold"}</Link>
            {can(s.role, "crm.edit") && <Link href="/pipeline/new" className="btn-primary">New enquiry</Link>}
          </>
        }
      />
      <Pipeline columns={columns} cards={cards} canEdit={can(s.role, "crm.edit")} today={today} />
    </>
  );
}
