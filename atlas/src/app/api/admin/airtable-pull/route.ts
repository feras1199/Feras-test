import { z } from "zod";
import { HttpError, route } from "@/lib/server/api";
import { getRepo } from "@/lib/server/context";
import { audit } from "@/lib/server/audit";
import { PostgresRepository } from "@/lib/data/postgres/repository";
import { pullLibrariesFromAirtable } from "@/lib/server/airtablePull";

const Body = z.object({
  /** An Airtable personal access token. Optional when the server already has AIRTABLE_TOKEN. Never stored or logged. */
  token: z.string().trim().regex(/^pat[A-Za-z0-9._-]{20,300}$/, "That doesn't look like an Airtable token. It starts with \"pat\".").optional(),
  mode: z.enum(["add-new", "replace"]).default("add-new"),
  confirm: z.literal(true),
});

/** Owner-only. Copies the Cost Library, Productivity Rates and Omission Rules from Airtable into ATLAS. Airtable is only read. */
export const POST = route("settings.edit", async ({ req, session }) => {
  const b = Body.parse(await req.json());
  const repo = getRepo();
  if (!(repo instanceof PostgresRepository)) throw new HttpError(409, "This needs ATLAS's own database.");
  const token = b.token || process.env.AIRTABLE_TOKEN;
  if (!token) throw new HttpError(400, "Paste an Airtable token first.");
  const results = await pullLibrariesFromAirtable(repo, { token, baseId: process.env.AIRTABLE_BASE_ID, mode: b.mode, by: session.name });
  const added = results.reduce((n, r) => n + r.added, 0);
  const replaced = results.reduce((n, r) => n + r.replaced, 0);
  audit(session, { action: "data.import", summary: `Pulled price lists from Airtable: ${added} added, ${replaced} replaced (${b.mode})`, after: results });
  return { results };
});
