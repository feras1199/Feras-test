"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { SuggestInput } from "@/components/ui/SuggestInput";
import { guessTaskType } from "@/lib/domain/suggestions";

const TYPES = ["Lead Follow-up", "Site Visit", "Estimate", "Quote Review", "Customer Call", "Material / Supplier", "Construction", "Payment", "Variation", "Customer Update", "Management", "Other"];

type Existing = { id: string; title: string; taskType: string; priority: string; dueDate: string; assignedTo: string; notes: string; status: string };
const STATUSES = ["Backlog", "Today", "Doing", "Waiting", "Delayed", "Done", "Cancelled"];

export function TaskForm({ customers, customerId, suggest = { taskTitles: [], people: [] }, task }: { customers: { id: string; label: string }[]; customerId?: string; suggest?: { taskTitles: string[]; people: string[] }; task?: Existing }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [taskType, setTaskType] = useState(task?.taskType && TYPES.includes(task.taskType) ? task.taskType : TYPES[0]!);
  const [typeChosen, setTypeChosen] = useState(!!task);
  // Picking or typing a common task fills in a matching Type, until the person picks a Type themselves.
  const followTitle = (title: string) => { if (typeChosen) return; const t = guessTaskType(title); if (t && TYPES.includes(t)) setTaskType(t); };
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const filled = Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === "string" && v.trim()).map(([k, v]) => [k, String(v).trim()]));
    // When editing, an emptied box clears the field.
    const body = task ? { ...filled, dueDate: filled.dueDate ?? null, customerId: filled.customerId ?? null, notes: filled.notes ?? "", assignedTo: filled.assignedTo ?? "" } : filled;
    setBusy(true);
    setError(null);
    const res = await fetch(task ? `/api/tasks/${task.id}` : "/api/tasks", { method: task ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const json = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res?.ok) return setError(json.issues?.[0]?.message ?? json.error ?? "Couldn't save");
    router.push("/tasks");
    router.refresh();
  }
  return (
    <form onSubmit={onSubmit} className="card space-y-4 p-5">
      <div><label htmlFor="title" className="label">Task *</label><SuggestInput id="title" name="title" required minLength={3} defaultValue={task?.title} options={suggest.taskTitles} limit={10} placeholder="Tap to pick, or type your own" onValueChange={followTitle} /></div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div><label htmlFor="taskType" className="label">Type</label><select id="taskType" name="taskType" className="input" value={taskType} onChange={(e) => { setTaskType(e.target.value); setTypeChosen(true); }}>{TYPES.map((t) => <option key={t}>{t}</option>)}</select></div>
        <div><label htmlFor="priority" className="label">Priority</label><select id="priority" name="priority" defaultValue={task?.priority ?? "Normal"} className="input">{["Critical", "High", "Normal", "Low"].map((t) => <option key={t}>{t}</option>)}</select></div>
        <div><label htmlFor="dueDate" className="label">Due</label><input id="dueDate" name="dueDate" type="date" defaultValue={task?.dueDate} className="input" /></div>
        <div><label htmlFor="assignedTo" className="label">Assigned to</label><SuggestInput id="assignedTo" name="assignedTo" defaultValue={task?.assignedTo} placeholder="You" options={suggest.people} /></div>
        {task && <div><label htmlFor="status" className="label">Status</label><select id="status" name="status" defaultValue={task.status} className="input">{STATUSES.map((t) => <option key={t}>{t}</option>)}</select></div>}
        <div className="sm:col-span-2"><label htmlFor="customerId" className="label">Customer (optional)</label><select id="customerId" name="customerId" defaultValue={customerId ?? ""} className="input"><option value="">None</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></div>
      </div>
      <div><label htmlFor="notes" className="label">Notes</label><textarea id="notes" name="notes" rows={3} defaultValue={task?.notes} className="input py-2" /></div>
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      <div className="flex gap-2"><button type="submit" disabled={busy} className="btn-primary">{busy ? "Saving…" : task ? "Save task" : "Create task"}</button><button type="button" className="btn-secondary" onClick={() => router.back()}>Cancel</button></div>
    </form>
  );
}
