import { z } from "zod";
import { route, HttpError } from "@/lib/server/api";
import { getRepo, getSettings } from "@/lib/server/context";
import { audit } from "@/lib/server/audit";
import { addDays } from "@/lib/domain/dates";
import { todayIn } from "@/lib/dates";
import { formatAud } from "@/lib/finance/money";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("raise"), dueDate: date.optional() }),
  z.object({ action: z.literal("received"), confirm: z.literal(true), receivedDate: date, method: z.enum(["Bank Transfer", "Card", "Cash", "Cheque", "Other"]) }),
  z.object({ action: z.literal("undo-received"), confirm: z.literal(true) }),
]);

export const PATCH = route<{ id: string }>("finance.edit", async ({ req, params, session }) => {
  const b = Body.parse(await req.json());
  const repo = getRepo();
  const p = await repo.get("payments", params.id);
  if (!p || p.archived) throw new HttpError(404, "Payment not found");
  if (b.action === "undo-received") {
    // For a payment marked received by mistake. It goes back to Due, keeping its due date.
    if (p.status !== "Paid") throw new HttpError(409, "This payment isn't marked received");
    const after = await repo.update("payments", p.id, { status: p.dueDate ? "Due" : "Pending", receivedDate: null, paymentMethod: null });
    audit(session, { action: "payment.unreceived", entity: "payments", recordId: p.id, summary: `${p.title}: "received" undone (was ${formatAud(p.amount ?? 0)} on ${p.receivedDate ?? "unknown date"})`, before: { status: p.status, receivedDate: p.receivedDate, method: p.paymentMethod }, after: { status: after.status } });
    return { payment: after };
  }
  if (p.status === "Paid") throw new HttpError(409, "Already marked paid");
  const today = todayIn((await getSettings()).business.timezone);
  if (b.action === "raise") {
    const due = b.dueDate ?? addDays(today, (await getSettings()).payments.dueDays);
    const after = await repo.update("payments", p.id, { dueDate: due, status: "Due" });
    audit(session, { action: "payment.raise", entity: "payments", recordId: p.id, summary: `${p.title}: ${formatAud(p.amount ?? 0)} raised, due ${due}. No invoice was sent; send it from your accounting system.` });
    return { payment: after };
  }
  if (b.receivedDate > today) throw new HttpError(400, "Received date can't be in the future");
  const after = await repo.update("payments", p.id, { status: "Paid", receivedDate: b.receivedDate, paymentMethod: b.method });
  audit(session, { action: "payment.received", entity: "payments", recordId: p.id, summary: `${p.title}: ${formatAud(p.amount ?? 0)} received ${b.receivedDate} by ${b.method.toLowerCase()}`, before: { status: p.status }, after: { status: "Paid", receivedDate: b.receivedDate } });
  return { payment: after };
});
