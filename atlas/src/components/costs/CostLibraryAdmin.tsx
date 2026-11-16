"use client";
import { SuggestInput } from "@/components/ui/SuggestInput";
import { rankDistinct, STARTERS } from "@/lib/domain/suggestions";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { CostOption } from "@/lib/domain/costLibrary";

export type LibraryRow = CostOption & { sku: string; notes: string; updated: string | null; source: string; needsUpdate: boolean };

const PAGE = 60;
const aud = (c: number | null) => (c === null ? "No price" : (c / 100).toLocaleString("en-AU", { style: "currency", currency: "AUD" }));
const toCents = (v: string) => {
  const t = v.replace(/[$,\s]/g, "");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : NaN;
};
const fmtDate = (d: string | null) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" }) : "");

async function send(url: string, method: string, body: unknown) {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  const json = res ? await res.json().catch(() => ({})) : {};
  if (!res?.ok) throw new Error(json.issues?.[0]?.message ?? json.error ?? "Couldn't reach the server");
  return json;
}

function ItemForm({ row, lists, onDone, onCancel }: { row?: LibraryRow; lists: { units: string[]; categories: string[]; suppliers: string[] }; onDone: (msg: string) => void; onCancel: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idp = row ? `edit-${row.id}` : "new";
  async function submit(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const fd = new FormData(ev.currentTarget);
    const price = toCents(String(fd.get("price") ?? ""));
    if (Number.isNaN(price)) return setError("The price must be a number, like 45.50");
    if (!row && price === null) return setError("Enter a price for the new item");
    const body = { name: String(fd.get("name")), unit: String(fd.get("unit") ?? ""), category: String(fd.get("category") ?? ""), supplier: String(fd.get("supplier") ?? "") };
    setBusy(true); setError(null);
    try {
      if (row) {
        await send(`/api/cost-items/${row.id}`, "PATCH", { ...body, sku: String(fd.get("sku") ?? ""), notes: String(fd.get("notes") ?? ""), priceIncCents: price, active: fd.get("active") === "on" });
        onDone(`Saved ${body.name}.`);
      } else {
        const r = await send("/api/cost-items", "POST", { ...body, priceIncCents: price });
        onDone(r.existed ? `${body.name} is already in the library, so nothing was added.` : `Added ${body.name}.`);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0" aria-label={row ? `Edit ${row.name}` : "Add an item"}>
      <label className="text-sm sm:col-span-2"><span className="label">Name *</span><input id={`${idp}-name`} name="name" required minLength={2} defaultValue={row?.name} className="input" /></label>
      <label className="text-sm"><span className="label">Price inc GST ($){row ? "" : " *"}</span><input id={`${idp}-price`} name="price" inputMode="decimal" defaultValue={row?.priceIncCents != null ? (row.priceIncCents / 100).toFixed(2) : ""} className="input" placeholder="e.g. 45.50" /></label>
      <label className="text-sm"><span className="label">Unit</span><SuggestInput id={`${idp}-unit`} name="unit" defaultValue={row?.unit} options={lists.units} placeholder="m2, Tonne, Each, hour" /></label>
      <label className="text-sm"><span className="label">Category</span><SuggestInput id={`${idp}-category`} name="category" defaultValue={row?.category} options={lists.categories} placeholder="e.g. Paver, Labour" /></label>
      <label className="text-sm"><span className="label">Supplier</span><SuggestInput id={`${idp}-supplier`} name="supplier" defaultValue={row?.supplier} options={lists.suppliers} /></label>
      {row && <label className="text-sm"><span className="label">Supplier code</span><input id={`${idp}-sku`} name="sku" defaultValue={row.sku} className="input" /></label>}
      {row && <label className="text-sm sm:col-span-2"><span className="label">Notes</span><textarea id={`${idp}-notes`} name="notes" rows={2} defaultValue={row.notes} className="input py-2" /></label>}
      {row && <label className="flex items-center gap-2 text-sm sm:col-span-2"><input id={`${idp}-active`} type="checkbox" name="active" defaultChecked={row.active} className="h-5 w-5" />In use (switched-off items still show in estimates, lower down the list)</label>}
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 sm:col-span-2">{error}</p>}
      <div className="flex gap-2 sm:col-span-2">
        <button className="btn-primary" disabled={busy}>{busy ? "Saving…" : row ? "Save" : "Add to Cost Library"}</button>
        <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
      </div>
      {row && (row.updated || row.source) && <p className="text-xs text-stone-500 sm:col-span-2">Price last changed {fmtDate(row.updated)}{row.source ? ` · ${row.source}` : ""}. Changing it keeps the old price in the price history.</p>}
    </form>
  );
}

export function CostLibraryAdmin({ rows, canEdit }: { rows: LibraryRow[]; canEdit: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [showOff, setShowOff] = useState(true);
  const [limit, setLimit] = useState(PAGE);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const categories = useMemo(() => [...new Set(rows.map((r) => r.category).filter(Boolean))].sort(), [rows]);
  // Suggestions for the add/edit form: most used first.
  const lists = useMemo(() => ({ units: rankDistinct(rows.map((r) => r.unit), STARTERS.units), categories: rankDistinct(rows.map((r) => r.category)), suppliers: rankDistinct(rows.map((r) => r.supplier)) }), [rows]);
  const filtered = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return rows.filter((r) => (!cat || r.category === cat) && (showOff || r.active) && words.every((w) => `${r.name} ${r.category} ${r.supplier} ${r.sku}`.toLowerCase().includes(w)));
  }, [rows, q, cat, showOff]);
  const done = (m: string) => { setMsg(m); setEditing(null); setAdding(false); router.refresh(); };

  return (
    <div className="space-y-4">
      {canEdit && (
        <section className="card p-4">
          {adding ? <ItemForm lists={lists} onDone={done} onCancel={() => setAdding(false)} /> : <button className="btn-primary" onClick={() => { setAdding(true); setMsg(null); }}>Add an item</button>}
        </section>
      )}
      {msg && <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{msg}</p>}

      <section className="card p-4">
        <div className="grid gap-3 sm:grid-cols-3 [&>*]:min-w-0">
          <label className="text-sm sm:col-span-2"><span className="label">Search</span><input id="cl-search" type="search" value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }} className="input" placeholder="Name, supplier or code" /></label>
          <label className="text-sm"><span className="label">Category</span><select id="cl-cat" value={cat} onChange={(e) => { setCat(e.target.value); setLimit(PAGE); }} className="input"><option value="">All categories</option>{categories.map((c) => <option key={c}>{c}</option>)}</select></label>
        </div>
        <label className="mt-2 flex items-center gap-2 text-sm"><input id="cl-off" type="checkbox" checked={showOff} onChange={(e) => setShowOff(e.target.checked)} className="h-5 w-5" />Include switched-off items</label>
        <p className="mt-2 text-xs text-stone-500" aria-live="polite">{filtered.length.toLocaleString("en-AU")} of {rows.length.toLocaleString("en-AU")} items</p>
      </section>

      <ul className="card divide-y divide-stone-100" aria-label="Cost Library items">
        {filtered.length === 0 && <li className="p-4 text-sm text-stone-500">Nothing matches. {canEdit ? "Use Add an item to put it in." : ""}</li>}
        {filtered.slice(0, limit).map((r) => (
          <li key={r.id} className="p-4">
            {editing === r.id ? <ItemForm row={r} lists={lists} onDone={done} onCancel={() => setEditing(null)} /> : (
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="break-words font-medium">{r.name}{!r.active && <span className="ml-2 rounded bg-stone-200 px-1.5 py-0.5 text-xs font-normal">Switched off</span>}{r.needsUpdate && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-normal text-amber-900">Check price</span>}</p>
                  <p className="text-xs text-stone-500">{[r.category, r.supplier].filter(Boolean).join(" · ") || "No category"}{r.updated ? ` · updated ${fmtDate(r.updated)}` : ""}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="text-sm font-medium tabular-nums">{aud(r.priceIncCents)}{r.unit && r.priceIncCents !== null ? <span className="text-xs font-normal text-stone-500"> / {r.unit}</span> : ""}</span>
                  {canEdit && <button className="btn-secondary !min-h-[32px] !px-3 text-xs" onClick={() => { setEditing(r.id); setMsg(null); }} aria-label={`Edit ${r.name}`}>Edit</button>}
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
      {filtered.length > limit && <button className="btn-secondary" onClick={() => setLimit((l) => l + PAGE)}>Show more ({(filtered.length - limit).toLocaleString("en-AU")} left)</button>}
    </div>
  );
}
