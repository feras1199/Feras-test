"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function AcceptQuote({ id, total }: { id: string; total: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form className="space-y-3 rounded-xl border border-forest-200 bg-forest-50 p-4" onSubmit={async (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.currentTarget);
      setBusy(true); setError(null);
      const res = await fetch(`/api/portal/accept/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fullName: fd.get("fullName"), agree: fd.get("agree") === "on" }) }).catch(() => null);
      const j = res ? await res.json().catch(() => ({})) : {};
      setBusy(false);
      if (!res?.ok) return setError(j.error ?? "Couldn't reach us. Please try again or call.");
      router.refresh();
    }}>
      <h2 className="font-semibold">Accept this quote</h2>
      <label className="block text-sm"><span className="label">Your full name *</span><input name="fullName" required minLength={2} autoComplete="name" className="input" /></label>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="agree" required className="mt-0.5 h-5 w-5" />I accept this quote for {total} including GST, the payment schedule, and the exclusions above.</label>
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      <button className="btn-primary" disabled={busy}>{busy ? "Sending…" : "Accept quote"}</button>
    </form>
  );
}
