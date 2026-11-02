"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useState } from "react";
import { Chip, statusTone } from "../ui";
import type { EstimateSummary } from "@/lib/domain/estimates";
import { searchCostItems, type CostOption } from "@/lib/domain/costLibrary";

type Line = { id: string; description: string; costType: string; quantity: number; unit: string; wasteRate: number; unitCostCents: number; priceIncludesGst: boolean; proposalOption: string; customerDescription: string; quantityVerified: boolean; measurementId: string | null; costExGst: number };
type Est = { id: string; title: string; status: string; locked: boolean; quoteNumber: string; customerScope: string; assumptions: string; assumptionsResolved: boolean; markupOverride: number | null; managerOverride: number | null; commissionRate: number | null; validUntil: string | null; internalReviewNotes: string; projectId: string | null };
type Props = {
  estimate: Est;
  customer: { id: string; name: string; suburb: string } | null;
  lines: Line[];
  summary: EstimateSummary;
  settings: { defaultMarkup: number; commissionRate: number; commissionEnabled: boolean; schedules: Record<string, { name: string; stages: { label: string; rate: number }[] }>; gstRate: number };
  costItems: CostOption[];
  measurements: { id: string; label: string; quantity: number; unit: string }[];
  perms: { edit: boolean; approve: boolean; owner: boolean };
};

const aud = (c: number | null | undefined) => (typeof c === "number" ? (c / 100).toLocaleString("en-AU", { style: "currency", currency: "AUD" }) : "–");
const pct = (r: number | null | undefined, d = 1) => (typeof r === "number" ? `${(r * 100).toFixed(d)}%` : "–");
const TYPES = ["Material", "Labour", "Equipment", "Subcontractor", "Delivery", "Disposal", "Permit", "Consumable", "Other"];
const CAT_LABEL: Record<string, string> = { material: "Materials", labour: "Labour", subcontractor: "Subcontractors", equipment: "Equipment", delivery: "Delivery", disposal: "Disposal", permit: "Permits", consumable: "Consumables", other: "Other" };

async function call(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }).catch(() => null);
  const json = res ? await res.json().catch(() => ({})) : {};
  if (!res?.ok) throw Object.assign(new Error(json.issues?.[0] ? `${json.issues[0].path}: ${json.issues[0].message}` : json.error ?? "Couldn't reach the server"), { json });
  return json;
}

