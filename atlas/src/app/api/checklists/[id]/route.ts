import { z } from "zod";
import { route, HttpError } from "@/lib/server/api";
import { getRepo, getSettings } from "@/lib/server/context";
import { audit } from "@/lib/server/audit";
import { todayIn } from "@/lib/dates";

const Body = z.object({ completed: z.boolean(), notes: z.string().max(1000).optional() });

export const PATCH = route<{ id: string }>("checklists.edit", async ({ req, params, session }) => {
  const b = Body.parse(await req.json());
  const repo = getRepo();
  const c = await repo.get("checklists", params.id);
  if (!c) throw new HttpError(404, "Checklist item not found");
  const after = await repo.update("checklists", c.id, b.completed ? { completed: true, completedBy: session.name, completedDate: todayIn(getSettings().business.timezone), ...(b.notes ? { notes: b.notes } : {}) } : { completed: false, completedBy: "", completedDate: null });
  audit(session, { action: "checklist.update", entity: "checklists", recordId: c.id, summary: `"${c.title}" ${b.completed ? "ticked" : "unticked"}` });
  return { item: after };
});
