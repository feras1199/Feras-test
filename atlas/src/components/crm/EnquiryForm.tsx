"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PhraseChips, SuggestInput } from "@/components/ui/SuggestInput";

const SOURCES = ["Word of Mouth", "Hi Pages", "Meta Advertising", "Website", "Google", "Referral", "Social Media", "Other"];

export function EnquiryForm({ customers, customerId, suggest = { services: [], nextActions: [] } }: { customers: { id: string; label: string }[]; customerId?: string; suggest?: { services: string[]; nextActions: string[] } }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const budget = String(fd.get("budget") ?? "").replace(/[$,\s]/g, "");
    const body = {
      customerId: fd.get("customerId"),
      serviceRequested: String(fd.get("serviceRequested") ?? "").trim(),
      leadSource: fd.get("leadSource") || undefined,
      budgetCents: budget ? Math.round(Number(budget) * 100) : undefined,
      nextFollowUp: fd.get("nextFollowUp") || undefined,
      nextAction: String(fd.get("nextAction") ?? "").trim() || undefined,
    };
    if (body.budgetCents !== undefined && !Number.isFinite(body.budgetCents)) return setError("Budget must be a number");
    setBusy(true);
    setError(null);
    const res = await fetch("/api/enquiries", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const json = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res?.ok) return setError(json.issues?.[0]?.message ?? json.error ?? "Couldn't save");
    router.push("/pipeline");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="card space-y-4 p-5">
      <div>
        <label htmlFor="customerId" className="label">Customer *</label>
        <select id="customerId" name="customerId" required defaultValue={customerId ?? ""} className="input">
          <option value="" disabled>Choose a customer</option>
          {customers.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="serviceRequested" className="label">What do they want done? *</label>
        <textarea id="serviceRequested" name="serviceRequested" required minLength={3} rows={3} className="input py-2" />
        <PhraseChips targetId="serviceRequested" phrases={suggest.services} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="leadSource" className="label">Lead source</label>
          <select id="leadSource" name="leadSource" className="input" defaultValue=""><option value="">Same as customer</option>{SOURCES.map((s) => <option key={s}>{s}</option>)}</select>
        </div>
        <div>
          <label htmlFor="budget" className="label">Customer budget (AUD, optional)</label>
          <input id="budget" name="budget" inputMode="decimal" className="input" placeholder="e.g. 20000" />
        </div>
        <div>
          <label htmlFor="nextFollowUp" className="label">First follow-up</label>
          <input id="nextFollowUp" name="nextFollowUp" type="date" className="input" />
          <p className="mt-1 text-xs text-stone-500">Defaults to tomorrow</p>
        </div>
        <div>
          <label htmlFor="nextAction" className="label">Next action</label>
          <SuggestInput id="nextAction" name="nextAction" placeholder="First contact" options={suggest.nextActions} />
        </div>
      </div>
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" className="btn-primary" disabled={busy}>{busy ? "Saving…" : "Create enquiry"}</button>
        <button type="button" className="btn-secondary" onClick={() => router.back()}>Cancel</button>
      </div>
    </form>
  );
}
