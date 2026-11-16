"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Item = { id: string; at: string; by: string; label: string; count: number; restoredAt: string | null; restoredBy: string | null; href: string | null };

const when = (iso: string) => new Date(iso).toLocaleString("en-AU", { timeZone: "Australia/Sydney", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export function RecycleBinList({ items }: { items: Item[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ id: string; text: string; ok: boolean } | null>(null);
  async function restore(it: Item) {
    setBusy(it.id);
    setMsg(null);
    const res = await fetch(`/api/recycle-bin/${it.id}`, { method: "POST" }).catch(() => null);
    const json = res ? await res.json().catch(() => ({})) : {};
    setBusy(null);
    if (!res?.ok) return setMsg({ id: it.id, ok: false, text: json.error ?? "Couldn't restore" });
    setMsg({ id: it.id, ok: true, text: `Restored ${json.restored} record${json.restored === 1 ? "" : "s"}${json.skipped ? ` (${json.skipped} already back)` : ""}.` });
    router.refresh();
  }
  return (
    <ul className="card divide-y divide-stone-100" aria-label="Deleted items">
      {items.map((it) => (
        <li key={it.id} className="flex flex-wrap items-center justify-between gap-2 p-4 text-sm">
          <div className="min-w-0">
            <p className="font-medium">{it.restoredAt && it.href ? <a className="underline" href={it.href}>{it.label}</a> : it.label}</p>
            <p className="text-stone-600">{it.count} record{it.count === 1 ? "" : "s"} · deleted {when(it.at)} by {it.by}{it.restoredAt ? ` · restored ${when(it.restoredAt)} by ${it.restoredBy}` : ""}</p>
            {msg?.id === it.id && <p role="status" className={msg.ok ? "text-forest-800" : "text-red-800"}>{msg.text}</p>}
          </div>
          {!it.restoredAt && <button type="button" className="btn-secondary" disabled={busy === it.id} onClick={() => restore(it)}>{busy === it.id ? "Restoring…" : "Restore"}</button>}
        </li>
      ))}
    </ul>
  );
}
