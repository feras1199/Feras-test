"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Dupe = { id: string; name: string; reasons: string[]; strength: "strong" | "possible" };
type Values = Partial<Record<"name" | "phone" | "email" | "address" | "suburb" | "preferredContact" | "customerType" | "leadSource" | "serviceRequested", string>>;

const CONTACT = ["Phone", "Email", "SMS", "WhatsApp", "No Preference"];
const TYPES = ["Residential", "Commercial", "Government", "Other", "Couple", "Family", "Single"];
const SOURCES = ["Word of Mouth", "Hi Pages", "Meta Advertising", "Website", "Google", "Referral", "Social Media"];

export function CustomerForm({ id, initial = {} }: { id?: string; initial?: Values }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [dupes, setDupes] = useState<Dupe[] | null>(null);

  async function submit(form: HTMLFormElement, confirmNotDuplicate = false) {
    setBusy(true);
    setError(null);
    setIssues({});
    const fd = new FormData(form);
    const body: Record<string, unknown> = {};
    for (const [k, v] of fd.entries()) if (typeof v === "string" && (v.trim() || id)) body[k] = v.trim();
    if (confirmNotDuplicate) body.confirmNotDuplicate = true;
    const res = await fetch(id ? `/api/customers/${id}` : "/api/customers", { method: id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const json = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (res?.status === 409) return setDupes(json.dupes);
    if (!res?.ok) {
      setError(json.error ?? "Couldn't save. Check your connection and try again.");
      if (json.issues) setIssues(Object.fromEntries(json.issues.map((i: { path: string; message: string }) => [i.path, i.message])));
      return;
    }
    router.push(`/customers/${json.customer.id}`);
    router.refresh();
  }

  const field = (name: keyof Values, label: string, type = "text", required = false) => (
    <div>
      <label htmlFor={name} className="label">{label}{required && " *"}</label>
      <input id={name} name={name} type={type} defaultValue={initial[name] ?? ""} required={required} className="input" aria-invalid={!!issues[name]} />
      {issues[name] && <p className="mt-1 text-sm text-red-700">{issues[name]}</p>}
    </div>
  );
  const select = (name: keyof Values, label: string, opts: string[]) => (
    <div>
      <label htmlFor={name} className="label">{label}</label>
      <select id={name} name={name} defaultValue={initial[name] ?? ""} className="input">
        <option value="">Not set</option>
        {opts.map((o) => <option key={o}>{o}</option>)}
      </select>
    </div>
  );

  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(e.currentTarget); }} className="card space-y-4 p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        {field("name", "Name", "text", true)}
        {field("phone", "Phone", "tel")}
        {field("email", "Email", "email")}
        {select("preferredContact", "Preferred contact", CONTACT)}
        {field("address", "Street address")}
        {field("suburb", "Suburb")}
        {select("customerType", "Customer type", TYPES)}
        {select("leadSource", "Lead source", SOURCES)}
      </div>
      <div>
        <label htmlFor="serviceRequested" className="label">What do they want done?</label>
        <textarea id="serviceRequested" name="serviceRequested" defaultValue={initial.serviceRequested ?? ""} rows={3} className="input py-2" />
      </div>
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {dupes && (
        <div role="alert" className="rounded-xl border border-gold-500 bg-gold-300/30 p-4 text-sm">
          <p className="font-semibold">This may already be a customer</p>
          <ul className="mt-2 space-y-1">
            {dupes.map((d) => (
              <li key={d.id}><a className="font-medium underline" href={`/customers/${d.id}`} target="_blank" rel="noreferrer">{d.name}</a> · {d.reasons.join(", ")}{d.strength === "strong" ? " (strong match)" : ""}</li>
            ))}
          </ul>
          <button type="button" className="btn-secondary mt-3" disabled={busy} onClick={(e) => submit(e.currentTarget.form!, true)}>It's a different person, save anyway</button>
        </div>
      )}
      <div className="flex gap-2">
        <button type="submit" className="btn-primary" disabled={busy}>{busy ? "Saving…" : id ? "Save changes" : "Create customer"}</button>
        <button type="button" className="btn-secondary" onClick={() => router.back()}>Cancel</button>
      </div>
    </form>
  );
}
