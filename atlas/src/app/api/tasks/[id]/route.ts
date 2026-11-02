import { route, HttpError } from "@/lib/server/api";
import { getRepo, getSettings } from "@/lib/server/context";
import { audit } from "@/lib/server/audit";
import { TaskUpdate } from "@/lib/domain/crm";
import { can } from "@/lib/auth/roles";
import { todayIn } from "@/lib/dates";
import type { Rec } from "@/lib/data/entities";

export const PATCH = route<{ id: string }>("dashboard.view", async ({ req, params, session }) => {
  const input = TaskUpdate.parse(await req.json());
  const repo = getRepo();
  const before = await repo.get("tasks", params.id);
  if (!before) throw new HttpError(404, "Task not found");
  // Staff without CRM edit rights can only update the status of their own tasks.
  if (!can(session.role, "crm.edit")) {
    if (before.assignedTo !== session.name) throw new HttpError(403, "You can only update your own tasks");
    if (Object.keys(input).some((k) => k !== "status" && k !== "notes")) throw new HttpError(403, "You can only change the status");
  }
  const patch: Partial<Rec<"tasks">> = { ...input };
  if (input.status === "Done" && before.status !== "Done") patch.completedDate = todayIn(getSettings().business.timezone);
  if (input.status && input.status !== "Done") patch.completedDate = null;
  const after = await repo.update("tasks", params.id, patch);
  audit(session, { action: "task.update", entity: "tasks", recordId: params.id, summary: `${after.title}: ${Object.keys(input).map((k) => `${k} → ${(input as Record<string, unknown>)[k]}`).join(", ")}`, before: { status: before.status }, after: input });
  return { task: after };
});
