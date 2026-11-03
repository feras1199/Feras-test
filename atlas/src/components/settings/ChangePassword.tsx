"use client";
import { useState } from "react";

export function ChangePassword() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    if (fd.get("next") !== fd.get("again")) return setMsg({ ok: false, text: "The new passwords don't match" });
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/account/password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ current: fd.get("current"), next: fd.get("next") }) }).catch(() => null);
    const json = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (res?.ok) { form.reset(); setMsg({ ok: true, text: "Password changed." }); }
    else setMsg({ ok: false, text: json.issues?.[0]?.message ?? json.error ?? "Couldn't reach the server" });
  }
  return (
    <form onSubmit={submit} className="space-y-3" aria-label="Change password">
      <h2 className="font-semibold">Change password</h2>
      <label className="block text-sm"><span className="label">Current password</span><input name="current" type="password" autoComplete="current-password" required className="input" /></label>
      <label className="block text-sm"><span className="label">New password (10+ characters)</span><input name="next" type="password" autoComplete="new-password" required minLength={10} className="input" /></label>
      <label className="block text-sm"><span className="label">New password again</span><input name="again" type="password" autoComplete="new-password" required minLength={10} className="input" /></label>
      {msg && <p role={msg.ok ? "status" : "alert"} className={`rounded-lg px-3 py-2 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`}>{msg.text}</p>}
      <button className="btn-primary" disabled={busy}>{busy ? "Saving…" : "Change password"}</button>
    </form>
  );
}
