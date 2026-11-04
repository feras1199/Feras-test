"use client";
import { SuggestInput } from "@/components/ui/SuggestInput";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Insp = { id: string; complete: boolean; scope: string; accessDifficulty: string; accessWidthM: number | null; existingConditions: string; slopeLevels: string; drainage: string; services: string; risks: string; priorities: string; notes: string; budgetFit: string };
type M = { id: string; zone: string; workType: string; unit: string; method: string; lengthM: number | null; widthM: number | null; heightM: number | null; measuredQuantity: number | null; confidence: string; verified: boolean; quantity: number | null };

const WORK = ["Paving", "Retaining Wall", "Excavation", "Turfing", "Planting", "Drainage", "Concrete Driveway", "Pergola / Fencing", "Lighting", "Other"];
const UNITS = ["m²", "lm", "m³", "each", "hours", "allowance", "other"];
const CONF = ["Confirmed onsite", "High", "Medium", "Low / Verify"];

async function send(url: string, method: string, body: unknown) {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  const json = res ? await res.json().catch(() => ({})) : {};
  if (!res?.ok) throw new Error(json.issues?.[0]?.message ?? json.error ?? "Couldn't save");
  return json;
}
const num = (v: FormDataEntryValue | null) => (v === null || String(v).trim() === "" ? null : Number(v));

