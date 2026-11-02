"use client";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

export function NewEstimateForm({ customers, enquiries, customerId, enquiryId }: { customers: { id: string; label: string }[]; enquiries: { id: string; customerId: string; label: string; service: string }[]; customerId?: string; enquiryId?: string }) {
  const router = useRouter();
  const initialEnq = enquiries.find((e) => e.id === enquiryId);
  const [cust, setCust] = useState(initialEnq?.customerId ?? customerId ?? "");
  const [enq, setEnq] = useState(initialEnq?.id ?? "");
  const [title, setTitle] = useState(initialEnq?.service.slice(0, 80) ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const options = useMemo(() => enquiries.filter((e) => e.customerId === cust), [enquiries, cust]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/estimates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ customerId: cust, enquiryId: enq || undefined, title }) }).catch(() => null);
    const json = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res?.ok) return setError(json.issues?.[0]?.message ?? json.error ?? "Couldn't create the estimate");
    router.push(`/estimates/${json.estimate.id}`);
  }

  return (
    <form onSubmit={submit} className="card space-y-4 p-5">
      <div>
        <label htmlFor="customer" className="label">Customer *</label>
        <select id="customer" required value={cust} onChange={(e) => { setCust(e.target.value); setEnq(""); }} className="input">
          <option value="" disabled>Choose a customer</option>
          {customers.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="enquiry" className="label">Enquiry</label>
        <select id="enquiry" value={enq} onChange={(e) => { setEnq(e.target.value); const f = enquiries.find((x) => x.id === e.target.value); if (f && !title) setTitle(f.service.slice(0, 80)); }} className="input" disabled={!cust}>
          <option value="">{options.length ? "Not linked" : "No open enquiries for this customer"}</option>
          {options.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="title" className="label">Job title *</label>
        <input id="title" required minLength={3} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Rear yard paving and turf" className="input" />
      </div>
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      <button type="submit" className="btn-primary" disabled={busy || !cust}>{busy ? "Creating…" : "Create draft"}</button>
    </form>
  );
}
