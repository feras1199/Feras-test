import { notFound } from "next/navigation";
import Link from "next/link";
import { Chip, Empty, PageHeader, Stat, statusTone } from "@/components/ui";
import { QuickForm, ActionButton } from "@/components/QuickForm";
import { ProjectStatusForm } from "@/components/projects/ProjectStatusForm";
import { formatAud, formatPct } from "@/lib/finance/money";
import { formatDate, formatTime, todayIn } from "@/lib/dates";
import { actualCostExGst, projectFinancials, timesheetCost, COST_TYPES } from "@/lib/domain/projects";
import { can } from "@/lib/auth/roles";
import { getRepo, getSettings, requirePage } from "@/lib/server/context";

export const dynamic = "force-dynamic";

const STAGES = ["Pre-start", "Set-out", "Construction", "Quality Check", "Completion", "Handover"];

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requirePage("projects.view");
  const { id } = await params;
  const repo = getRepo();
  const p = await repo.get("projects", id);
  if (!p) notFound();
  const of = { where: (r: { projectIds?: string[] }) => !!r.projectIds?.includes(id) };
  const [components, costs, timesheets, variations, payments, schedule, checklists, customer] = await Promise.all([
    repo.list("components", of), repo.list("actualCosts", of), repo.list("timesheets", of), repo.list("variations", of), repo.list("payments", of), repo.list("schedule", of), repo.list("checklists", of),
    p.customerIds?.[0] ? repo.get("customers", p.customerIds[0]) : null,
  ]);
  const settings = getSettings();
  const today = todayIn(settings.business.timezone);
  const fin = projectFinancials(p, components, costs, timesheets, variations, payments, today, settings.pricing.gstRate);
  const costsV = can(s.role, "costs.view"), profitV = can(s.role, "profit.view"), financeV = can(s.role, "finance.view");
  const live = ["In Progress", "Accepted / Pre-start"].includes(p.status ?? "");
  const compOptions = components.map((c) => ({ value: c.id, label: String(c.label ?? c.componentType).split("·").pop()!.trim() }));
  schedule.sort((a, b) => (a.plannedStart ?? "").localeCompare(b.plannedStart ?? ""));
  const myTime = timesheets.filter((t) => costsV || t.staffName === s.name).sort((a, b) => (b.workDate ?? "").localeCompare(a.workDate ?? ""));

  return (
    <>
      <PageHeader title={p.name ?? "Project"} subtitle={[customer?.name, p.siteAddress, p.suburb].filter(Boolean).join(" · ")} actions={<><Chip tone={statusTone(p.status)}>{p.status}</Chip>{p.health && <Chip tone={statusTone(p.health)}>{p.health}</Chip>}</>} />

      {financeV && (
        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Contract (inc GST)" value={formatAud(fin.contract.current, { whole: true })} hint={fin.contract.pendingVariations ? `+${formatAud(fin.contract.pendingVariations, { whole: true })} awaiting approval` : fin.contract.approvedVariations ? `incl. ${formatAud(fin.contract.approvedVariations, { whole: true })} variations` : undefined} />
          <Stat label="Received" value={formatAud(fin.payments.received, { whole: true })} hint={`${formatAud(fin.payments.outstanding, { whole: true })} still to come`} />
          <Stat label="Actual cost (ex GST)" value={formatAud(fin.totalCost, { whole: true })} hint={`${fin.costUsed === null ? "No estimate" : `${formatPct(fin.costUsed, 0)} of the ${formatAud(fin.estimatedCost, { whole: true })} estimate`}`} />
          {profitV && <Stat label="Profit on finished work" value={fin.completedCount ? formatAud(fin.completedProfit, { whole: true }) : "–"} hint={fin.completedCount ? `${formatPct(fin.completedRevenue ? fin.completedProfit / fin.completedRevenue : null)} margin on ${fin.completedCount} completed component(s)` : "No component completed with final revenue yet"} />}
        </div>
      )}
      {costsV && (fin.duplicates.length > 0 || fin.unallocatedCost > 0 || fin.unsubmittedTimesheets > 0 || fin.payments.overdue > 0) && (
        <section className="mb-6 rounded-2xl border border-gold-500 bg-gold-300/20 p-4 text-sm">
          <h2 className="mb-1 font-semibold">Needs attention</h2>
          <ul className="list-inside list-disc space-y-0.5">
            {fin.payments.overdue > 0 && financeV && <li>{formatAud(fin.payments.overdue)} in payments overdue</li>}
            {fin.unallocatedCost > 0 && <li>{formatAud(fin.unallocatedCost)} of costs not allocated to a component</li>}
            {fin.duplicates.length > 0 && <li>{fin.duplicates.length} possible duplicate cost entr{fin.duplicates.length === 1 ? "y" : "ies"}</li>}
            {fin.unsubmittedTimesheets > 0 && <li>{fin.unsubmittedTimesheets} timesheet(s) not submitted, so not counted in actual cost</li>}
          </ul>
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        <section className="card p-5">
          <h2 className="mb-3 font-semibold">Status and next step</h2>
          {can(s.role, "projects.edit") ? <ProjectStatusForm project={{ id: p.id, status: p.status ?? "", health: p.health ?? "", progress: p.progress ?? 0, nextAction: p.nextAction ?? "", nextActionDate: p.nextActionDate ?? "", startDate: p.startDate ?? "", completionDate: p.completionDate ?? "" }} /> : (
            <dl className="space-y-1 text-sm"><div>Progress: {formatPct(p.progress ?? 0, 0)}</div><div>Next: {p.nextAction ?? "–"} {p.nextActionDate ? `(${formatDate(p.nextActionDate)})` : ""}</div></dl>
          )}
          {can(s.role, "projects.edit") && <details className="mt-4"><summary className="cursor-pointer text-sm font-medium text-forest-700">Post an update to the customer portal</summary><div className="mt-3"><QuickForm endpoint={`/api/projects/${p.id}/updates`} submitLabel="Publish to portal" fields={[{ name: "summary", label: "What happened (the customer sees this)", type: "textarea", required: true }, { name: "nextSteps", label: "What's next", type: "text", full: true }]} /><p className="mt-1 text-xs text-stone-500">Shows in the customer's portal. It isn't emailed.</p></div></details>}
          {(p.siteAccessNotes || p.crewNotes) && <div className="mt-4 space-y-2 rounded-xl bg-stone-50 p-3 text-sm">{p.siteAccessNotes && <p><span className="font-medium">Site access:</span> {p.siteAccessNotes}</p>}{p.crewNotes && <p><span className="font-medium">Crew notes:</span> {p.crewNotes}</p>}</div>}
        </section>

        <section className="card p-5">
          <h2 className="mb-3 font-semibold">Schedule</h2>
          {schedule.length === 0 ? <p className="text-sm text-stone-500">Nothing scheduled yet.</p> : (
            <ul className="mb-4 divide-y divide-stone-100 text-sm">{schedule.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><span><span className="font-medium">{x.title}</span><span className="block text-xs text-stone-500">{x.type} · {formatDate(x.plannedStart)}{x.plannedFinish && x.plannedFinish !== x.plannedStart ? ` – ${formatDate(x.plannedFinish)}` : ""}{x.assignedTo ? ` · ${x.assignedTo}` : ""}</span></span>
                <span className="flex items-center gap-2"><Chip tone={statusTone(x.status)}>{x.status}</Chip>{can(s.role, "schedule.edit") && x.status !== "Completed" && <ActionButton endpoint={`/api/schedule/${x.id}`} body={{ status: x.status === "In Progress" ? "Completed" : "In Progress" }} label={x.status === "In Progress" ? "Done" : "Start"} />}</span></li>
            ))}</ul>
          )}
          {can(s.role, "schedule.edit") && <details><summary className="cursor-pointer text-sm font-medium text-forest-700">Add to schedule</summary><div className="mt-3"><QuickForm endpoint={`/api/projects/${p.id}/schedule`} submitLabel="Add" fields={[{ name: "title", label: "What", type: "text", required: true, full: true }, { name: "type", label: "Type", type: "select", required: true, defaultValue: "Work", options: ["Work", "Milestone", "Site Visit", "Material Delivery", "Inspection", "Client Meeting", "Payment", "Other"] }, { name: "assignedTo", label: "Who", type: "text" }, { name: "plannedStart", label: "Start", type: "date", required: true }, { name: "plannedFinish", label: "Finish", type: "date" }, { name: "customerVisible", label: "Show to customer", type: "checkbox" }]} /></div></details>}
        </section>

        <section className="card p-5">
          <h2 className="mb-3 font-semibold">Checklists</h2>
          {checklists.length === 0 ? (
            <>{can(s.role, "checklists.edit") && can(s.role, "projects.edit") ? <ActionButton endpoint={`/api/projects/${p.id}/checklists`} method="POST" body={{ template: true }} label="Add the standard job checklist" className="btn-secondary" /> : <p className="text-sm text-stone-500">No checklist yet.</p>}</>
          ) : STAGES.filter((st) => checklists.some((c) => c.stage === st)).map((st) => (
            <div key={st} className="mb-3"><p className="text-xs font-semibold uppercase tracking-wide text-stone-500">{st}</p>
              <ul className="mt-1 space-y-1">{checklists.filter((c) => c.stage === st).map((c) => (
                <li key={c.id} className="flex items-center gap-2 text-sm">
                  {can(s.role, "checklists.edit") ? <ActionButton endpoint={`/api/checklists/${c.id}`} body={{ completed: !c.completed }} label={c.completed ? "✓" : " "} ariaLabel={`${c.completed ? "Untick" : "Tick"} ${c.title}`} className={`flex h-6 w-6 shrink-0 items-center justify-center rounded border-2 text-xs ${c.completed ? "border-forest-600 bg-forest-600 text-white" : "border-stone-400"}`} /> : <span>{c.completed ? "✓" : "○"}</span>}
                  <span className={c.completed ? "text-stone-400 line-through" : ""}>{c.title}</span>{c.completedBy && <span className="text-xs text-stone-400">{c.completedBy}</span>}
                </li>
              ))}</ul></div>
          ))}
        </section>

        <section className="card p-5">
          <h2 className="mb-3 font-semibold">Time on this job</h2>
          {myTime.length === 0 ? <p className="mb-3 text-sm text-stone-500">No time logged.</p> : (
            <ul className="mb-4 divide-y divide-stone-100 text-sm">{myTime.slice(0, 10).map((t) => { const c = timesheetCost(t); return (
              <li key={t.id} className="flex justify-between gap-2 py-2"><span>{t.staffName} · {formatDate(t.workDate)}<span className="block text-xs text-stone-500">{formatTime(t.start)}–{formatTime(t.finish)} · crew {t.crewSize ?? 1} · {t.workType}{t.submitted ? "" : " · not submitted"}</span></span><span className="text-right">{c.personHours} h{costsV && <span className="block text-xs text-stone-500">{formatAud(c.cost)}</span>}</span></li>
            ); })}</ul>
          )}
          {live && can(s.role, "timesheets.submit") && <details open={!costsV}><summary className="cursor-pointer text-sm font-medium text-forest-700">Log time</summary><div className="mt-3"><QuickForm endpoint="/api/timesheets" extra={{ projectId: p.id }} submitLabel="Submit time" fields={[{ name: "workDate", label: "Date", type: "date", required: true, defaultValue: today }, { name: "componentId", label: "Part of the job", type: "select", options: compOptions }, { name: "startTime", label: "Start", type: "time", required: true, defaultValue: "07:00" }, { name: "finishTime", label: "Finish", type: "time", required: true, defaultValue: "15:30" }, { name: "breakMinutes", label: "Break (minutes)", type: "int", defaultValue: "30" }, { name: "crewSize", label: "People in crew", type: "int", defaultValue: "1" }, { name: "workType", label: "Work type", type: "select", defaultValue: "Construction", required: true, options: ["Construction", "Travel / Pickup", "Site Setup", "Rework", "Variation", "Management / Supervision", "Other"] }, { name: "reworkReason", label: "If rework, why?", type: "text" }, { name: "notes", label: "Notes", type: "textarea" }]} /></div></details>}
        </section>

        {costsV && (
          <section className="card p-5 lg:col-span-2">
            <h2 className="mb-3 font-semibold">Components: estimate vs actual</h2>
            {fin.components.length === 0 ? <Empty title="No components">Components come from the accepted estimate or Airtable.</Empty> : (
              <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-stone-500"><tr><th className="py-2">Component</th><th className="py-2 text-right">Revenue ex GST</th><th className="py-2 text-right">Est. cost</th><th className="py-2 text-right">Actual cost</th><th className="py-2 text-right">Hours</th>{profitV && <th className="py-2 text-right">Profit</th>}</tr></thead>
                <tbody className="divide-y divide-stone-100">{fin.components.map((c) => (
                  <tr key={c.id}><td className="py-2">{c.name}{c.issues.length > 0 && <span className="block text-xs text-gold-600">{c.issues.join("; ")}</span>}</td><td className="py-2 text-right">{formatAud(c.revenue, { whole: true })}{!c.revenueIsFinal && <span className="block text-xs text-stone-500">quoted</span>}</td><td className="py-2 text-right">{formatAud(c.estimatedCost, { whole: true })}</td><td className={`py-2 text-right ${c.costVariance > 0 ? "text-red-700" : ""}`}>{formatAud(c.reconciledCost, { whole: true })}</td><td className="py-2 text-right">{c.reconciledPersonHours}</td>{profitV && <td className="py-2 text-right">{c.actualProfit === null ? <span className="text-xs text-stone-500">not final</span> : `${formatAud(c.actualProfit, { whole: true })} (${formatPct(c.actualMargin)})`}</td>}</tr>
                ))}</tbody>
              </table></div>
            )}
          </section>
        )}

        {can(s.role, "costs.create") && (
          <section className="card p-5">
            <h2 className="mb-3 font-semibold">Costs</h2>
            {costsV && (costs.length === 0 ? <p className="mb-3 text-sm text-stone-500">No costs recorded.</p> : (
              <ul className="mb-4 divide-y divide-stone-100 text-sm">{costs.sort((a, b) => (b.costDate ?? "").localeCompare(a.costDate ?? "")).map((c) => (
                <li key={c.id} className="flex justify-between gap-2 py-2"><span>{c.title}<span className="block text-xs text-stone-500">{c.costType} · {formatDate(c.costDate)}{c.reference ? ` · ${c.reference}` : ""}{!c.componentIds?.length ? " · not allocated" : ""}</span></span><span className="text-right">{formatAud(actualCostExGst(c, settings.pricing.gstRate))}<span className="block text-xs text-stone-500">ex GST</span></span></li>
              ))}</ul>
            ))}
            <details open={!costsV}><summary className="cursor-pointer text-sm font-medium text-forest-700">Record a cost</summary><div className="mt-3"><QuickForm endpoint={`/api/projects/${p.id}/costs`} submitLabel="Save cost" fields={[{ name: "description", label: "What", type: "text", required: true }, { name: "supplier", label: "Supplier", type: "text", required: true }, { name: "costType", label: "Type", type: "select", required: true, defaultValue: "Material", options: [...COST_TYPES] }, { name: "componentId", label: "Part of the job", type: "select", options: compOptions }, { name: "amountIncGstCents", label: "Amount inc GST ($)", type: "money", required: true }, { name: "costDate", label: "Date", type: "date", required: true, defaultValue: today }, { name: "reference", label: "Invoice / receipt no.", type: "text" }, { name: "unplanned", label: "Not in the estimate", type: "checkbox" }]} /></div></details>
          </section>
        )}

        {(can(s.role, "variations.edit") || financeV) && (
          <section className="card p-5">
            <h2 className="mb-3 font-semibold">Variations</h2>
            {variations.length === 0 ? <p className="mb-3 text-sm text-stone-500">No variations.</p> : (
              <ul className="mb-4 divide-y divide-stone-100 text-sm">{variations.map((v) => (
                <li key={v.id} className="py-2"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{v.title}</span><span className="flex items-center gap-2">{financeV && <span>{formatAud(v.customerPrice ?? 0)}</span>}<Chip tone={statusTone(v.status)}>{v.status}</Chip></span></div>
                  <p className="text-xs text-stone-500">{v.description}</p>
                  {can(s.role, "variations.edit") && <div className="mt-1 flex flex-wrap gap-1">
                    {v.status === "Draft" && <ActionButton endpoint={`/api/variations/${v.id}`} body={{ action: "send" }} label="Mark sent to customer" />}
                    {can(s.role, "variations.approve") && (v.status === "Draft" || v.status === "Sent for Approval") && <ActionButton endpoint={`/api/variations/${v.id}`} body={{ action: "approve", confirm: true }} prompt={{ field: "approvedBy", question: `Who approved "${v.title}" for ${formatAud(v.customerPrice ?? 0)} inc GST? This adds it to the contract value.` }} label="Record approval" />}
                    {(v.status === "Draft" || v.status === "Sent for Approval") && <ActionButton endpoint={`/api/variations/${v.id}`} body={{ action: "decline" }} prompt={{ field: "reason", question: "Why was it declined?" }} label="Declined" />}
                  </div>}
                </li>
              ))}</ul>
            )}
            {can(s.role, "variations.edit") && <details><summary className="cursor-pointer text-sm font-medium text-forest-700">New variation</summary><div className="mt-3"><QuickForm endpoint={`/api/projects/${p.id}/variations`} submitLabel="Save as draft" fields={[{ name: "title", label: "Title", type: "text", required: true, full: true }, { name: "description", label: "What changes", type: "textarea", required: true }, { name: "requestedBy", label: "Requested by", type: "select", required: true, defaultValue: "Customer", options: ["Customer", "Whispering Leaf", "Site Condition", "Consultant / Authority", "Other"] }, { name: "componentId", label: "Part of the job", type: "select", options: compOptions }, { name: "estimatedCostCents", label: "Our cost ex GST ($)", type: "money", required: true }, { name: "customerPriceIncGstCents", label: "Price to customer inc GST ($)", type: "money", required: true }, { name: "scheduleImpactDays", label: "Extra days", type: "int", defaultValue: "0" }]} /></div></details>}
          </section>
        )}

        {financeV && (
          <section className="card p-5 lg:col-span-2">
            <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">Payments</h2><Link href="/finance" className="text-sm text-forest-700 underline">Finance</Link></div>
            {payments.length === 0 ? <p className="text-sm text-stone-500">No payment schedule.</p> : (
              <ul className="divide-y divide-stone-100 text-sm">{payments.filter((x) => !x.archived).map((x) => (
                <li key={x.id} className="flex flex-wrap justify-between gap-2 py-2"><span>{x.stageLabel || x.title}<span className="block text-xs text-stone-500">{x.dueDate ? `Due ${formatDate(x.dueDate)}` : "Raise at milestone"}{x.receivedDate ? ` · received ${formatDate(x.receivedDate)}` : ""}</span></span><span className="flex items-center gap-2">{formatAud(x.amount ?? 0)}<Chip tone={x.status === "Paid" ? "green" : x.dueDate && x.dueDate < today ? "red" : "stone"}>{x.status === "Paid" ? "Paid" : x.dueDate && x.dueDate < today ? "Overdue" : x.status}</Chip></span></li>
              ))}</ul>
            )}
          </section>
        )}
      </div>
    </>
  );
}
