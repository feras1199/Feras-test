import { route } from "@/lib/server/api";
import { getRepo } from "@/lib/server/context";
import { restoreDeleted } from "@/lib/server/deletion";

/** Puts a deleted record (and what went with it) back. */
export const POST = route<{ id: string }>("records.delete", async ({ params, session }) => {
  const r = await restoreDeleted(getRepo(), session, params.id);
  return { restored: r.restored, skipped: r.skipped, label: r.batch.label };
});