export function InspectionEditor({ inspection: i, measurements, editable, areas = [] }: { inspection: Insp; measurements: M[]; editable: boolean; areas?: string[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [unit, setUnit] = useState("m²");
  const [saved, setSaved] = useState(false);

  async function go(fn: () => Promise<unknown>) {
    setBusy(true); setError(null); setSaved(false);
    try { await fn(); setSaved(true); router.refresh(); return true; } catch (e) { setError((e as Error).message); return false; } finally { setBusy(false); }
  }

  const area = (name: keyof Insp, label: string, rows = 2) => (
    <label className="block text-sm"><span className="label">{label}</span><textarea name={name} rows={rows} defaultValue={String(i[name] ?? "")} disabled={!editable} className="input py-2" /></label>
  );

  return (
    <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
      <section className="card p-5">
        <h2 className="mb-3 font-semibold">Site notes</h2>
        <form className="space-y-3" onSubmit={(ev) => {
          ev.preventDefault();
          const fd = new FormData(ev.currentTarget);
          const body: Record<string, unknown> = {};
          for (const k of ["scope", "existingConditions", "slopeLevels", "drainage", "services", "risks", "priorities", "notes"]) body[k] = String(fd.get(k) ?? "");
          if (fd.get("accessDifficulty")) body.accessDifficulty = fd.get("accessDifficulty");
          if (fd.get("budgetFit")) body.budgetFit = fd.get("budgetFit");
          body.accessWidthM = num(fd.get("accessWidthM"));
          body.complete = fd.get("complete") === "on";
          go(() => send(`/api/inspections/${i.id}`, "PATCH", body));
        }}>
          {area("scope", "What the customer wants", 3)}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm"><span className="label">Access</span><select name="accessDifficulty" defaultValue={i.accessDifficulty} disabled={!editable} className="input"><option value="">Not assessed</option>{["Easy", "Moderate", "Difficult", "Unknown"].map((x) => <option key={x}>{x}</option>)}</select></label>
            <label className="text-sm"><span className="label">Narrowest access (m)</span><input name="accessWidthM" inputMode="decimal" defaultValue={i.accessWidthM ?? ""} disabled={!editable} className="input" /></label>
          </div>
          {area("existingConditions", "Existing conditions")}
          {area("slopeLevels", "Slope and levels")}
          {area("drainage", "Drainage")}
          {area("services", "Services (power, water, gas, sewer)")}
          {area("risks", "Risks and hazards")}
          {area("priorities", "Customer priorities and style")}
          {area("notes", "Other notes")}
          <label className="text-sm"><span className="label">Budget fit</span><select name="budgetFit" defaultValue={i.budgetFit} disabled={!editable} className="input"><option value="">Not assessed</option>{["Good Fit", "Likely Fits", "May Need Scope Change", "Budget Mismatch", "Unknown"].map((x) => <option key={x}>{x}</option>)}</select></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="complete" defaultChecked={i.complete} disabled={!editable} className="h-5 w-5" />Inspection complete</label>
          {editable && <button className="btn-primary" disabled={busy}>{busy ? "Saving…" : "Save notes"}</button>}
          {saved && !error && <span className="ml-3 text-sm text-forest-700" role="status">Saved</span>}
        </form>
      </section>

      <section className="space-y-4">
        <div className="card overflow-hidden">
          <h2 className="border-b border-stone-100 p-4 font-semibold">Measurements</h2>
          {measurements.length === 0 ? <p className="p-4 text-sm text-stone-500">No measurements yet.</p> : (
            <ul className="divide-y divide-stone-100">
              {measurements.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-3 p-4 text-sm">
                  <div><p className="font-medium">{m.zone} · {m.workType}</p><p className="text-xs text-stone-500">{[m.lengthM && `L ${m.lengthM} m`, m.widthM && `W ${m.widthM} m`, m.heightM && `H/D ${m.heightM} m`, m.measuredQuantity !== null && "measured"].filter(Boolean).join(" × ")} · {m.method} · {m.confidence}</p></div>
                  <p className="font-display text-lg font-semibold">{m.quantity ?? "–"} {m.unit}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
        {editable && (
          <form className="card space-y-3 p-4" aria-label="Add measurement" onSubmit={async (ev) => {
            ev.preventDefault();
            const form = ev.currentTarget;
            const fd = new FormData(form);
            const body = { zone: String(fd.get("zone") ?? ""), workType: fd.get("workType"), unit, method: fd.get("method"), lengthM: num(fd.get("lengthM")), widthM: num(fd.get("widthM")), heightM: num(fd.get("heightM")), measuredQuantity: num(fd.get("measuredQuantity")), confidence: fd.get("confidence"), verified: fd.get("confidence") === "Confirmed onsite" };
            if (await go(() => send(`/api/inspections/${i.id}/measurements`, "POST", body))) form.reset();
          }}>
            <p className="text-sm font-semibold">Add a measurement</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="text-sm sm:col-span-2"><span className="label">Area *</span><SuggestInput id={`zone-${i.id}`} name="zone" required options={areas} placeholder="e.g. Rear patio" /></label>
              <label className="text-sm"><span className="label">Work</span><select name="workType" className="input">{WORK.map((w) => <option key={w}>{w}</option>)}</select></label>
              <label className="text-sm"><span className="label">Unit</span><select className="input" value={unit} onChange={(e) => setUnit(e.target.value)}>{UNITS.map((u) => <option key={u}>{u}</option>)}</select></label>
              <label className="text-sm"><span className="label">Length (m)</span><input name="lengthM" inputMode="decimal" className="input" /></label>
              {(unit === "m²" || unit === "m³") && <label className="text-sm"><span className="label">Width (m)</span><input name="widthM" inputMode="decimal" className="input" /></label>}
              {(unit === "m³" || unit === "m²") && <label className="text-sm"><span className="label">{unit === "m³" ? "Depth (m)" : "Height (m, walls)"}</span><input name="heightM" inputMode="decimal" className="input" /></label>}
              <label className="text-sm"><span className="label">Or measured total</span><input name="measuredQuantity" inputMode="decimal" className="input" /></label>
              <label className="text-sm"><span className="label">Method</span><select name="method" className="input">{["Manual onsite", "Google Earth", "Plan / Drawing", "Other"].map((w) => <option key={w}>{w}</option>)}</select></label>
              <label className="text-sm"><span className="label">Confidence</span><select name="confidence" className="input">{CONF.map((w) => <option key={w}>{w}</option>)}</select></label>
            </div>
            <button className="btn-secondary" disabled={busy}>Add measurement</button>
          </form>
        )}
        {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      </section>
    </div>
  );
}
