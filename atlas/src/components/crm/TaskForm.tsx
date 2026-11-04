"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { SuggestInput } from "@/components/ui/SuggestInput";

const TYPES = ["Lead Follow-up", "Site Visit", "Estimate", "Quote Review", "Customer Call", "Material / Supplier", "Construction", "Payment", "Variation", "Customer Update", "Management", "Other"];

export function TaskForm({ customers, customerId, suggest = { taskTitles: [], people: [] } }: { customers: { id: string; label: string }[]; customerId?: string; suggest?: { taskTitles: string[]; people: string[] } }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const body = Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === "string" && v.trim()).map(([k, v]) => [k, String(v).trim()]));
    setBusy(true);
    setError(null);
    const res = await fetch("/api/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const json = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res?.ok) return setError(json.issues?.[0]?.message ?? json.error ?? "Couldn't save");
    router.push("/tasks");
    router.refresh();
  }
  return (
    <form onSubmit={onSubmit} className="card space-y-4 p-5">
      <div><label htmlFor="title" className="label">Task *</label><SuggestInput id="title" name="title" required minLength={3} options={suggest.taskTitles} showOnFocus={false} /></div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div><label htmlFor="taskType" className="label">Type</label><select id="taskType" name="taskType" className="input">{TYPES.map((t) => <option key={t}>{t}</option>)}</select></div>
        <div><label htmlFor="priority" className="label">Priority</label><select id="priority" name="priority" defaultValue="Normal" className="input">{["Critical", "High", "Normal", "Low"].map((t) => <option key={t}>{t}</option>)}</select></div>
        <div><label htmlFor="dueDate" className="label">Due</label><input id="dueDate" name="dueDate" type="date" className="input" /></div>
        <div><label htmlFor="assignedTo" className="label">Assigned to</label><SuggestInput id="assignedTo" name="assignedTo" placeholder="You" options={suggest.people} /></div>
        <div className="sm:col-span-2"><label htmlFor="customerId" className="label">Customer (optional)</label><select id="customerId" name="customerId" defaultValue={customerId ?? ""} className="input"><option value="">None</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></div>
      </div>
      <div><label htmlFor="notes" className="label">Notes</label><textarea id="notes" name="notes" rows={3} className="input py-2" /></div>
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      <div className="flex gap-2"><button type="submit" disabled={busy} className="btn-primary">{busy ? "Saving…" : "Create task"}</button><button type="button" className="btn-secondary" onClick={() => router.back()}>Cancel</button></div>
    </form>
  );
}
