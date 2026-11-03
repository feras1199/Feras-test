import { route } from "@/lib/server/api";
import { getRepo } from "@/lib/server/context";
import { audit } from "@/lib/server/audit";
import { CHANGE_PREFIX, ChangeRequest, changeRequestNotes } from "@/lib/domain/changeRequests";

/**
 * Saves a request to change ATLAS itself as a task for the owner. Nothing about
 * ATLAS changes: the owner reviews it and the developer builds approved ones.
 */
export const POST = route("ai.use", async ({ req, session }) => {
  const c = ChangeRequest.parse(await req.json());
  const rec = await getRepo().create("tasks", {
    title: `${CHANGE_PREFIX}${c.title}`,
    taskType: "Management",
    priority: c.size === "large" ? "High" : "Normal",
    status: "Backlog",
    assignedTo: "Owner",
    notes: changeRequestNotes(c, session.name),
  });
  audit(session, { action: "change_request.create", entity: "tasks", recordId: rec.id, summary: `Change request: ${c.title} (${c.size})` });
  return { task: rec };
});
