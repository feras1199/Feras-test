import { route, HttpError } from "@/lib/server/api";
import { getRepo } from "@/lib/server/context";
import { afterDeleteHref, checkDeletePermission, deleteRecord, isDeletable, planDelete } from "@/lib/server/deletion";

/** What deleting this record would remove, for the confirm step. Changes nothing. */
export const GET = route<{ entity: string; id: string }>("signed-in", async ({ params, session }) => {
  if (!isDeletable(params.entity)) throw new HttpError(404, "That can't be deleted");
  checkDeletePermission(session, params.entity);
  const plan = await planDelete(getRepo(), params.entity, params.id);
  return { label: plan.root.label, alsoDeleted: plan.alsoDeleted, money: plan.money, unlinked: plan.unlinks.length };
});

/** Deletes the record and what belongs to it. Body: { confirm: true } or { confirm: "DELETE" } when money is involved. */
export const DELETE = route<{ entity: string; id: string }>("signed-in", async ({ req, params, session }) => {
  if (!isDeletable(params.entity)) throw new HttpError(404, "That can't be deleted");
  const body = (await req.json().catch(() => ({}))) as { confirm?: unknown };
  const { batch, plan } = await deleteRecord(getRepo(), session, params.entity, params.id, body.confirm);
  return { deleted: batch.records.length, binId: batch.id, label: batch.label, next: afterDeleteHref(params.entity, plan.records[0]!.rec) };
});
