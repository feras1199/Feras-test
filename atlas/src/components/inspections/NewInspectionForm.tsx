"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function NewInspectionForm({ today, customers, enquiries, enquiryId, customerId }: { today: string; customers: { id: string; label: string }[]; enquiries: { id: string; customerId: string; label: string }[]; enquiryId?: string; customerId?: string }) {
  const router = useRouter();
  const pre = enquiries.find((e) => e.id === enquiryId);
  const [cust, setCust] = useState(pre?.customerId ?? customerId ?? "");
  const onlyOne = (c: string) => { const open = enquiries.filter((e) => e.customerId === c); return open.length === 1 ? open[0]!.id : ""; };
  const [enq, setEnq] = useState(pre?.id ?? onlyOne(cust));
  const options = enquiries.filter((e) => e.customerId === cust);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const fd = new FormData(ev.currentTarget);
    setBusy(true);
    setError(null);
    const res = await fetch("/api/inspections", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ customerId: cust, enquiryId: enq || undefined, inspectionDate: fd.get("date") }) }).catch(() => null);
    const json = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res?.ok) return setError(json.issues?.[0]?.message ?? json.error ?? "Couldn't save");
    router.push(`/inspections/${json.inspection.id}`);
  }
  return (
    <form onSubmit={submit} className="card space-y-4 p-5">
      <label className="block"><span className="label">Customer *</span><select required className="input" value={cust} onChange={(e) => { setCust(e.target.value); setEnq(onlyOne(e.target.value)); }}><option value="" disabled>Choose a customer</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
      <label className="block"><span className="label">Which enquiry is this visit for?</span><select name="enquiry" className="input" value={enq} onChange={(e) => setEnq(e.target.value)} disabled={!cust}><option value="">{options.length ? "None, don't link it" : "No open enquiries for this customer"}</option>{options.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}</select>
        <span className="mt-1 block text-xs text-stone-500">An enquiry is the customer&apos;s request on the Pipeline. Linking moves it along by itself: to Site Visit Booked now, and Site Inspected when you tick the inspection complete.</span></label>
      <label className="block"><span className="label">Date *</span><input name="date" type="date" required defaultValue={today} className="input" /></label>
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      <button className="btn-primary" disabled={busy || !cust}>{busy ? "Saving…" : "Book inspection"}</button>
    </form>
  );
}
