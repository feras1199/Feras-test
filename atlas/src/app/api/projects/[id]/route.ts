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
  audit(session, { action: "project.update", entity: "projects", recordId: params.id, summary: `${after.name}: ${Object.entries(patch).map(([k, v]) => `${k} → ${v ?? "cleared"}`).join(", ")}`, before: Object.fromEntries(Object.keys(patch).map((k) => [k, (before as Record<string, unknown>)[k]])), after: patch });
  return { project: after };
});
