"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Person = { id: string; name: string; email: string; role: string; customerId?: string; active: boolean; source: "host" | "database" | "demo" };
type Props = { me: string; canEdit: boolean; people: Person[]; roles: { value: string; label: string }[]; customers: { id: string; name: string; suburb: string }[] };

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
function newPassword() {
  const bytes = crypto.getRandomValues(new Uint8Array(14));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

async function call(url: string, method: string, body: unknown) {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  const json = res ? await res.json().catch(() => ({})) : {};
  if (!res?.ok) throw new Error(json.issues?.[0]?.message ?? json.error ?? "Couldn't reach the server");
  return json;
}

const SOURCE_NOTE = { host: "Set on the server", demo: "Demo login", database: "" } as const;

export function PeopleAdmin({ me, canEdit, people, roles, customers }: Props) {
  const router = useRouter();
  const [role, setRole] = useState("worker");
  const [pw, setPw] = useState(newPassword);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState<{ who: string; email: string; password: string } | null>(null);
  const roleLabel = (r: string) => roles.find((x) => x.value === r)?.label ?? r;
  const customerName = (id?: string) => customers.find((c) => c.id === id)?.name;

  async function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    setBusy(true); setError(null); setShown(null);
    try {
      const body = { name: fd.get("name"), email: fd.get("email"), role, customerId: role === "customer" ? fd.get("customerId") || undefined : undefined, password: pw };
      await call("/api/people", "POST", body);
      setShown({ who: String(body.name), email: String(body.email), password: pw });
      form.reset(); setRole("worker"); setPw(newPassword());
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function change(p: Person, patch: Record<string, unknown>, confirmText?: string) {
    if (confirmText && !confirm(confirmText)) return;
    setBusy(true); setError(null); setShown(null);
    try {
      await call(`/api/people/${p.id}`, "PATCH", patch);
      if (typeof patch.password === "string") setShown({ who: p.name, email: p.email, password: patch.password });
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
      {shown && (
        <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 lg:col-span-2">
          <p className="font-semibold">Send these to {shown.who}. The password is shown only now.</p>
          <p className="mt-1 break-all">Email: {shown.email}</p>
          <p className="break-all">Password: <span className="font-mono text-base">{shown.password}</span></p>
          <p className="mt-1 text-xs">They can change it under My account after signing in.</p>
        </div>
      )}
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 lg:col-span-2">{error}</p>}

      <section className="card p-5 lg:col-span-2">
        <h2 className="mb-2 font-semibold">Everyone who can sign in</h2>
        <ul className="divide-y divide-stone-100">
          {people.map((p) => {
            const editable = canEdit && p.source === "database";
            const self = p.id === me;
            return (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                <div className="min-w-0">
                  <div className="font-medium">{p.name}{self && " (you)"}{!p.active && <span className="ml-2 rounded bg-stone-200 px-1.5 py-0.5 text-xs">Switched off</span>}</div>
                  <div className="break-all text-xs text-stone-500">{p.email} · {roleLabel(p.role)}{p.role === "customer" && customerName(p.customerId) ? ` · ${customerName(p.customerId)}` : ""}{SOURCE_NOTE[p.source] ? ` · ${SOURCE_NOTE[p.source]}` : ""}</div>
                </div>
                {editable && (
                  <div className="flex flex-wrap gap-2">
                    {!self && p.role !== "customer" && (
                      <select aria-label={`Role for ${p.name}`} className="input !min-h-[36px] !w-auto !py-1 text-xs" value={p.role} disabled={busy} onChange={(e) => change(p, { role: e.target.value }, `Change ${p.name} to ${roleLabel(e.target.value)}? They'll be signed out and see only what that role allows.`)}>
                        {roles.filter((r) => r.value !== "customer").map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                      </select>
                    )}
                    <button type="button" className="btn-secondary !min-h-[36px] !px-2 text-xs" disabled={busy} onClick={() => change(p, { password: newPassword() }, `Reset ${p.name}'s password? Their old one stops working.`)}>Reset password</button>
                    {!self && (p.active
                      ? <button type="button" className="btn-secondary !min-h-[36px] !px-2 text-xs" disabled={busy} onClick={() => change(p, { active: false }, `Switch off ${p.name}'s login? They're signed out straight away. Their records stay.`)}>Switch off</button>
                      : <button type="button" className="btn-secondary !min-h-[36px] !px-2 text-xs" disabled={busy} onClick={() => change(p, { active: true })}>Switch on</button>)}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="card p-5 lg:col-span-2">
        <h2 className="mb-1 font-semibold">Add someone</h2>
        {!canEdit ? (
          <p className="text-sm text-stone-600">Adding people here works once ATLAS runs on its own database. Until then logins come from the server settings.</p>
        ) : (
          <form onSubmit={add} className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0" aria-label="Add someone">
            <label className="text-sm"><span className="label">Name *</span><input name="name" required minLength={2} className="input" /></label>
            <label className="text-sm"><span className="label">Email *</span><input name="email" type="email" required className="input" autoComplete="off" /></label>
            <label className="text-sm"><span className="label">Role *</span>
              <select className="input" value={role} onChange={(e) => setRole(e.target.value)}>{roles.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</select>
            </label>
            {role === "customer" ? (
              <label className="text-sm"><span className="label">Which customer *</span>
                <select name="customerId" required className="input" defaultValue=""><option value="" disabled>Choose…</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}{c.suburb ? `, ${c.suburb}` : ""}</option>)}</select>
              </label>
            ) : <div />}
            <label className="text-sm sm:col-span-2"><span className="label">Starting password</span>
              <span className="flex gap-2"><input className="input font-mono" value={pw} onChange={(e) => setPw(e.target.value)} minLength={10} required /><button type="button" className="btn-secondary shrink-0" onClick={() => setPw(newPassword())}>New</button></span>
            </label>
            <p className="text-xs text-stone-500 sm:col-span-2">{role === "customer" ? "Customers only see their own jobs, quotes and payments." : role === "owner" ? "Owners can see and change everything, including logins." : "Each role only sees what it needs. Workers never see prices or customer details."}</p>
            <div className="sm:col-span-2"><button className="btn-primary" disabled={busy}>{busy ? "Adding…" : "Add login"}</button></div>
          </form>
        )}
      </section>
    </div>
  );
}
