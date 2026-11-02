"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function NewInspectionForm({ today, customers, enquiries, enquiryId, customerId }: { today: string; customers: { id: string; label: string }[]; enquiries: { id: string; customerId: string; label: string }[]; enquiryId?: string; customerId?: string }) {
  const router = useRouter();
  const pre = enquiries.find((e) => e.id === enquiryId);
  const [cust, setCust] = useState(pre?.customerId ?? customerId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const fd = new FormData(ev.currentTarget);
    setBusy(true);
    setError(null);
    const res = await fetch("/api/inspections", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ customerId: cust, enquiryId: fd.get("enquiry") || undefined, inspectionDate: fd.get("date") }) }).catch(() => null);
    const json = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res?.ok) return setError(json.issues?.[0]?.message ?? json.error ?? "Couldn't save");
    router.push(`/inspections/${json.inspection.id}`);
  }
  return (
    <form onSubmit={submit} className="card space-y-4 p-5">
      <label className="block"><span className="label">Customer *</span><select required className="input" value={cust} onChange={(e) => setCust(e.target.value)}><option value="" disabled>Choose a customer</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
      <label className="block"><span className="label">Enquiry</span><select name="enquiry" className="input" defaultValue={pre?.id ?? ""}><option value="">Not linked</option>{enquiries.filter((e) => e.customerId === cust).map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}</select></label>
      <label className="block"><span className="label">Date *</span><input name="date" type="date" required defaultValue={today} className="input" /></label>
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      <button className="btn-primary" disabled={busy || !cust}>{busy ? "Saving…" : "Book inspection"}</button>
    </form>
  );
}
