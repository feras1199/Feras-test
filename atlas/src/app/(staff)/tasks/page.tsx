import Link from "next/link";
import { PageHeader, Empty } from "@/components/ui";
import { TaskList } from "@/components/crm/TaskList";
import { can } from "@/lib/auth/roles";
import { todayIn } from "@/lib/dates";
import { getRepo, getSettings, requirePage } from "@/lib/server/context";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tasks" };

const OPEN = new Set(["Backlog", "Today", "Doing", "Waiting", "Delayed"]);

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const s = await requirePage("dashboard.view");
  const { view = "open" } = await searchParams;
  const today = todayIn(getSettings().business.timezone);
  const all = await getRepo().list("tasks");
  const visible = can(s.role, "crm.view") ? all : all.filter((t) => t.assignedTo === s.name);
  const rows = visible
    .filter((t) => (view === "done" ? !OPEN.has(t.status ?? "") : view === "mine" ? OPEN.has(t.status ?? "") && t.assignedTo === s.name : OPEN.has(t.status ?? "")))
    .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"))
    .map((t) => ({ id: t.id, title: t.title ?? "Task", status: t.status ?? "Backlog", priority: t.priority ?? "Normal", dueDate: t.dueDate ?? null, assignedTo: t.assignedTo ?? null, taskType: t.taskType ?? null, mine: t.assignedTo === s.name }));
  const tab = (v: string, label: string) => <Link href={`/tasks?view=${v}`} aria-current={view === v ? "page" : undefined} className={`btn ${view === v ? "bg-forest-700 text-white" : "btn-secondary"}`}>{label}</Link>;
  return (
    <>
      <PageHeader title="Tasks" subtitle={`${rows.length} shown`} actions={can(s.role, "crm.edit") && <Link href="/tasks/new" className="btn-primary">New task</Link>} />
      <div className="mb-4 flex flex-wrap gap-2">{tab("open", "Open")}{tab("mine", "Mine")}{tab("done", "Done / cancelled")}</div>
      {rows.length === 0 ? <Empty title="No tasks here" /> : <TaskList tasks={rows} today={today} canEditAll={can(s.role, "crm.edit")} />}
    </>
  );
}
