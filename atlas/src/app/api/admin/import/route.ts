import { z } from "zod";
import { HttpError, route } from "@/lib/server/api";
import { getRepo } from "@/lib/server/context";
import { audit } from "@/lib/server/audit";
import { parseImport } from "@/lib/data/importer";
import { previewImport, runImport } from "@/lib/server/dataAdmin";

const Body = z.object({
  file: z.unknown(),
  mode: z.enum(["add-new", "replace"]).default("add-new"),
  /** Show what would happen without saving anything. */
  preview: z.boolean().default(true),
  confirm: z.literal(true).optional(),
});

/**
 * Owner-only. Reads an uploaded data file (an Airtable export or an ATLAS backup)
 * into ATLAS's own database. Preview first; the real run needs confirm: true.
 */
export const POST = route("settings.edit", async ({ req, session }) => {
  const b = Body.parse(await req.json());
  let parsed;
  try {
    parsed = parseImport(b.file);
  } catch {
    throw new HttpError(400, "That file isn't an ATLAS backup or an Airtable export ATLAS can read.");
  }
  const repo = getRepo();
  const preview = await previewImport(repo, parsed);
  if (b.preview) return { preview };
  if (!b.confirm) throw new HttpError(400, "Confirm the import first");
  const results = await runImport(repo, parsed, b.mode, session.name);
  const added = results.reduce((n, r) => n + r.added, 0);
  const replaced = results.reduce((n, r) => n + r.replaced, 0);
  audit(session, { action: "data.import", summary: `Imported ${parsed.source}: ${added} added, ${replaced} replaced (${b.mode})`, after: results });
  return { preview, results };
}, { maxBodyBytes: 25 * 1024 * 1024 });
