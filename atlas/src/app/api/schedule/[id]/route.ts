import { z } from "zod";
import { route, HttpError } from "@/lib/server/api";
import { getRepo, getSettings } from "@/lib/server/context";
import { audit } from "@/lib/server/audit";
import { todayIn } from "@/lib/dates";

const Body = z.object({ status: z.enum(["Not Started", "Ready", "In Progress", "Waiting", "Completed", "Delayed", "Cancelled"]), issue: z.string().max(1000).optional() });

export const PATCH = route<{ id: string }>("schedule.edit", async ({ req, params, session }) => {
  const b = Body.parse(await req.json());
  const repo = getRepo();
  const s = await repo.get("schedule", params.id);
  if (!s) throw new HttpError(404, "Schedule item not found");
  const today = todayIn(getSettings().business.timezone);
  const after = await repo.update("schedule", s.id, { status: b.status, ...(b.issue !== undefined ? { issue: b.issue } : {}), ...(b.status === "In Progress" && !s.actualStart ? { actualStart: today } : {}), ...(b.status === "Completed" ? { actualFinish: today } : {}) });
  audit(session, { action: "schedule.update", entity: "schedule", recordId: s.id, summary: `"${s.title}" → ${b.status}` });
  return { item: after };
});
