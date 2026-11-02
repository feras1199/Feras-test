import { z } from "zod";
import { route, HttpError } from "@/lib/server/api";
import { getRepo, getSettings } from "@/lib/server/context";
import { audit } from "@/lib/server/audit";
import { can } from "@/lib/auth/roles";
import { todayIn } from "@/lib/dates";
import { formatAud } from "@/lib/finance/money";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("send") }),
  z.object({ action: z.literal("approve"), confirm: z.literal(true), approvedBy: z.string().trim().min(2).max(120) }),
  z.object({ action: z.literal("decline"), reason: z.string().trim().min(2).max(500) }),
  z.object({ action: z.literal("complete") }),
]);
const FROM: Record<string, string[]> = { send: ["Draft"], approve: ["Draft", "Sent for Approval"], decline: ["Draft", "Sent for Approval"], complete: ["Approved"] };

export const PATCH = route<{ id: string }>("variations.edit", async ({ req, params, session }) => {
  const b = Body.parse(await req.json());
  const repo = getRepo();
  const v = await repo.get("variations", params.id);
  if (!v) throw new HttpError(404, "Variation not found");
  if (!FROM[b.action]!.includes(v.status ?? "")) throw new HttpError(409, `Can't ${b.action} a variation that is ${v.status}`);
  if (b.action === "approve" && !can(session.role, "variations.approve")) throw new HttpError(403, "Only a manager or owner can record approval");
  const today = todayIn(getSettings().business.timezone);
  const patch =
    b.action === "send" ? { status: "Sent for Approval" } :
    b.action === "approve" ? { status: "Approved", approvedDate: today, customerApproved: true, notes: `${v.notes ? v.notes + "\n" : ""}Approved by ${b.approvedBy}, recorded by ${session.name} on ${today}` } :
    b.action === "decline" ? { status: "Declined", notes: `${v.notes ? v.notes + "\n" : ""}Declined ${today}: ${b.reason}` } :
    { status: "Completed" };
  const after = await repo.update("variations", v.id, patch as never);
  audit(session, { action: `variation.${b.action}`, entity: "variations", recordId: v.id, summary: `Variation "${v.title}" ${after.status?.toLowerCase()}${b.action === "approve" ? `: contract +${formatAud(v.customerPrice ?? 0)} inc GST` : ""}` });
  return { variation: after };
});
