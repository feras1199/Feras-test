import { route } from "@/lib/server/api";
import { getRepo } from "@/lib/server/context";
import { audit } from "@/lib/server/audit";
import { ScheduleCreate } from "@/lib/domain/projects";
import { assertComponent, getProject } from "@/lib/server/projects";

export const POST = route<{ id: string }>("schedule.edit", async ({ req, params, session }) => {
  const i = ScheduleCreate.parse(await req.json());
  const repo = getRepo();
  const p = await getProject(repo, params.id);
  const componentIds = await assertComponent(repo, p.id, i.componentId);
  const rec = await repo.create("schedule", { title: i.title, type: i.type, plannedStart: i.plannedStart, plannedFinish: i.plannedFinish ?? i.plannedStart, assignedTo: i.assignedTo ?? "", projectIds: [p.id], componentIds, status: "Not Started", priority: "Normal", customerVisible: i.customerVisible });
  audit(session, { action: "schedule.create", entity: "schedule", recordId: rec.id, summary: `${p.name}: scheduled "${i.title}" ${i.plannedStart}` });
  return { item: rec };
});
