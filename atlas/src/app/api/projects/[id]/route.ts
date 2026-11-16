import { route } from "@/lib/server/api";
import { getRepo } from "@/lib/server/context";
import { audit } from "@/lib/server/audit";
import { ProjectUpdate } from "@/lib/domain/projects";
import { getProject } from "@/lib/server/projects";

export const PATCH = route<{ id: string }>("projects.edit", async ({ req, params, session }) => {
  const i = ProjectUpdate.parse(await req.json());
  const repo = getRepo();
  const before = await getProject(repo, params.id);
  const patch = Object.fromEntries(Object.entries(i).filter(([k, v]) => (before as Record<string, unknown>)[k] !== v));
  if (!Object.keys(patch).length) return { project: before };
  const after = await repo.update("projects", params.id, patch);
  // A cancelled job shouldn't leave payment stages due on Finance. Stages already received stay as they are.
  let stagesChanged = 0;
  if (patch.status && (patch.status === "Cancelled") !== (before.status === "Cancelled")) {
    const cancelling = patch.status === "Cancelled";
    const stages = await repo.list("payments", { where: (x) => !!x.projectIds?.includes(params.id) });
    for (const x of stages) {
      if (cancelling && !x.archived && x.status !== "Paid") { await repo.update("payments", x.id, { archived: true, cancelledWithProject: true }); stagesChanged++; }
      if (!cancelling && x.cancelledWithProject) { await repo.update("payments", x.id, { archived: false, cancelledWithProject: false }); stagesChanged++; }
    }
  }
  audit(session, { action: "project.update", entity: "projects", recordId: params.id, summary: `${after.name}: ${Object.entries(patch).map(([k, v]) => `${k} → ${v ?? "cleared"}`).join(", ")}${stagesChanged ? `; ${stagesChanged} unpaid payment stage(s) ${patch.status === "Cancelled" ? "taken off" : "put back on"} Finance` : ""}`, before: Object.fromEntries(Object.keys(patch).map((k) => [k, (before as Record<string, unknown>)[k]])), after: patch });
  return { project: after };
});
