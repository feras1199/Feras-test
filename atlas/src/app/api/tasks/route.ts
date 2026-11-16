import { route } from "@/lib/server/api";
import { getRepo } from "@/lib/server/context";
import { audit } from "@/lib/server/audit";
import { TaskCreate } from "@/lib/domain/crm";
import { can } from "@/lib/auth/roles";

export const GET = route("dashboard.view", async ({ session }) => {
  const rows = await getRepo().list("tasks");
  // Workers and supervisors only see tasks assigned to them or with no customer attached.
  return { tasks: can(session.role, "crm.view") ? rows : rows.filter((t) => t.assignedTo === session.name || t.assignedTo === roleName(session.role)) };
});

function roleName(role: string) {
  return role === "supervisor" ? "Supervisor" : role === "worker" ? "Worker" : "";
}

export const POST = route("crm.edit", async ({ req, session }) => {
  const i = TaskCreate.parse(await req.json());
  const rec = await getRepo().create("tasks", {
    title: i.title,
    taskType: i.taskType,
    priority: i.priority,
    status: "Backlog",
    dueDate: i.dueDate,
    assignedTo: i.assignedTo || session.name,
    notes: i.notes,
    customerIds: i.customerId ? [i.customerId] : [],
    enquiryIds: i.enquiryId ? [i.enquiryId] : [],
    projectIds: i.projectId ? [i.projectId] : [],
  });
  audit(session, { action: "task.create", entity: "tasks", recordId: rec.id, summary: `Task: ${rec.title}`, after: i });
  return { task: rec };
});
