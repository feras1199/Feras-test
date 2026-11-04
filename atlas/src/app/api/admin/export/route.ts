import { route } from "@/lib/server/api";
import { getRepo } from "@/lib/server/context";
import { audit } from "@/lib/server/audit";
import { buildExport } from "@/lib/server/dataAdmin";
import { todayIn } from "@/lib/dates";

/** Owner-only full backup as a JSON download. It can be imported back with the same screen. */
export const GET = route("settings.edit", async ({ session }) => {
  const data = await buildExport(getRepo());
  const total = Object.values(data.entities).reduce((n, rows) => n + (rows?.length ?? 0), 0);
  audit(session, { action: "data.export", summary: `Downloaded a full backup (${total} records)` });
  return new Response(JSON.stringify(data), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="atlas-backup-${todayIn()}.json"`,
      "Cache-Control": "no-store",
    },
  });
});
