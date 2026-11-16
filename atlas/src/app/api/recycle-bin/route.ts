import { route } from "@/lib/server/api";
import { getRepo } from "@/lib/server/context";
import { recycleBinOf } from "@/lib/data/repository";

/** Recent deletes, newest first. */
export const GET = route("records.delete", async () => {
  const bin = recycleBinOf(getRepo());
  const rows = bin ? await bin.listBin(100) : [];
  return { items: rows.map((b) => ({ id: b.id, at: b.at, by: b.by, label: b.label, count: b.records.length, restoredAt: b.restoredAt ?? null, restoredBy: b.restoredBy ?? null })) };
});
