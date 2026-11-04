import { z } from "zod";

/** Change requests are saved as tasks for the owner with this title prefix. */
export const CHANGE_PREFIX = "ATLAS change request: ";

export const ChangeRequest = z.object({
  title: z.string().trim().min(3).max(120),
  what: z.string().trim().min(5).max(3000),
  why: z.string().trim().max(1500).default(""),
  where: z.string().trim().max(200).default(""),
  size: z.enum(["small", "medium", "large"]).default("small"),
});
export type ChangeRequest = z.infer<typeof ChangeRequest>;

export function changeRequestNotes(c: ChangeRequest, by: string) {
  const lines = [`Requested by: ${by}`];
  if (c.where) lines.push(`Where in ATLAS: ${c.where}`);
  lines.push(`Size: ${c.size}`, "", "What:", c.what);
  if (c.why) lines.push("", "Why:", c.why);
  return lines.join("\n");
}
