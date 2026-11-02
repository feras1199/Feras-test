import { z } from "zod";
import { route, HttpError } from "@/lib/server/api";
import { dataSource, getRepo } from "@/lib/server/context";
import { audit } from "@/lib/server/audit";
import { loadEstimate } from "@/lib/server/estimates";
import { lineCostExGst, type QuoteSnapshot } from "@/lib/domain/estimates";
import { addDays } from "@/lib/domain/dates";
import { can } from "@/lib/auth/roles";
import { formatAud } from "@/lib/finance/money";
import type { Rec } from "@/lib/data/entities";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve"), overrideReason: z.string().trim().min(10).max(1000).optional() }),
  z.object({ action: z.literal("send"), confirm: z.literal(true) }),
  z.object({ action: z.literal("accept"), confirm: z.literal(true), acceptedBy: z.string().trim().min(2).max(120), method: z.enum(["Signed quote", "Email", "In person", "Phone", "Customer portal"]) }),
  z.object({ action: z.literal("decline"), reason: z.string().trim().min(2).max(500) }),
  z.object({ action: z.literal("revise") }),
]);

export const POST = route<{ id: string }>("estimates.edit", async ({ req, params, session }) => {
  const body = Body.parse(await req.json());
  const repo = getRepo();
  const ctx = await loadEstimate(repo, params.id);
  const { estimate: e, summary, settings, today, lines } = ctx;
  const needApprove = () => {
    if (!can(session.role, "estimates.approve")) throw new HttpError(403, "Only a manager or owner can do this");
  };

  switch (body.action) {
    case "approve": {
      needApprove();
      if (e.quoteLocked) throw new HttpError(409, "Already approved");
      if (summary.blocking.length) {
        if (!body.overrideReason) throw Object.assign(new HttpError(400, `${summary.blocking.length} check(s) must pass before approval`), { blocking: summary.blocking });
        if (session.role !== "owner") throw new HttpError(403, "Only the owner can approve with failing checks");
      }
      if (!summary.schedule) throw new HttpError(400, "Fix the payment schedule first");
      const snapshot: QuoteSnapshot = {
        version: 1,
        approvedAt: new Date().toISOString(),
        approvedBy: session.name,
        quoteNumber: e.quoteNumber ?? "",
        customerScope: e.customerScope ?? "",
        assumptions: e.assumptions ?? "",
        validUntil: e.validUntil ?? addDays(today, settings.pricing.quoteValidityDays),
        gstRate: settings.pricing.gstRate,
        pricing: (({ costBase, sellExGst, gst, sellIncGst, markupRate, grossMargin, commission, overridden }) => ({ costBase, sellExGst, gst, sellIncGst, markupRate, grossMargin, commission, overridden }))(summary.pricing),
        schedule: summary.schedule,
        lines: lines.map((l) => ({ id: l.id, description: l.description ?? "", costType: l.costType ?? "", quantity: l.quantity ?? 0, unit: l.unitSnapshot ?? "", costExGst: lineCostExGst(l), customerDescription: l.customerDescription ?? "", option: l.proposalOption ?? "Included" })),
        optionalExtras: summary.optionalExtras,
      };
      const after = await repo.update("estimates", e.id, {
        status: "Ready",
        quoteLocked: true,
        snapshotJson: JSON.stringify(snapshot),
        estimatedCost: summary.pricing.costBase,
        agreedPriceExGst: summary.pricing.sellExGst,
        customerTotalIncGst: summary.pricing.sellIncGst,
        depositRequired: summary.schedule[0]!.amount,
        commissionBaseSnapshot: summary.pricing.commissionBase || null,
        paymentTermsSummary: summary.schedule.map((s) => `${s.label} ${(s.rate * 100).toFixed(0)}% ${formatAud(s.amount)}`).join(" · "),
        quoteReviewStatus: "Approved to Send",
        validUntil: snapshot.validUntil,
        costAuditComplete: true,
        ...(body.overrideReason ? { internalReviewNotes: `${e.internalReviewNotes ? e.internalReviewNotes + "\n" : ""}Approved with failing checks by ${session.name} on ${today}: ${body.overrideReason}` } : {}),
      });
      audit(session, { action: "estimate.approve", entity: "estimates", recordId: e.id, summary: `Approved ${e.title} at ${formatAud(summary.pricing.sellIncGst)} inc GST${body.overrideReason ? " (checks overridden)" : ""}`, after: { sellIncGst: summary.pricing.sellIncGst, overrideReason: body.overrideReason, failing: summary.blocking.map((b) => b.id) } });
      return { estimate: after };
    }

    case "send": {
      needApprove();
      if (e.status !== "Ready") throw new HttpError(409, "Approve the estimate before marking it sent");
      const after = await repo.update("estimates", e.id, { status: "Quoted", sentDate: today, quoteReviewStatus: "Sent", approvalStatus: "Awaiting Customer" });
      for (const enqId of e.enquiryIds ?? []) await repo.update("enquiries", enqId, { status: "Proposal Sent", nextFollowUp: addDays(today, 3), nextAction: `Follow up on ${e.quoteNumber}` });
      audit(session, { action: "estimate.send", entity: "estimates", recordId: e.id, summary: `Marked ${e.title} as sent to the customer` });
      return { estimate: after };
    }

    case "accept": {
      needApprove();
      if (e.status !== "Quoted" && e.status !== "Ready") throw new HttpError(409, `Can't accept an estimate that is ${e.status}`);
      if (dataSource() === "airtable" && process.env.ATLAS_LEGACY_PAYMENT_AUTOMATIONS_OFF !== "1") {
        throw new HttpError(409, "The old Airtable payment automations are still on and would create duplicate payments. Turn them off, then set ATLAS_LEGACY_PAYMENT_AUTOMATIONS_OFF=1.");
      }
      const snap = JSON.parse(e.snapshotJson ?? "null") as QuoteSnapshot | null;
      if (!snap) throw new HttpError(409, "This estimate has no approved snapshot");
      let projectId = e.projectIds?.[0];
      if (!projectId) {
        const customer = e.customerIds?.[0] ? await repo.get("customers", e.customerIds[0]) : null;
        const p = await repo.create("projects", {
          name: `${customer?.name ?? "Customer"} – ${e.title?.replace(/^Q-\d{4}-\d+\s*/, "") ?? "Project"}`,
          status: "Accepted / Pre-start",
          customerIds: e.customerIds ?? [],
          estimateIds: [e.id],
          enquiryIds: e.enquiryIds ?? [],
          estValue: snap.pricing.sellIncGst,
          estimatedCostSnapshot: snap.pricing.costBase,
          siteAddress: customer?.address ?? "",
          suburb: customer?.suburb ?? "",
          health: "On Track",
          progress: 0,
          dataMode: dataSource() === "airtable" ? "Live" : "Practice",
        });
        projectId = p.id;
      }
      // Idempotent: payment keys stop a double click creating two schedules.
      const existing = await repo.list("payments", { where: (p) => !!p.paymentKey?.startsWith(`${e.id}:`) });
      const created: Rec<"payments">[] = [];
      if (!existing.length) {
        for (const s of snap.schedule) {
          created.push(await repo.create("payments", {
            title: `${snap.quoteNumber} ${s.label}`,
            projectIds: [projectId],
            stageLabel: s.label,
            stageRate: s.rate,
            amount: s.amount,
            contractSnapshot: snap.pricing.sellIncGst,
            dueDate: s.index === 0 ? addDays(today, settings.payments.dueDays) : null,
            status: "Pending",
            paymentKey: `${e.id}:${s.index}`,
            archived: false,
            notes: s.index === 0 ? "" : "Raise when the stage milestone is reached",
          }));
        }
      }
      const after = await repo.update("estimates", e.id, { status: "Accepted", acceptedDate: today, approvalStatus: "Accepted", projectIds: [projectId] });
      for (const enqId of e.enquiryIds ?? []) await repo.update("enquiries", enqId, { status: "Won", reasonWonLost: "Good fit / value", projectIds: [projectId] });
      for (const cId of e.customerIds ?? []) await repo.update("customers", cId, { leadStatus: "Won" });
      audit(session, { action: "estimate.accept", entity: "estimates", recordId: e.id, summary: `${e.title} accepted by ${body.acceptedBy} (${body.method}). ${created.length} payment stages created totalling ${formatAud(created.reduce((a, p) => a + (p.amount ?? 0), 0))}`, after: { projectId, payments: created.map((p) => p.id) } });
      return { estimate: after, projectId, payments: created.length };
    }

    case "decline": {
      const after = await repo.update("estimates", e.id, { status: "Declined", approvalStatus: "Declined", internalReviewNotes: `${e.internalReviewNotes ? e.internalReviewNotes + "\n" : ""}Declined ${today}: ${body.reason}` });
      audit(session, { action: "estimate.decline", entity: "estimates", recordId: e.id, summary: `${e.title} declined: ${body.reason}` });
      return { estimate: after };
    }

    case "revise": {
      if (e.status === "Accepted") throw new HttpError(409, "Accepted estimates can't be revised. Use a variation instead.");
      const rev = (e.revision ?? 1) + 1;
      const copy = await repo.create("estimates", {
        title: `${e.title?.replace(/ \(rev \d+\)$/, "")} (rev ${rev})`,
        quoteNumber: `${e.quoteNumber?.replace(/-R\d+$/, "")}-R${rev}`,
        customerIds: e.customerIds ?? [], enquiryIds: e.enquiryIds ?? [], projectIds: e.projectIds ?? [],
        estimateDate: today, status: "Draft", estimateType: e.estimateType ?? undefined, pricingBasis: "Net costs + GST",
        revision: rev, validUntil: addDays(today, settings.pricing.quoteValidityDays), quoteReviewStatus: "Needs Review", approvalStatus: "Not Sent", quoteLocked: false,
        customerScope: e.customerScope ?? "", assumptions: e.assumptions ?? "", proposalIntro: e.proposalIntro ?? "",
        markupOverride: e.markupOverride ?? null, overheadAllowance: e.overheadAllowance ?? null, contingencyRate: e.contingencyRate ?? null, commissionRate: e.commissionRate ?? null,
        depositRate: e.depositRate ?? 0, progress1Rate: e.progress1Rate ?? 0, progress2Rate: e.progress2Rate ?? 0, progress3Rate: e.progress3Rate ?? 0, finalRate: e.finalRate ?? 0,
      });
      for (const l of lines) {
        const { id: _id, createdTime: _c, lineCost: _lc, estimateIds: _e, ...fields } = l;
        await repo.create("estimateLines", { ...fields, estimateIds: [copy.id] });
      }
      await repo.update("estimates", e.id, { status: "Superseded" });
      audit(session, { action: "estimate.revise", entity: "estimates", recordId: copy.id, summary: `Revision ${rev} of ${e.quoteNumber} started; previous version superseded` });
      return { estimate: copy };
    }
  }
});
