"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Chip } from "../ui";
import { EnquiryPanel } from "./EnquiryPanel";

export interface Card {
  id: string;
  title: string;
  customerId: string | null;
  customerName: string;
  phone: string | null;
  suburb: string | null;
  status: string;
  service: string | null;
  budget: number | null;
  nextFollowUp: string | null;
  nextAction: string | null;
  assignedTo: string | null;
  reason: string | null;
  flags: string[];
}

const fmtDate = (d: string | null) => (d ? new Date(d + "T00:00:00Z").toLocaleDateString("en-AU", { day: "numeric", month: "short", timeZone: "UTC" }) : null);

export function Pipeline({ columns, cards, canEdit, today }: { columns: { status: string; label: string }[]; cards: Card[]; canEdit: boolean; today: string }) {
  const router = useRouter();
  const [open, setOpen] = useState<Card | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function move(id: string, status: string) {
    const card = cards.find((c) => c.id === id);
    if (!card || card.status === status) return;
    if (status === "Lost" || status === "Won") return setOpen({ ...card, status: card.status }); // needs a reason: use the panel
    setError(null);
    const res = await fetch(`/api/enquiries/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
    if (!res.ok) setError((await res.json().catch(() => ({}))).error ?? "Couldn't move the enquiry");
    router.refresh();
  }

  return (
    <>
      {error && <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      <div className="-mx-4 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6">
        <div className="flex snap-x gap-3">
          {columns.map((col) => {
            const list = cards.filter((c) => c.status === col.status);
            return (
              <section key={col.status} aria-label={col.label} className="w-[78vw] max-w-[300px] shrink-0 snap-start rounded-2xl bg-stone-100 p-2 sm:w-72"
                onDragOver={(e) => canEdit && e.preventDefault()} onDrop={() => dragging && move(dragging, col.status)}>
                <h2 className="flex items-center justify-between px-2 py-1 text-sm font-semibold text-forest-900">{col.label}<span className="text-stone-500">{list.length}</span></h2>
                <div className="mt-1 space-y-2">
                  {list.length === 0 && <p className="px-2 py-4 text-center text-xs text-stone-400">Empty</p>}
                  {list.map((c) => (
                    <button key={c.id} draggable={canEdit} onDragStart={() => setDragging(c.id)} onDragEnd={() => setDragging(null)} onClick={() => setOpen(c)}
                      className="block w-full rounded-xl border border-stone-200 bg-white p-3 text-left shadow-sm transition hover:border-forest-300">
                      <p className="text-sm font-semibold text-forest-900">{c.customerName}</p>
                      {c.service && <p className="mt-0.5 line-clamp-2 text-xs text-stone-600">{c.service}</p>}
                      <div className="mt-2 flex flex-wrap gap-1">
                        {c.flags.map((f) => <Chip key={f} tone="red">{f}</Chip>)}
                        {c.reason && <Chip tone="stone">{c.reason}</Chip>}
                        {!c.flags.length && c.nextFollowUp && <Chip tone={c.nextFollowUp === today ? "gold" : "stone"}>Follow up {fmtDate(c.nextFollowUp)}</Chip>}
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </div>
      {open && <EnquiryPanel card={open} statuses={[...columns.map((c) => c.status)]} canEdit={canEdit} onClose={() => setOpen(null)} />}
      <p className="mt-2 text-xs text-stone-500">Tap a card to update it. On a computer you can also drag cards between columns. <Link href="/tasks" className="underline">Tasks</Link></p>
    </>
  );
}
