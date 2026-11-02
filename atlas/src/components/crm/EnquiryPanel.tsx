"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Card } from "./Pipeline";

const ALL = ["New Enquiry", "Contacted", "Site Visit Booked", "Site Inspected", "Estimate Preparing", "Preliminary Estimate Ready", "Proposal Sent", "Follow-up", "Won", "Lost", "On Hold"];
const LOST = ["Budget too low", "Price", "No response", "Competitor selected", "Timing", "Scope changed", "Customer postponed", "Not suitable for Whispering Leaf", "Outside service area", "Appointment issue", "Estimate / quote delay", "Other"];

export function EnquiryPanel({ card, canEdit, onClose }: { card: Card; statuses: string[]; canEdit: boolean; onClose: () => void }) {
  const router = useRouter();
  const [status, setStatus] = useState(card.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/enquiries/${card.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const json = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res?.ok) return setError(json.issues?.[0]?.message ?? json.error ?? "Couldn't save");
    router.refresh();
    onClose();
  }

  function onSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const body: Record<string, unknown> = {};
    if (status !== card.status) body.status = status;
    const reason = fd.get("reason");
    if (reason) body.reasonWonLost = reason;
    if (status === "Won") body.reasonWonLost = "Good fit / value";
    const fu = String(fd.get("nextFollowUp") ?? "");
    if (fu !== (card.nextFollowUp ?? "")) body.nextFollowUp = fu || null;
    const na = String(fd.get("nextAction") ?? "").trim();
    if (na !== (card.nextAction ?? "")) body.nextAction = na;
    const summary = String(fd.get("summary") ?? "").trim();
    if (summary) body.contacted = { channel: fd.get("channel"), summary };
    if (!Object.keys(body).length) return onClose();
    send(body);
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-labelledby="enq-title">
      <button className="absolute inset-0 bg-black/30" aria-label="Close" onClick={onClose} />
      <div className="relative h-full w-full max-w-md overflow-y-auto bg-paper p-5 shadow-xl">
        <div className="mb-4 flex items-start justify-between gap-2">
          <div>
            <h2 id="enq-title" className="font-display text-xl font-semibold text-forest-900">{card.customerName}</h2>
            <p className="text-sm text-stone-600">{[card.suburb, card.assignedTo && `Owner: ${card.assignedTo}`].filter(Boolean).join(" · ")}</p>
          </div>
          <button onClick={onClose} className="btn-secondary !min-h-[36px] !px-3" aria-label="Close panel">✕</button>
        </div>
        {card.service && <p className="mb-3 rounded-lg bg-stone-100 p-3 text-sm">{card.service}</p>}
        <div className="mb-4 flex flex-wrap gap-2">
          {card.phone && <a href={`tel:${card.phone.replace(/\s/g, "")}`} className="btn-secondary">Call {card.phone}</a>}
          {card.customerId && <Link href={`/customers/${card.customerId}`} className="btn-secondary">Customer record</Link>}
          {canEdit && card.customerId && <Link href={`/estimates/new?enquiry=${card.id}`} className="btn-secondary">Start estimate</Link>}
        </div>
        {card.flags.length > 0 && <ul className="mb-4 list-inside list-disc text-sm text-red-800">{card.flags.map((f) => <li key={f}>{f}</li>)}</ul>}
        {!canEdit ? <p className="muted">You can view this enquiry but not change it.</p> : (
          <form onSubmit={onSave} className="space-y-4">
            <div>
              <label htmlFor="status" className="label">Stage</label>
              <select id="status" value={status} onChange={(e) => setStatus(e.target.value)} className="input">{ALL.map((s) => <option key={s}>{s}</option>)}</select>
            </div>
            {status === "Lost" && (
              <div>
                <label htmlFor="reason" className="label">Why was it lost? *</label>
                <select id="reason" name="reason" required className="input" defaultValue=""><option value="" disabled>Choose a reason</option>{LOST.map((r) => <option key={r}>{r}</option>)}</select>
              </div>
            )}
            {status !== "Won" && status !== "Lost" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="nextFollowUp" className="label">Next follow-up</label>
                  <input id="nextFollowUp" name="nextFollowUp" type="date" defaultValue={card.nextFollowUp ?? ""} className="input" />
                </div>
                <div>
                  <label htmlFor="nextAction" className="label">Next action</label>
                  <input id="nextAction" name="nextAction" defaultValue={card.nextAction ?? ""} className="input" />
                </div>
              </div>
            )}
            <fieldset className="rounded-xl border border-stone-200 p-3">
              <legend className="px-1 text-sm font-medium text-stone-700">Log a contact (optional)</legend>
              <div className="grid gap-3 sm:grid-cols-[120px_1fr]">
                <select name="channel" aria-label="Channel" className="input">{["Phone", "Email", "SMS", "WhatsApp", "In Person"].map((c) => <option key={c}>{c}</option>)}</select>
                <input name="summary" aria-label="What was discussed" placeholder="What was discussed" className="input" />
              </div>
            </fieldset>
            {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
            <button type="submit" disabled={busy} className="btn-primary w-full">{busy ? "Saving…" : "Save"}</button>
          </form>
        )}
      </div>
    </div>
  );
}
