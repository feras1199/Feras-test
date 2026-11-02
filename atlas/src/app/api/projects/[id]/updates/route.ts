import { z } from "zod";
import { route } from "@/lib/server/api";
import { getRepo, getSettings } from "@/lib/server/context";
import { audit } from "@/lib/server/audit";
import { getProject } from "@/lib/server/projects";
import { todayIn } from "@/lib/dates";

const Body = z.object({ summary: z.string().trim().min(5).max(3000), nextSteps: z.string().trim().max(1000).optional(), internalNotes: z.string().max(2000).optional() });
const PORTAL_STATUS: Record<string, string> = { "Accepted / Pre-start": "Pre-start", "In Progress": "In Progress", "On Hold": "Waiting", Completed: "Completed" };

/** Publishes an update to the customer portal. It is not emailed: email isn't connected yet. */
export const POST = route<{ id: string }>("projects.edit", async ({ req, params, session }) => {
  const b = Body.parse(await req.json());
  const repo = getRepo();
  const p = await getProject(repo, params.id);
  const today = todayIn(getSettings().business.timezone);
  const rec = await repo.create("clientUpdates", {
    title: `${p.name} – update ${today}`, projectIds: [p.id], updateDate: today, projectStatus: (PORTAL_STATUS[p.status ?? ""] ?? "In Progress") as never,
    progress: p.progress ?? null, summary: b.summary, nextSteps: b.nextSteps ?? "", internalNotes: b.internalNotes ?? "", customerVisible: true, emailSent: false, readyToSend: false,
  });
  await repo.update("projects", p.id, { customerUpdateStatus: "Sent" });
  audit(session, { action: "update.publish", entity: "clientUpdates", recordId: rec.id, summary: `${p.name}: customer update published to the portal` });
  return { update: rec };
});
