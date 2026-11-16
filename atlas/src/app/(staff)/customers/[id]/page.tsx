import { ContactButtons } from "@/components/ContactButtons";
import { notFound } from "next/navigation";
import { Chip, Empty, PageHeader, statusTone } from "@/components/ui";
import { CustomerForm } from "@/components/CustomerForm";
import { formatDate } from "@/lib/dates";
import { formatAud } from "@/lib/finance/money";
import { can } from "@/lib/auth/roles";
import { getRepo, requirePage } from "@/lib/server/context";
import { loadSuggestions } from "@/lib/server/suggestions";
import { DeleteButton } from "@/components/DeleteButton";
import { formatTime } from "@/lib/domain/inspections";

export const dynamic = "force-dynamic";

export default async function CustomerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ edit?: string }> }) {
  const s = await requirePage("crm.view");
  const { id } = await params;
  const { edit } = await searchParams;
  const repo = getRepo();
  const c = await repo.get("customers", id);
  if (!c) notFound();
  const linked = <T extends { customerIds?: string[] }>(rows: T[]) => rows.filter((r) => r.customerIds?.includes(id));
  const [enquiries, projects, estimates, comms, inspections, tasks] = await Promise.all([
    repo.list("enquiries").then(linked),
    repo.list("projects").then(linked),
    can(s.role, "estimates.view") ? repo.list("estimates").then(linked) : Promise.resolve([]),
    repo.list("communications").then(linked).then((r) => r.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""))),
    can(s.role, "inspections.view") ? repo.list("inspections").then(linked).then((r) => r.sort((a, b) => (b.inspectionDate ?? "").localeCompare(a.inspectionDate ?? ""))) : Promise.resolve([]),
    repo.list("tasks").then(linked).then((r) => r.filter((t) => !["Done", "Cancelled"].includes(t.status ?? "")).sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"))),
  ]);
  const editable = can(s.role, "crm.edit");

  if (edit === "1" && editable) {
    return (
      <>
        <PageHeader title={`Edit ${c.name}`} />
        <CustomerForm id={c.id} initial={{ name: c.name ?? "", phone: c.phone ?? "", email: c.email ?? "", address: c.address ?? "", suburb: c.suburb ?? "", preferredContact: c.preferredContact ?? "", customerType: c.customerType ?? "", leadSource: c.leadSource ?? "", serviceRequested: c.serviceRequested ?? "" }} suggest={await loadSuggestions(repo, ["suburbs", "services"])} />
      </>
    );
  }

  return (
    <>
      <PageHeader title={c.name ?? "Customer"} subtitle={[c.suburb, c.customerType, c.leadSource && `via ${c.leadSource}`].filter(Boolean).join(" · ")} actions={editable && (<><a href="?edit=1" className="btn-secondary">Edit details</a><a href={`/tasks/new?customer=${c.id}`} className="btn-secondary">Add task</a><a href={`/pipeline/new?customer=${c.id}`} className="btn-secondary">New enquiry</a>{can(s.role, "inspections.edit") && <a href={`/inspections/new?customer=${c.id}`} className="btn-secondary">Book inspection</a>}{can(s.role, "estimates.edit") && <a href={`/estimates/new?customer=${c.id}`} className="btn-primary">New estimate</a>}{can(s.role, "records.delete") && <DeleteButton entity="customers" id={c.id} noun="customer" />}</>)} />
      {c.doNotContact && <p className="mb-4 rounded-xl bg-red-50 p-3 text-sm font-medium text-red-800">Do not contact this customer.</p>}
      <div className="grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
        <section className="card p-5 lg:col-span-1">
          <h2 className="mb-3 font-semibold">Contact</h2>
          <dl className="space-y-2 text-sm">
            <div><dt className="text-stone-500">Phone</dt><dd>{c.phone ? <a className="text-forest-700 underline" href={`tel:${c.phone.replace(/\s/g, "")}`}>{c.phone}</a> : "–"}</dd></div>
            <div><dt className="text-stone-500">Email</dt><dd className="break-all">{c.email ? <a className="text-forest-700 underline" href={`mailto:${c.email}`}>{c.email}</a> : "–"}</dd></div>
            <div><dt className="text-stone-500">Address</dt><dd>{[c.address, c.suburb].filter(Boolean).join(", ") || "–"}</dd></div>
            <div><dt className="text-stone-500">Prefers</dt><dd>{c.preferredContact ?? "–"}</dd></div>
            <div><dt className="text-stone-500">Status</dt><dd>{c.leadStatus ? <Chip tone={statusTone(c.leadStatus)}>{c.leadStatus}</Chip> : "–"}</dd></div>
            <div><dt className="text-stone-500">Next follow-up</dt><dd>{formatDate(c.nextFollowUp)}{c.nextFollowUpAction ? ` · ${c.nextFollowUpAction}` : ""}</dd></div>
          </dl>
          <div className="mt-4"><ContactButtons phone={c.phone} email={c.email} address={c.address} suburb={c.suburb} doNotContact={!!c.doNotContact} /></div>
          {c.serviceRequested && <p className="mt-4 rounded-lg bg-stone-50 p-3 text-sm">{c.serviceRequested}</p>}
        </section>
        <div className="space-y-4 lg:col-span-2">
          <section className="card p-5">
            <h2 className="mb-3 font-semibold">Enquiries</h2>
            {enquiries.length === 0 ? <Empty title="No enquiries recorded" /> : (
              <ul className="divide-y divide-stone-100">{enquiries.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"><span>{e.title}</span><span className="flex items-center gap-2">{e.status && <Chip tone={statusTone(e.status)}>{e.status}</Chip>}<span className="text-stone-500">{formatDate(e.enquiryDate)}</span></span></li>
              ))}</ul>
            )}
          </section>
          {can(s.role, "estimates.view") && (
            <section className="card p-5">
              <h2 className="mb-3 font-semibold">Quotes and estimates</h2>
              {estimates.length === 0 ? <Empty title="No estimates yet" /> : (
                <ul className="divide-y divide-stone-100">{estimates.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"><a href={`/estimates/${e.id}`} className="text-forest-800 underline">{e.title}</a><span className="flex items-center gap-2">{e.status && <Chip tone={statusTone(e.status)}>{e.status}</Chip>}<span className="font-medium">{typeof e.customerTotalIncGst === "number" ? `${formatAud(e.customerTotalIncGst)} inc GST` : "–"}</span></span></li>
                ))}</ul>
              )}
            </section>
          )}
          {can(s.role, "inspections.view") && (
            <section className="card p-5">
              <h2 className="mb-3 font-semibold">Site inspections</h2>
              {inspections.length === 0 ? <Empty title="No site inspections yet" /> : (
                <ul className="divide-y divide-stone-100">{inspections.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"><a href={`/inspections/${i.id}`} className="text-forest-800 underline">{formatDate(i.inspectionDate)}{i.inspectionTime ? `, ${formatTime(i.inspectionTime)}` : ""}{i.siteAddress ? ` · ${i.siteAddress}` : ""}</a>{i.complete ? <Chip tone="green">Complete</Chip> : <Chip tone="gold">Booked</Chip>}</li>
                ))}</ul>
              )}
            </section>
          )}
          <section className="card p-5">
            <h2 className="mb-3 font-semibold">Open tasks</h2>
            {tasks.length === 0 ? <Empty title="No open tasks" /> : (
              <ul className="divide-y divide-stone-100">{tasks.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"><a href={`/tasks/${t.id}`} className="text-forest-800 underline">{t.title}</a><span className="flex items-center gap-2">{t.status && <Chip tone={statusTone(t.status)}>{t.status}</Chip>}<span className="text-stone-500">{t.dueDate ? formatDate(t.dueDate) : "No due date"}</span></span></li>
              ))}</ul>
            )}
          </section>
          <section className="card p-5">
            <h2 className="mb-3 font-semibold">Contact history</h2>
            {comms.length === 0 ? <Empty title="No contact logged">Log calls and messages from the enquiry card in the Pipeline.</Empty> : (
              <ul className="divide-y divide-stone-100">{comms.slice(0, 20).map((m) => (
                <li key={m.id} className="py-2 text-sm"><div className="flex flex-wrap justify-between gap-2"><span className="font-medium">{m.channel} · {m.direction}</span><span className="text-stone-500">{formatDate(m.at)}{m.loggedBy ? ` · ${m.loggedBy}` : ""}</span></div>{m.message && <p className="text-stone-700">{m.message}</p>}</li>
              ))}</ul>
            )}
          </section>
          <section className="card p-5">
            <h2 className="mb-3 font-semibold">Projects</h2>
            {projects.length === 0 ? <Empty title="No projects yet" /> : (
              <ul className="divide-y divide-stone-100">{projects.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"><a href={`/projects/${p.id}`} className="text-forest-800 underline">{p.name}</a>{p.status && <Chip tone={statusTone(p.status)}>{p.status}</Chip>}</li>
              ))}</ul>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
