"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Chip } from "../ui";

type T = { id: string; title: string; status: string; priority: string; dueDate: string | null; assignedTo: string | null; taskType: string | null; mine: boolean };
const STATUSES = ["Backlog", "Today", "Doing", "Waiting", "Delayed", "Done", "Cancelled"];

export function TaskList({ tasks, today, canEditAll }: { tasks: T[]; today: string; canEditAll: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  async function set(id: string, status: string) {
    setError(null);
    const res = await fetch(`/api/tasks/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
    if (!res.ok) setError((await res.json().catch(() => ({}))).error ?? "Couldn't update the task");
    router.refresh();
  }
  return (
    <>
      {error && <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      <ul className="card divide-y divide-stone-100">
        {tasks.map((t) => {
          const overdue = !!t.dueDate && t.dueDate < today && t.status !== "Done" && t.status !== "Cancelled";
          const editable = canEditAll || t.mine;
          return (
            <li key={t.id} className="flex flex-wrap items-center gap-3 p-4">
              {editable && t.status !== "Done" && (
                <button onClick={() => set(t.id, "Done")} className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-forest-500 hover:bg-forest-50" aria-label={`Mark "${t.title}" done`} />
              )}
              <div className="min-w-0 flex-1">
                <p className={`font-medium ${t.status === "Done" ? "text-stone-400 line-through" : ""}`}>{t.title}</p>
                <p className="text-xs text-stone-500">{[t.taskType, t.assignedTo].filter(Boolean).join(" · ")}</p>
              </div>
              {t.priority !== "Normal" && <Chip tone={t.priority === "Critical" || t.priority === "High" ? "red" : "stone"}>{t.priority}</Chip>}
              {t.dueDate && <span className={`text-xs ${overdue ? "font-semibold text-red-700" : "text-stone-500"}`}>{overdue ? "Overdue · " : ""}{new Date(t.dueDate + "T00:00:00Z").toLocaleDateString("en-AU", { day: "numeric", month: "short", timeZone: "UTC" })}</span>}
              {editable && (
                <select aria-label={`Status of ${t.title}`} value={t.status} onChange={(e) => set(t.id, e.target.value)} className="input !min-h-[36px] !w-auto py-1 text-sm">
                  {STATUSES.map((s) => <option key={s}>{s}</option>)}
                </select>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
