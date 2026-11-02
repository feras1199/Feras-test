import type { Repository } from "../data/repository";
import { can, type Role } from "../auth/roles";
import { paymentState } from "../finance/payments";
import { sumCents } from "../finance/money";

export interface TodayItem {
  kind: "follow-up" | "task" | "payment" | "enquiry";
  id: string;
  title: string;
  detail: string;
  href: string;
  due: string | null;
  overdue: boolean;
}

const OPEN_ENQUIRY = new Set(["New Enquiry", "Contacted", "Site Visit Booked", "Site Inspected", "Estimate Preparing", "Preliminary Estimate Ready", "Proposal Sent", "Follow-up"]);
function addDays(iso: string, n: number) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const OPEN_TASK = new Set(["Backlog", "Today", "Doing", "Waiting", "Delayed"]);

/** Everything on the Today screen comes from records; nothing is estimated or invented. */
export async function buildToday(repo: Repository, role: Role, today: string) {
  const [enquiries, tasks, projects, payments] = await Promise.all([
    can(role, "crm.view") ? repo.list("enquiries") : Promise.resolve([]),
    repo.list("tasks"),
    repo.list("projects"),
    can(role, "finance.view") ? repo.list("payments") : Promise.resolve([]),
  ]);

  const items: TodayItem[] = [];
  for (const e of enquiries) {
    if (!OPEN_ENQUIRY.has(e.status ?? "")) continue;
    if (e.status === "New Enquiry" && !e.nextFollowUp) {
      items.push({ kind: "enquiry", id: e.id, title: e.title ?? "New enquiry", detail: "New enquiry, not yet contacted", href: `/customers/${e.customerIds?.[0] ?? ""}`, due: e.enquiryDate ?? null, overdue: false });
    } else if (e.nextFollowUp && e.nextFollowUp <= today) {
      items.push({ kind: "follow-up", id: e.id, title: e.title ?? "Follow-up", detail: e.nextAction || "Follow up", href: `/customers/${e.customerIds?.[0] ?? ""}`, due: e.nextFollowUp, overdue: e.nextFollowUp < today });
    }
  }
  for (const t of tasks) {
    if (!OPEN_TASK.has(t.status ?? "")) continue;
    if (t.dueDate && t.dueDate <= today) items.push({ kind: "task", id: t.id, title: t.title ?? "Task", detail: `${t.taskType ?? "Task"} · ${t.assignedTo ?? "Unassigned"}`, href: "#", due: t.dueDate, overdue: t.dueDate < today });
  }
  let dueCents = 0;
  let overdueCents = 0;
  for (const p of payments) {
    if (p.archived) continue;
    const st = paymentState({ amount: p.amount ?? 0, received: p.status === "Paid" || p.receivedDate ? (p.amount ?? 0) : 0, dueDate: p.dueDate ?? null }, today);
    const soon = st === "due" && !!p.dueDate && p.dueDate <= addDays(today, 7);
    if (st === "overdue" || soon) {
      if (st === "overdue") overdueCents += p.amount ?? 0;
      else dueCents += p.amount ?? 0;
      items.push({ kind: "payment", id: p.id, title: p.title ?? "Payment", detail: st === "overdue" ? "Overdue" : p.dueDate === today ? "Due today" : "Due this week", href: "#", due: p.dueDate ?? null, overdue: st === "overdue" });
    }
  }
  items.sort((a, b) => Number(b.overdue) - Number(a.overdue) || (a.due ?? "").localeCompare(b.due ?? ""));

  const activeProjects = projects.filter((p) => p.status === "In Progress" || p.status === "Accepted / Pre-start");
  return {
    items,
    counts: {
      openEnquiries: enquiries.filter((e) => OPEN_ENQUIRY.has(e.status ?? "")).length,
      activeProjects: activeProjects.length,
      openTasks: tasks.filter((t) => OPEN_TASK.has(t.status ?? "")).length,
    },
    money: can(role, "finance.view") ? { dueCents, overdueCents, outstandingCents: sumCents(payments.filter((p) => !p.archived && p.status !== "Paid").map((p) => p.amount)) } : null,
    activeProjects: activeProjects.map((p) => ({ id: p.id, name: p.name ?? "Project", status: p.status ?? "", health: p.health ?? null, progress: p.progress ?? null, nextAction: p.nextAction ?? null, nextActionDate: p.nextActionDate ?? null })),
  };
}
