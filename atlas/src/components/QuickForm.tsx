"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export type QField =
  | { name: string; label: string; type: "text" | "textarea" | "date" | "time"; required?: boolean; placeholder?: string; defaultValue?: string; full?: boolean }
  | { name: string; label: string; type: "money" | "number" | "int" | "percent"; required?: boolean; placeholder?: string; defaultValue?: string; full?: boolean }
  | { name: string; label: string; type: "select"; options: { value: string; label: string }[] | string[]; required?: boolean; defaultValue?: string; full?: boolean }
  | { name: string; label: string; type: "checkbox"; defaultValue?: boolean; full?: boolean };

/**
 * Small JSON form used across the app. Money fields are typed in dollars and
 * sent as integer cents; percent fields are typed as 10 and sent as 0.1.
 */
export function QuickForm({ endpoint, method = "POST", fields, submitLabel, extra, title, onDoneHref, resetOnSuccess = true }: { endpoint: string; method?: string; fields: QField[]; submitLabel: string; extra?: Record<string, unknown>; title?: string; onDoneHref?: string; resetOnSuccess?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  async function submit(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const form = ev.currentTarget;
    const fd = new FormData(form);
    const body: Record<string, unknown> = { ...extra };
    for (const f of fields) {
      const raw = fd.get(f.name);
      if (f.type === "checkbox") { body[f.name] = raw === "on"; continue; }
      const v = typeof raw === "string" ? raw.trim() : "";
      if (v === "") continue;
      if (f.type === "money") body[f.name] = Math.round(Number(v.replace(/[$,]/g, "")) * 100);
      else if (f.type === "number") body[f.name] = Number(v);
      else if (f.type === "int") body[f.name] = Math.round(Number(v));
      else if (f.type === "percent") body[f.name] = Number(v) / 100;
      else body[f.name] = v;
      if (typeof body[f.name] === "number" && !Number.isFinite(body[f.name] as number)) return setError(`${f.label} must be a number`);
    }
    setBusy(true); setError(null); setOk(false);
    const res = await fetch(endpoint, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const json = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res?.ok) return setError(json.issues?.[0]?.message ?? json.error ?? "Couldn't save. Nothing was changed.");
    setOk(true);
    if (resetOnSuccess) form.reset();
    if (onDoneHref) router.push(onDoneHref);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-3" aria-label={title ?? submitLabel}>
      {title && <p className="text-sm font-semibold">{title}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((f) => {
          const id = `${endpoint}-${f.name}`.replace(/[^a-zA-Z0-9-]/g, "-");
          if (f.type === "checkbox") return <label key={f.name} className={`flex items-center gap-2 text-sm ${f.full ? "sm:col-span-2" : ""}`}><input type="checkbox" name={f.name} defaultChecked={f.defaultValue} className="h-5 w-5" />{f.label}</label>;
          const cls = f.full || f.type === "textarea" ? "sm:col-span-2" : "";
          return (
            <div key={f.name} className={cls}>
              <label htmlFor={id} className="label">{f.label}{"required" in f && f.required ? " *" : ""}</label>
              {f.type === "select" ? (
                <select id={id} name={f.name} required={f.required} defaultValue={f.defaultValue ?? ""} className="input">
                  {!f.required && <option value="">Not set</option>}
                  {f.required && !f.defaultValue && <option value="" disabled>Choose…</option>}
                  {f.options.map((o) => (typeof o === "string" ? <option key={o}>{o}</option> : <option key={o.value} value={o.value}>{o.label}</option>))}
                </select>
              ) : f.type === "textarea" ? (
                <textarea id={id} name={f.name} required={f.required} rows={3} defaultValue={f.defaultValue} placeholder={f.placeholder} className="input py-2" />
              ) : (
                <input id={id} name={f.name} required={f.required} defaultValue={f.defaultValue} placeholder={f.placeholder}
                  type={f.type === "date" || f.type === "time" ? f.type : "text"} inputMode={["money", "number", "percent"].includes(f.type) ? "decimal" : f.type === "int" ? "numeric" : undefined} className="input" />
              )}
            </div>
          );
        })}
      </div>
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      <div className="flex items-center gap-3"><button className="btn-primary" disabled={busy}>{busy ? "Saving…" : submitLabel}</button>{ok && <span role="status" className="text-sm text-forest-700">Saved</span>}</div>
    </form>
  );
}

export function ActionButton({ endpoint, method = "PATCH", body, label, confirmText, className = "btn-secondary !min-h-[36px] !px-3 text-xs", prompt, ariaLabel }: { endpoint: string; method?: string; body: Record<string, unknown>; label: string; confirmText?: string; className?: string; prompt?: { field: string; question: string }; ariaLabel?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button className={className} disabled={busy} aria-label={ariaLabel} onClick={async () => {
      if (confirmText && !window.confirm(confirmText)) return;
      const payload = { ...body };
      if (prompt) {
        const answer = window.prompt(prompt.question);
        if (!answer?.trim()) return;
        payload[prompt.field] = answer.trim();
      }
      setBusy(true);
      const res = await fetch(endpoint, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }).catch(() => null);
      setBusy(false);
      if (!res?.ok) { const j = res ? await res.json().catch(() => ({})) : {}; window.alert(j.error ?? "Couldn't save"); return; }
      router.refresh();
    }}>{busy ? "…" : label}</button>
  );
}
