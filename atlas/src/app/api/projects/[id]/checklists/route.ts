import { z } from "zod";
import { route } from "@/lib/server/api";
import { getRepo } from "@/lib/server/context";
import { audit } from "@/lib/server/audit";
import { getProject } from "@/lib/server/projects";

const STAGES = ["Pre-start", "Set-out", "Construction", "Quality Check", "Completion", "Handover"] as const;
const DEFAULTS: Record<(typeof STAGES)[number], string[]> = {
  "Pre-start": ["Dial Before You Dig checked", "Materials ordered", "Site access confirmed with customer", "Skip / disposal booked"],
  "Set-out": ["Levels and set-out checked against plan", "Services marked"],
  Construction: ["Daily site clean-up", "Progress photos taken"],
  "Quality Check": ["Falls and drainage checked", "Finish inspected by supervisor"],
  Completion: ["Site cleaned and waste removed", "Final photos taken"],
  Handover: ["Customer walkthrough done", "Care and maintenance notes given", "Final invoice raised"],
};
const Body = z.union([z.object({ title: z.string().trim().min(2).max(200), stage: z.enum(STAGES), required: z.boolean().default(false) }), z.object({ template: z.literal(true) })]);

export const POST = route<{ id: string }>("checklists.edit", async ({ req, params, session }) => {
  const b = Body.parse(await req.json());
  const repo = getRepo();
  const p = await getProject(repo, params.id);
  const items = "template" in b ? STAGES.flatMap((stage) => DEFAULTS[stage].map((title) => ({ title, stage, required: true }))) : [b];
  for (const it of items) await repo.create("checklists", { title: it.title, stage: it.stage, required: it.required, completed: false, projectIds: [p.id] });
  audit(session, { action: "checklist.create", entity: "checklists", summary: `${p.name}: added ${items.length} checklist item(s)` });
  return { added: items.length };
});