export function EstimateBuilder({ estimate: e, customer, lines, summary, settings, costItems, measurements, perms }: Props) {
  const router = useRouter();
  const editable = perms.edit && !e.locked;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Line | null>(null);
  const [dialog, setDialog] = useState<null | "approve" | "send" | "accept" | "decline">(null);
  const p = summary.pricing;

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      router.refresh();
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  const patch = (body: Record<string, unknown>) => run(() => call(`/api/estimates/${e.id}`, "PATCH", body));
  const action = async (body: Record<string, unknown>) => {
    if (body.action === "revise") {
      setBusy(true);
      try {
        const j = await call(`/api/estimates/${e.id}/action`, "POST", body);
        router.push(`/estimates/${j.estimate.id}`);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy(false);
      }
      return;
    }
    if (await run(() => call(`/api/estimates/${e.id}/action`, "POST", body))) setDialog(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2"><h1 className="h1">{e.title}</h1><Chip tone={statusTone(e.status)}>{e.status}</Chip>{e.locked && <Chip tone="stone">Locked</Chip>}</div>
          <p className="muted mt-1">{customer ? <Link href={`/customers/${customer.id}`} className="underline">{customer.name}</Link> : "No customer"}{customer?.suburb ? ` · ${customer.suburb}` : ""}{e.validUntil ? ` · valid until ${new Date(e.validUntil + "T00:00:00Z").toLocaleDateString("en-AU", { timeZone: "UTC" })}` : ""}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/estimates/${e.id}/quote`} className="btn-secondary">{e.locked ? "Quote document" : "Preview quote"}</Link>
          {perms.approve && e.status === "Draft" && <button className="btn-primary" disabled={busy} onClick={() => setDialog("approve")}>Approve price</button>}
          {perms.approve && e.status === "Ready" && <button className="btn-primary" disabled={busy} onClick={() => setDialog("send")}>Mark as sent</button>}
          {perms.approve && (e.status === "Quoted" || e.status === "Ready") && <button className="btn-gold" disabled={busy} onClick={() => setDialog("accept")}>Record acceptance</button>}
          {perms.edit && e.status === "Quoted" && <button className="btn-secondary" disabled={busy} onClick={() => setDialog("decline")}>Declined</button>}
          {perms.edit && e.locked && e.status !== "Accepted" && e.status !== "Superseded" && <button className="btn-secondary" disabled={busy} onClick={() => action({ action: "revise" })}>Revise</button>}
        </div>
      </div>
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {e.status === "Accepted" && e.projectId && <p className="rounded-xl bg-forest-50 p-3 text-sm text-forest-900">Accepted. The project and payment schedule have been created.</p>}

      <div className="grid gap-6 lg:grid-cols-[1fr_340px] [&>*]:min-w-0">
        <div className="space-y-6">
          <section className="card overflow-hidden">
            <div className="flex items-center justify-between border-b border-stone-100 p-4"><h2 className="font-semibold">Cost lines</h2><span className="text-sm text-stone-500">{lines.length} lines · {summary.personHours} person-hours</span></div>
            {lines.length === 0 ? <p className="p-6 text-center text-sm text-stone-500">No cost lines yet. Add materials, labour, disposal and delivery below.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500"><tr><th className="p-3">Item</th><th className="p-3">Type</th><th className="p-3 text-right">Qty</th><th className="p-3 text-right">Unit price</th><th className="p-3 text-right">Cost ex GST</th><th className="p-3" /></tr></thead>
                  <tbody className="divide-y divide-stone-100">
                    {lines.map((l) => (
                      <tr key={l.id} className={l.proposalOption !== "Included" && l.proposalOption !== "Internal Only" ? "bg-gold-300/10" : ""}>
                        <td className="p-3"><span className="font-medium">{l.description}</span>{l.proposalOption !== "Included" && <span className="ml-2 text-xs text-gold-600">{l.proposalOption}</span>}{!l.quantityVerified && <span className="ml-2 text-xs text-red-700">qty not verified</span>}</td>
                        <td className="p-3 text-stone-600">{l.costType}</td>
                        <td className="p-3 text-right">{l.quantity} {l.unit}{l.wasteRate ? <span className="block text-xs text-stone-500">+{pct(l.wasteRate, 0)} waste</span> : null}</td>
                        <td className="p-3 text-right">{aud(l.unitCostCents)}<span className="block text-xs text-stone-500">{l.costType === "Labour" ? "per person-hour" : l.priceIncludesGst ? "inc GST" : "ex GST"}</span></td>
                        <td className="p-3 text-right font-medium">{aud(l.costExGst)}</td>
                        <td className="p-3 text-right">{editable && <div className="flex justify-end gap-1"><button className="btn-secondary !min-h-[32px] !px-2 text-xs" onClick={() => setEditing(l)}>Edit</button><button className="btn-secondary !min-h-[32px] !px-2 text-xs" aria-label={`Remove ${l.description}`} onClick={() => confirm(`Remove "${l.description}" from this estimate?`) && run(() => call(`/api/estimates/${e.id}/lines/${l.id}`, "DELETE"))}>Remove</button></div>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {editable && <LineForm key={editing?.id ?? "new"} estimateId={e.id} line={editing} costItems={costItems} gstRate={settings.gstRate} measurements={measurements} onDone={() => { setEditing(null); router.refresh(); }} />}
          </section>

          <ScopeEditor e={e} editable={editable} onSave={patch} busy={busy} />
        </div>

        <aside className="space-y-4">
          <section className="card p-4">
            <h2 className="mb-2 font-semibold">Price</h2>
            <dl className="space-y-1 text-sm">
              {Object.entries(summary.costByCategory).filter(([, v]) => v).map(([k, v]) => <Row key={k} k={CAT_LABEL[k] ?? k} v={aud(v)} muted />)}
              {p.overhead > 0 && <Row k="Overhead" v={aud(p.overhead)} muted />}
              {p.contingency > 0 && <Row k="Contingency" v={aud(p.contingency)} muted />}
              <Row k="Cost base (ex GST)" v={aud(p.costBase)} strong />
              <Row k={`Markup ${pct(p.markupRate)}`} v={aud(p.recommendedExGst - p.costBase)} muted />
              <Row k="Recommended ex GST" v={aud(p.recommendedExGst)} />
              {p.overridden && <Row k="Manager price ex GST" v={aud(p.sellExGst)} />}
              <Row k={`GST ${pct(settings.gstRate, 0)}`} v={aud(p.gst)} muted />
              <div className="mt-2 flex items-baseline justify-between border-t border-stone-200 pt-2"><dt className="font-semibold">Customer price</dt><dd className="font-display text-2xl font-semibold text-forest-900">{aud(p.sellIncGst)}</dd></div>
              <p className="text-right text-xs text-stone-500">inc GST</p>
              <Row k="Gross margin" v={pct(p.grossMargin)} />
              {p.commission > 0 && <><Row k="Marketing commission" v={aud(p.commission)} muted /><Row k="Margin after commission" v={pct(p.operatingMargin)} /></>}
            </dl>
            {perms.approve && !e.locked && <PriceControls e={e} settings={settings} recommended={p.recommendedExGst} onSave={patch} busy={busy} />}
          </section>

          <section className="card p-4">
            <h2 className="mb-2 font-semibold">Payment schedule</h2>
            {summary.schedule ? (
              <ul className="space-y-1 text-sm">{summary.schedule.map((s) => <li key={s.index} className="flex justify-between"><span>{s.label} · {pct(s.rate, 0)}</span><span className="font-medium">{aud(s.amount)}</span></li>)}</ul>
            ) : <p className="text-sm text-red-700">{summary.scheduleErrors.join("; ")}</p>}
            {editable && (
              <label className="mt-3 block text-sm"><span className="label">Use schedule</span>
                <select className="input" defaultValue="" onChange={(ev) => ev.target.value && patch({ schedule: settings.schedules[ev.target.value]!.stages })}>
                  <option value="">Choose a preset…</option>
                  {Object.entries(settings.schedules).map(([k, s]) => <option key={k} value={k}>{s.name}</option>)}
                </select>
              </label>
            )}
          </section>

          {summary.warnings.length > 0 && <section className="rounded-2xl border border-gold-500 bg-gold-300/20 p-4 text-sm"><h2 className="mb-1 font-semibold">Warnings</h2><ul className="list-inside list-disc space-y-1">{summary.warnings.map((w) => <li key={w}>{w}</li>)}</ul></section>}

          <section className="card p-4">
            <h2 className="mb-2 font-semibold">Checks before approval</h2>
            <ul className="space-y-1.5 text-sm">
              {summary.checks.map((c) => (
                <li key={c.id} className="flex gap-2">
                  <span aria-hidden className={c.passed ? "text-forest-600" : c.severity === "block" ? "text-red-700" : "text-gold-600"}>{c.passed ? "✓" : c.severity === "block" ? "✕" : "!"}</span>
                  <span><span className={c.passed ? "" : "font-medium"}>{c.label}</span>{!c.passed && <span className="sr-only"> ({c.severity === "block" ? "must fix" : "warning"})</span>}{!c.passed && c.detail && <span className="block text-xs text-stone-500">{c.detail}</span>}</span>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>

      {dialog && <ActionDialog kind={dialog} e={e} summary={summary} perms={perms} busy={busy} error={error} onClose={() => { setDialog(null); setError(null); }} onSubmit={action} />}
    </div>
  );
}

function Row({ k, v, muted, strong }: { k: string; v: React.ReactNode; muted?: boolean; strong?: boolean }) {
  return <div className={`flex justify-between gap-2 ${muted ? "text-stone-600" : ""} ${strong ? "font-semibold" : ""}`}><dt>{k}</dt><dd>{v}</dd></div>;
}

function PriceControls({ e, settings, recommended, onSave, busy }: { e: Est; settings: Props["settings"]; recommended: number; onSave: (b: Record<string, unknown>) => Promise<boolean>; busy: boolean }) {
  const [markup, setMarkup] = useState(((e.markupOverride ?? settings.defaultMarkup) * 100).toString());
  const [override, setOverride] = useState(e.managerOverride ? (e.managerOverride / 100).toString() : "");
  const [commission, setCommission] = useState((e.commissionRate ?? 0) > 0);
  return (
    <form className="mt-4 space-y-3 border-t border-stone-100 pt-3" onSubmit={(ev) => {
      ev.preventDefault();
      const m = Number(markup) / 100;
      const o = override.trim() ? Math.round(Number(override.replace(/[$,]/g, "")) * 100) : null;
      if (!Number.isFinite(m) || (o !== null && !Number.isFinite(o))) return;
      onSave({ markupOverride: Math.abs(m - settings.defaultMarkup) < 1e-9 ? null : m, managerOverride: o, commissionRate: commission ? settings.commissionRate : null });
    }}>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-sm"><span className="label">Markup %</span><input className="input" inputMode="decimal" value={markup} onChange={(x) => setMarkup(x.target.value)} /></label>
        <label className="text-sm"><span className="label">Price override ex GST</span><input className="input" inputMode="decimal" placeholder={(recommended / 100).toFixed(0)} value={override} onChange={(x) => setOverride(x.target.value)} /></label>
      </div>
      {settings.commissionEnabled && <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5" checked={commission} onChange={(x) => setCommission(x.target.checked)} />Marketing commission applies ({pct(settings.commissionRate, 0)})</label>}
      <button className="btn-secondary w-full" disabled={busy}>Update price</button>
    </form>
  );
}

function ScopeEditor({ e, editable, onSave, busy }: { e: Est; editable: boolean; onSave: (b: Record<string, unknown>) => Promise<boolean>; busy: boolean }) {
  return (
    <section className="card p-4">
      <h2 className="mb-3 font-semibold">Scope for the customer</h2>
      <form className="space-y-3" onSubmit={(ev) => { ev.preventDefault(); const fd = new FormData(ev.currentTarget); onSave({ customerScope: String(fd.get("customerScope")), assumptions: String(fd.get("assumptions")), assumptionsResolved: fd.get("assumptionsResolved") === "on" }); }}>
        <label className="block text-sm"><span className="label">What's included</span><textarea name="customerScope" rows={5} defaultValue={e.customerScope} disabled={!editable} className="input py-2" placeholder="Describe the work in plain language. This appears on the quote." /></label>
        <label className="block text-sm"><span className="label">Exclusions and assumptions</span><textarea name="assumptions" rows={4} defaultValue={e.assumptions} disabled={!editable} className="input py-2" placeholder="e.g. Council approval by owner; no rock excavation allowed for" /></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="assumptionsResolved" defaultChecked={e.assumptionsResolved} disabled={!editable} className="h-5 w-5" />Exclusions and assumptions have been reviewed</label>
        {editable && <button className="btn-secondary" disabled={busy}>Save scope</button>}
      </form>
    </section>
  );
}

function LineForm({ estimateId, line, costItems, gstRate, measurements, onDone }: { estimateId: string; line: Line | null; costItems: CostOption[]; gstRate: number; measurements: Props["measurements"]; onDone: () => void }) {
  const [measurementId, setMeasurementId] = useState(line?.measurementId ?? "");
  const [qty, setQty] = useState(line ? String(line.quantity) : "");
  const [type, setType] = useState(line?.costType ?? "Material");
  const [desc, setDesc] = useState(line?.description ?? "");
  const [unit, setUnit] = useState(line?.unit ?? "");
  const [price, setPrice] = useState(line ? (line.unitCostCents / 100).toString() : "");
  const [incGst, setIncGst] = useState(line?.priceIncludesGst ?? true);
  const [costItemId, setCostItemId] = useState<string | undefined>(undefined);
  const [library, setLibrary] = useState<CostOption[]>(costItems);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const [saveToLibrary, setSaveToLibrary] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const listId = useId();
  useEffect(() => setLibrary(costItems), [costItems]); // pick up items added elsewhere after a refresh
  const labour = type === "Labour";
  const matches = useMemo(() => (open && !costItemId ? searchCostItems(library, desc, 8) : []), [open, costItemId, library, desc]);
  const showList = open && !costItemId && desc.trim().length > 0;
  const canSave = !costItemId && desc.trim().length >= 2;

  function pick(c: CostOption) {
    setCostItemId(c.id);
    setDesc(c.name);
    if (c.lineType === "Labour") setType("Labour");
    else if (labour) setType("Material");
    if (c.unit) setUnit(c.unit);
    if (c.priceIncCents !== null) { setPrice((c.priceIncCents / 100).toString()); setIncGst(true); }
    setOpen(false);
    setSaveToLibrary(false);
  }

  function onDescKey(ev: React.KeyboardEvent<HTMLInputElement>) {
    if (!showList) { if (ev.key === "ArrowDown" && desc.trim()) { setOpen(true); setHi(0); ev.preventDefault(); } return; }
    if (ev.key === "ArrowDown") { ev.preventDefault(); setHi((h) => Math.min(h + 1, matches.length - 1)); }
    else if (ev.key === "ArrowUp") { ev.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
    else if (ev.key === "Enter" && matches[hi]) { ev.preventDefault(); pick(matches[hi]!); }
    else if (ev.key === "Escape") { ev.preventDefault(); setOpen(false); }
  }

  async function submit(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const fd = new FormData(ev.currentTarget);
    const body = {
      description: desc.trim(), costType: type, unit: labour ? "person-hour" : unit.trim(),
      quantity: Number(qty), wasteRate: labour ? 0 : Number(fd.get("waste") || 0) / 100,
      unitCostCents: Math.round(Number(String(price).replace(/[$,]/g, "")) * 100), priceIncludesGst: !labour && incGst,
      proposalOption: fd.get("proposalOption"), customerDescription: String(fd.get("customerDescription") ?? ""), quantityVerified: fd.get("quantityVerified") === "on", costItemId, measurementId: measurementId || undefined,
    };
    if (!Number.isFinite(body.quantity) || !Number.isFinite(body.unitCostCents)) return setError("Quantity and price must be numbers");
    setBusy(true);
    setError(null);
    setNote(null);
    const form = ev.currentTarget;
    let saved: CostOption | null = null;
    try {
      if (saveToLibrary && canSave) {
        const priceIncCents = body.priceIncludesGst || labour ? body.unitCostCents : Math.round(body.unitCostCents * (1 + gstRate));
        const res = await call("/api/cost-items", "POST", { name: body.description, unit: labour ? (unit.trim() || "hour") : body.unit, category: type, priceIncCents });
        saved = res.item as CostOption;
        body.costItemId = saved.id;
        setLibrary((l) => (l.some((x) => x.id === saved!.id) ? l : [...l, saved!]));
        setCostItemId(saved.id);
      }
      await call(line ? `/api/estimates/${estimateId}/lines/${line.id}` : `/api/estimates/${estimateId}/lines`, line ? "PATCH" : "POST", body);
      form.reset();
      setDesc(""); setPrice(""); setUnit(""); setCostItemId(undefined); setIncGst(true); setQty(""); setMeasurementId(""); setSaveToLibrary(false);
      if (saved) setNote(`“${saved.name}” is now in your Cost Library.`);
      onDone();
    } catch (err) {
      setError(saved ? `Saved “${saved.name}” to the Cost Library, but the line wasn't added: ${(err as Error).message}` : (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 border-t border-stone-200 bg-stone-50 p-4" aria-label={line ? "Edit line" : "Add line"}>
      <p className="text-sm font-semibold">{line ? `Edit “${line.description}”` : "Add a cost line"}</p>
      <div className="grid gap-3 sm:grid-cols-3 [&>*]:min-w-0">
        <label className="text-sm"><span className="label">Type</span><select className="input" value={type} onChange={(x) => setType(x.target.value)}>{TYPES.map((t) => <option key={t}>{t}</option>)}</select></label>
        <div className="relative text-sm sm:col-span-2">
          <label htmlFor={`${listId}-desc`} className="label">Description *</label>
          <input
            id={`${listId}-desc`} className="input" required minLength={2} name="description" autoComplete="off"
            role="combobox" aria-expanded={showList} aria-controls={`${listId}-list`} aria-autocomplete="list" aria-describedby={`${listId}-hint`}
            aria-activedescendant={showList && matches[hi] ? `${listId}-o${hi}` : undefined}
            value={desc}
            onChange={(x) => { setDesc(x.target.value); setOpen(true); setHi(0); if (costItemId) setCostItemId(undefined); }}
            onFocus={() => desc.trim() && !costItemId && setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={onDescKey}
            placeholder={labour ? "e.g. Lay pavers (2 people × 5 days × 8 h)" : "Start typing, e.g. sa for sandstone"}
          />
          {!costItemId && <p id={`${listId}-hint`} className="mt-1 text-xs text-stone-500">Start typing to search your Cost Library ({library.length} items).</p>}
          {costItemId && <p className="mt-1 text-xs text-emerald-700">From your Cost Library. Edit the price below for this quote only, if needed.</p>}
          {showList && (
            <ul id={`${listId}-list`} role="listbox" aria-label="Cost Library matches" className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-stone-200 bg-white shadow-lg">
              {matches.length === 0 && <li className="px-3 py-2 text-stone-500">No match in the Cost Library. Fill in the line and tick “Save to Cost Library” to add it.</li>}
              {matches.map((c, i) => (
                <li
                  key={c.id} id={`${listId}-o${i}`} role="option" aria-selected={i === hi}
                  onMouseDown={(x) => x.preventDefault()} onClick={() => pick(c)} onMouseEnter={() => setHi(i)}
                  className={`flex cursor-pointer items-start justify-between gap-3 px-3 py-2 ${i === hi ? "bg-emerald-50" : ""}`}
                >
                  <span className="min-w-0"><span className="block break-words font-medium">{c.name}</span><span className="block text-xs text-stone-500">{[c.category, c.supplier].filter(Boolean).join(" · ") || "No category"}</span></span>
                  <span className="shrink-0 text-right text-xs tabular-nums">{c.priceIncCents !== null ? `${aud(c.priceIncCents)}${c.unit ? ` / ${c.unit}` : ""}` : "No price"}{c.priceIncCents !== null && <span className="block text-stone-500">inc GST</span>}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        {!labour && measurements.length > 0 && (
          <label className="text-sm sm:col-span-3"><span className="label">Quantity from a site measurement</span>
            <select className="input" value={measurementId} onChange={(x) => { setMeasurementId(x.target.value); const m = measurements.find((y) => y.id === x.target.value); if (m) { setQty(String(m.quantity)); setUnit(m.unit); } }}>
              <option value="">Not linked</option>{measurements.map((m) => <option key={m.id} value={m.id}>{m.label}: {m.quantity} {m.unit}</option>)}
            </select>
          </label>
        )}
        <label className="text-sm"><span className="label">{labour ? "Person-hours *" : "Quantity *"}</span><input className="input" name="quantity" required inputMode="decimal" value={qty} onChange={(x) => setQty(x.target.value)} /></label>
        {!labour && <label className="text-sm"><span className="label">Unit</span><input className="input" value={unit} onChange={(x) => setUnit(x.target.value)} placeholder="m², lm, each" /></label>}
        {!labour && <label className="text-sm"><span className="label">Waste %</span><input className="input" name="waste" inputMode="decimal" defaultValue={line ? (line.wasteRate * 100).toString() : "0"} /></label>}
        <label className="text-sm"><span className="label">{labour ? "Rate per person-hour *" : "Unit price *"}</span><input className="input" required inputMode="decimal" value={price} onChange={(x) => setPrice(x.target.value)} /></label>
        {!labour && <label className="flex items-center gap-2 self-end pb-3 text-sm"><input type="checkbox" className="h-5 w-5" checked={incGst} onChange={(x) => setIncGst(x.target.checked)} />Price includes GST</label>}
        <label className="text-sm"><span className="label">On the quote as</span><select name="proposalOption" className="input" defaultValue={line?.proposalOption ?? "Included"}>{["Included", "Optional Upgrade", "Alternative", "Internal Only"].map((o) => <option key={o}>{o}</option>)}</select></label>
        <label className="text-sm sm:col-span-2"><span className="label">Customer wording (optional)</span><input name="customerDescription" className="input" defaultValue={line?.customerDescription ?? ""} /></label>
        <label className="flex items-center gap-2 text-sm sm:col-span-3"><input type="checkbox" name="quantityVerified" defaultChecked={line?.quantityVerified ?? false} className="h-5 w-5" />Quantity checked against measurements</label>
        {canSave && <label className="flex items-center gap-2 text-sm sm:col-span-3"><input type="checkbox" className="h-5 w-5" checked={saveToLibrary} onChange={(x) => setSaveToLibrary(x.target.checked)} />Save “{desc.trim()}” to the Cost Library so it can be picked next time</label>}
      </div>
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {note && <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{note}</p>}
      <div className="flex gap-2"><button className="btn-primary" disabled={busy}>{busy ? "Saving…" : line ? "Save line" : "Add line"}</button>{line && <button type="button" className="btn-secondary" onClick={onDone}>Cancel</button>}</div>
    </form>
  );
}

function ActionDialog({ kind, e, summary, perms, busy, error, onClose, onSubmit }: { kind: "approve" | "send" | "accept" | "decline"; e: Est; summary: EstimateSummary; perms: Props["perms"]; busy: boolean; error: string | null; onClose: () => void; onSubmit: (b: Record<string, unknown>) => void }) {
  const total = aud(summary.pricing.sellIncGst);
  const blocked = kind === "approve" && summary.blocking.length > 0;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
      <button className="absolute inset-0 bg-black/40" aria-label="Close" onClick={onClose} />
      <form className="relative w-full max-w-lg rounded-t-2xl bg-paper p-5 shadow-xl sm:rounded-2xl" onSubmit={(ev) => {
        ev.preventDefault();
        const fd = new FormData(ev.currentTarget);
        if (kind === "approve") onSubmit({ action: "approve", overrideReason: blocked ? String(fd.get("reason") ?? "") : undefined });
        if (kind === "send") onSubmit({ action: "send", confirm: true });
        if (kind === "accept") onSubmit({ action: "accept", confirm: true, acceptedBy: String(fd.get("acceptedBy")), method: fd.get("method") });
        if (kind === "decline") onSubmit({ action: "decline", reason: String(fd.get("reason")) });
      }}>
        <h2 id="dlg-title" className="font-display text-xl font-semibold">{{ approve: "Approve this price?", send: "Mark as sent?", accept: "Record customer acceptance", decline: "Customer declined" }[kind]}</h2>
        <div className="mt-3 space-y-3 text-sm">
          {kind === "approve" && <p>This locks the estimate at <strong>{total} inc GST</strong> and saves a snapshot the quote and payments are built from. To change it later you'll create a revision.</p>}
          {blocked && (
            <div className="rounded-xl bg-red-50 p-3 text-red-900">
              <p className="font-semibold">{summary.blocking.length} check(s) are failing:</p>
              <ul className="list-inside list-disc">{summary.blocking.map((b) => <li key={b.id}>{b.label}</li>)}</ul>
              {perms.owner ? <label className="mt-2 block"><span className="label">Reason to approve anyway (owner only, recorded)</span><textarea name="reason" required minLength={10} className="input py-2" rows={2} /></label> : <p className="mt-2">Fix these first, or ask the owner to approve with a reason.</p>}
            </div>
          )}
          {kind === "send" && <p>ATLAS doesn't email quotes yet. Download or print the quote document and send it yourself, then confirm here. The enquiry moves to Proposal Sent with a follow-up in 3 days.</p>}
          {kind === "accept" && (
            <>
              <p>This creates the project and a payment schedule of <strong>{summary.schedule?.length ?? 0} stages totalling {total}</strong>. The deposit becomes due; the other stages are raised as work progresses. Nothing is sent to the customer or QuickBooks.</p>
              <label className="block"><span className="label">Accepted by *</span><input name="acceptedBy" required minLength={2} className="input" placeholder="Customer's name" /></label>
              <label className="block"><span className="label">How *</span><select name="method" className="input">{["Signed quote", "Email", "In person", "Phone"].map((m) => <option key={m}>{m}</option>)}</select></label>
            </>
          )}
          {kind === "decline" && <label className="block"><span className="label">Reason *</span><input name="reason" required minLength={2} className="input" placeholder="e.g. Went with another builder on price" /></label>}
        </div>
        {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
        <div className="mt-5 flex gap-2">
          <button className="btn-primary" disabled={busy || (blocked && !perms.owner)}>{busy ? "Working…" : { approve: blocked ? "Approve anyway" : "Approve and lock", send: "Yes, it's been sent", accept: "Record acceptance", decline: "Mark declined" }[kind]}</button>
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
