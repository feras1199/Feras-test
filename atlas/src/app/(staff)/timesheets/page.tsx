import { Empty, PageHeader } from "@/components/ui";
import { QuickForm } from "@/components/QuickForm";
import { formatDate, formatTime, todayIn } from "@/lib/dates";
import { timesheetCost } from "@/lib/domain/projects";
import { getRepo, getSettings, requirePage } from "@/lib/server/context";

export const dynamic = "force-dynamic";
export const metadata = { title: "My time" };

export default async function TimesheetsPage() {
  const s = await requirePage("timesheets.submit");
  const repo = getRepo();
  const today = todayIn(getSettings().business.timezone);
  const [projects, mine] = await Promise.all([
    repo.list("projects", { where: (p) => ["In Progress", "Accepted / Pre-start"].includes(p.status ?? "") }),
    repo.list("timesheets", { where: (t) => t.staffName === s.name }),
  ]);
  mine.sort((a, b) => (b.workDate ?? "").localeCompare(a.workDate ?? ""));
  const names = new Map(projects.map((p) => [p.id, p.name]));
  const week = mine.filter((t) => (t.workDate ?? "") > new Date(Date.parse(today) - 7 * 864e5).toISOString().slice(0, 10)).reduce((a, t) => a + timesheetCost(t).personHours, 0);
  return (
    <>
      <PageHeader title="My time" subtitle={`${Math.round(week * 100) / 100} person-hours in the last 7 days`} />
      <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        <section className="card p-5">
          {projects.length === 0 ? <Empty title="No live projects to log time against" /> : (
            <QuickForm endpoint="/api/timesheets" title="Log time" submitLabel="Submit time" fields={[
              { name: "projectId", label: "Project", type: "select", required: true, options: projects.map((p) => ({ value: p.id, label: p.name ?? "Project" })), full: true },
              { name: "workDate", label: "Date", type: "date", required: true, defaultValue: today },
              { name: "crewSize", label: "People in crew", type: "int", defaultValue: "1" },
              { name: "startTime", label: "Start", type: "time", required: true, defaultValue: "07:00" },
              { name: "finishTime", label: "Finish", type: "time", required: true, defaultValue: "15:30" },
              { name: "breakMinutes", label: "Break (minutes)", type: "int", defaultValue: "30" },
              { name: "workType", label: "Work type", type: "select", required: true, defaultValue: "Construction", options: ["Construction", "Travel / Pickup", "Site Setup", "Rework", "Variation", "Management / Supervision", "Other"] },
              { name: "reworkReason", label: "If rework, why?", type: "text", full: true },
              { name: "notes", label: "Notes", type: "textarea" },
            ]} />
          )}
        </section>
        <section className="card p-5">
          <h2 className="mb-3 font-semibold">Recent entries</h2>
          {mine.length === 0 ? <p className="text-sm text-stone-500">You haven't logged any time yet.</p> : (
            <ul className="divide-y divide-stone-100 text-sm">{mine.slice(0, 30).map((t) => (
              <li key={t.id} className="flex justify-between gap-2 py-2"><span>{names.get(t.projectIds?.[0] ?? "") ?? "Project"}<span className="block text-xs text-stone-500">{formatDate(t.workDate)} · {formatTime(t.start)}–{formatTime(t.finish)} · crew {t.crewSize ?? 1}</span></span><span>{timesheetCost(t).personHours} h</span></li>
            ))}</ul>
          )}
        </section>
      </div>
    </>
  );
}
