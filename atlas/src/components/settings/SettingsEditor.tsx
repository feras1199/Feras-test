"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { Settings } from "@/lib/config/settings";

type Stage = { label: string; pct: string };
type Schedule = { key: string; name: string; stages: Stage[] };

/** Percentages are typed as people say them (10 for 10%) and stored as rates (0.1). */
const toPct = (rate: number) => String(Number((rate * 100).toFixed(4)));
const toRate = (pct: string) => Number((Number(pct) / 100).toPrecision(12));
const num = (v: string) => (v.trim() === "" ? NaN : Number(v));

function Field({ label, hint, suffix, children }: { label: string; hint?: string; suffix?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <span className="flex items-center gap-2">
        {children}
        {suffix && <span className="shrink-0 text-sm text-stone-600">{suffix}</span>}
      </span>
      {hint && <span className="mt-1 block text-xs text-stone-500">{hint}</span>}
    </label>
  );
}

export function SettingsEditor({ initial }: { initial: Settings }) {
  const router = useRouter();
  const [b, setB] = useState({ ...initial.business });
  const [p, setP] = useState({
    gst: toPct(initial.pricing.gstRate),
    markup: toPct(initial.pricing.defaultMarkup),
    overhead: toPct(initial.pricing.overheadRate),
    contingency: toPct(initial.pricing.contingencyRate),
    minMargin: toPct(initial.pricing.minMargin),
    maxMargin: toPct(initial.pricing.maxMargin),
    validity: String(initial.pricing.quoteValidityDays),
  });
  const [c, setC] = useState({ enabled: initial.commission.enabled, rate: toPct(initial.commission.rate), base: initial.commission.base, treatment: initial.commission.treatment });
  const [l, setL] = useState({ rate: (initial.labour.defaultRatePerPersonHourCents / 100).toFixed(2), hours: String(initial.labour.hoursPerDay) });
  const [pay, setPay] = useState({ maxDeposit: toPct(initial.payments.maxDepositRate), dueDays: String(initial.payments.dueDays), defaultSchedule: initial.payments.defaultSchedule });
  const [schedules, setSchedules] = useState<Schedule[]>(
    Object.entries(initial.payments.schedules).map(([key, s]) => ({ key, name: s.name, stages: s.stages.map((x) => ({ label: x.label, pct: toPct(x.rate) })) })),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const totals = useMemo(() => schedules.map((s) => Math.round(s.stages.reduce((a, x) => a + (Number(x.pct) || 0) * 100, 0)) / 100), [schedules]);
  const markupMargin = num(p.markup) >= 0 ? (num(p.markup) / (100 + num(p.markup))) * 100 : NaN;

  const updSchedule = (i: number, patch: Partial<Schedule>) => setSchedules((all) => all.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const updStage = (i: number, k: number, patch: Partial<Stage>) => updSchedule(i, { stages: schedules[i]!.stages.map((x, j) => (j === k ? { ...x, ...patch } : x)) });

  function addSchedule() {
    let n = schedules.length + 1;
    while (schedules.some((s) => s.key === `custom${n}`)) n++;
    setSchedules([...schedules, { key: `custom${n}`, name: "New schedule", stages: [{ label: "Deposit", pct: "10" }, { label: "Final", pct: "90" }] }]);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setSaved(null);
    const bad = schedules.findIndex((_, i) => totals[i] !== 100);
    if (bad >= 0) { setError(`"${schedules[bad]!.name}" adds up to ${totals[bad]}%, not 100%`); return; }
    if (num(p.minMargin) >= num(p.maxMargin)) { setError("The lowest margin must be below the highest margin"); return; }
    const body = {
      business: { name: b.name, abn: b.abn, licenceNumber: b.licenceNumber, phone: b.phone, email: b.email },
      pricing: { gstRate: toRate(p.gst), defaultMarkup: toRate(p.markup), overheadRate: toRate(p.overhead), contingencyRate: toRate(p.contingency), minMargin: toRate(p.minMargin), maxMargin: toRate(p.maxMargin), quoteValidityDays: num(p.validity) },
      commission: { enabled: c.enabled, rate: toRate(c.rate), base: c.base, treatment: c.treatment },
      payments: {
        defaultSchedule: pay.defaultSchedule,
        schedules: Object.fromEntries(schedules.map((s) => [s.key, { name: s.name, stages: s.stages.map((x) => ({ label: x.label, rate: toRate(x.pct) })) }])),
        maxDepositRate: toRate(pay.maxDeposit),
        dueDays: num(pay.dueDays),
      },
      labour: { defaultRatePerPersonHourCents: Math.round(num(l.rate) * 100), hoursPerDay: num(l.hours) },
    };
    setBusy(true);
    try {
      const res = await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
      const json = res ? await res.json().catch(() => ({})) : {};
      if (!res?.ok) {
        const issue = json.issues?.[0];
        throw new Error(issue ? `${issue.path}: ${issue.message}` : json.error ?? "Couldn't reach the server. Nothing was saved.");
      }
      setSaved(json.changed ? `Saved ${json.changed} change${json.changed === 1 ? "" : "s"}.` : "Nothing had changed.");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const input = (value: string, set: (v: string) => void, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <input className="input" inputMode="decimal" type="number" step="any" required value={value} onChange={(e) => set(e.target.value)} {...extra} />
  );

  return (
    <form onSubmit={save} className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
      <p className="rounded-xl border border-gold-500 bg-gold-300/30 p-4 text-sm lg:col-span-2">
        Changes apply to new estimates and to drafts that aren&apos;t approved yet. Approved and sent quotes keep the prices they were approved at. Every change is recorded in the Audit log.
      </p>

      <section className="card space-y-4 p-5">
        <h2 className="font-semibold">Pricing</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="GST" suffix="%">{input(p.gst, (v) => setP({ ...p, gst: v }), { min: 0, max: 50, name: "gst" })}</Field>
          <Field label="Default markup on cost" suffix="%" hint={Number.isFinite(markupMargin) ? `= ${markupMargin.toFixed(1)}% gross margin` : undefined}>{input(p.markup, (v) => setP({ ...p, markup: v }), { min: 0, max: 500, name: "markup" })}</Field>
          <Field label="Overhead allowance" suffix="%">{input(p.overhead, (v) => setP({ ...p, overhead: v }), { min: 0, max: 50, name: "overhead" })}</Field>
          <Field label="Contingency" suffix="%">{input(p.contingency, (v) => setP({ ...p, contingency: v }), { min: 0, max: 50, name: "contingency" })}</Field>
          <Field label="Lowest margin without approval" suffix="%">{input(p.minMargin, (v) => setP({ ...p, minMargin: v }), { min: -100, max: 100, name: "minMargin" })}</Field>
          <Field label="Highest margin without approval" suffix="%">{input(p.maxMargin, (v) => setP({ ...p, maxMargin: v }), { min: -100, max: 100, name: "maxMargin" })}</Field>
          <Field label="Quote valid for" suffix="days">{input(p.validity, (v) => setP({ ...p, validity: v }), { min: 1, max: 365, step: 1, inputMode: "numeric", name: "validity" })}</Field>
        </div>
      </section>

      <section className="card space-y-4 p-5">
        <h2 className="font-semibold">Commission and labour</h2>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={c.enabled} onChange={(e) => setC({ ...c, enabled: e.target.checked })} /> Marketing commission on
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Commission rate" suffix="%">{input(c.rate, (v) => setC({ ...c, rate: v }), { min: 0, max: 50, name: "commission", disabled: !c.enabled })}</Field>
          <Field label="Commission is worked out on">
            <select className="input" value={c.base} onChange={(e) => setC({ ...c, base: e.target.value as typeof c.base })} disabled={!c.enabled}>
              <option value="invoice_inc_gst">Invoice total inc GST</option>
              <option value="revenue_ex_gst">Revenue ex GST</option>
            </select>
          </Field>
          <Field label="Commission is">
            <select className="input" value={c.treatment} onChange={(e) => setC({ ...c, treatment: e.target.value as typeof c.treatment })} disabled={!c.enabled}>
              <option value="absorb">Absorbed from profit</option>
              <option value="pass_through">Added to the price</option>
            </select>
          </Field>
          <Field label="Default labour rate" suffix="$ / person-hour" hint="Used for new timesheets">{input(l.rate, (v) => setL({ ...l, rate: v }), { min: 0, max: 1000, step: 0.01, name: "labourRate" })}</Field>
          <Field label="Hours per crew day">{input(l.hours, (v) => setL({ ...l, hours: v }), { min: 0.5, max: 24, name: "hoursPerDay" })}</Field>
        </div>
      </section>

      <section className="card space-y-4 p-5 lg:col-span-2">
        <h2 className="font-semibold">Payment schedules</h2>
        <p className="text-sm text-stone-600">The default schedule is copied onto each new estimate. Changing it doesn&apos;t change estimates that already exist.</p>
        {schedules.map((s, i) => (
          <fieldset key={s.key} className="rounded-xl border border-stone-200 p-4">
            <div className="flex flex-wrap items-end gap-3">
              <label className="min-w-0 flex-1">
                <span className="label">Schedule name</span>
                <input className="input" required value={s.name} onChange={(e) => updSchedule(i, { name: e.target.value })} />
              </label>
              <label className="flex items-center gap-2 pb-2 text-sm">
                <input type="radio" name="defaultSchedule" checked={pay.defaultSchedule === s.key} onChange={() => setPay({ ...pay, defaultSchedule: s.key })} /> Default
              </label>
              {pay.defaultSchedule !== s.key && schedules.length > 1 && (
                <button type="button" className="pb-2 text-sm text-red-700 underline" onClick={() => setSchedules(schedules.filter((_, j) => j !== i))}>Remove schedule</button>
              )}
            </div>
            <ul className="mt-3 space-y-2">
              {s.stages.map((x, k) => (
                <li key={k} className="flex items-center gap-2">
                  <input className="input min-w-0 flex-1" aria-label="Stage name" required value={x.label} onChange={(e) => updStage(i, k, { label: e.target.value })} />
                  <input className="input w-24" aria-label="Stage percent" type="number" inputMode="decimal" step="any" min={0.01} max={100} required value={x.pct} onChange={(e) => updStage(i, k, { pct: e.target.value })} />
                  <span className="text-sm text-stone-600">%</span>
                  {s.stages.length > 1 && <button type="button" aria-label="Remove stage" className="px-2 text-lg text-stone-500" onClick={() => updSchedule(i, { stages: s.stages.filter((_, j) => j !== k) })}>×</button>}
                </li>
              ))}
            </ul>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm">
              <button type="button" className="text-forest-700 underline" onClick={() => updSchedule(i, { stages: [...s.stages, { label: `Progress ${s.stages.length}`, pct: "0" }] })}>Add stage</button>
              <span className={totals[i] === 100 ? "text-stone-600" : "font-medium text-red-700"}>Total {totals[i]}%{totals[i] === 100 ? "" : " (must be 100%)"}</span>
            </div>
          </fieldset>
        ))}
        <button type="button" className="btn-secondary" onClick={addSchedule}>Add a schedule</button>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Warn when the deposit is above" suffix="%" hint="NSW Home Building Act deposit limit: confirm with your contract advisor">{input(pay.maxDeposit, (v) => setPay({ ...pay, maxDeposit: v }), { min: 0, max: 100, name: "maxDeposit" })}</Field>
          <Field label="Payments due after" suffix="days">{input(pay.dueDays, (v) => setPay({ ...pay, dueDays: v }), { min: 0, max: 120, step: 1, inputMode: "numeric", name: "dueDays" })}</Field>
        </div>
      </section>

      <section className="card space-y-4 p-5 lg:col-span-2">
        <h2 className="font-semibold">Business details</h2>
        <p className="text-sm text-stone-600">Shown to customers on quotes and in the customer portal.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Business name"><input className="input" required value={b.name} onChange={(e) => setB({ ...b, name: e.target.value })} /></Field>
          <Field label="ABN"><input className="input" value={b.abn} onChange={(e) => setB({ ...b, abn: e.target.value })} /></Field>
          <Field label="Licence number"><input className="input" value={b.licenceNumber} onChange={(e) => setB({ ...b, licenceNumber: e.target.value })} /></Field>
          <Field label="Phone"><input className="input" type="tel" value={b.phone} onChange={(e) => setB({ ...b, phone: e.target.value })} /></Field>
          <Field label="Email"><input className="input" type="email" value={b.email} onChange={(e) => setB({ ...b, email: e.target.value })} /></Field>
        </div>
      </section>

      <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center gap-3 rounded-xl bg-white/95 p-3 shadow lg:col-span-2">
        <button type="submit" className="btn-primary" disabled={busy}>{busy ? "Saving…" : "Save changes"}</button>
        <Link href="/settings" className="btn-secondary">Back to Settings</Link>
        {saved && <span role="status" className="text-sm text-emerald-800">{saved}</span>}
        {error && <span role="alert" className="text-sm text-red-800">{error}</span>}
      </div>
    </form>
  );
}
