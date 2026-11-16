import { useEffect, useState, type ReactNode } from 'react';
import type { Confidence, PriceStatus } from '../core/types.ts';

export function Field({ label, children, hint, error }: { label: string; children: ReactNode; hint?: string; error?: string | null }) {
  return <label className="field"><span>{label}</span>{children}{error ? <span className="err">{error}</span> : hint ? <small>{hint}</small> : null}</label>;
}

/** Numeric input that never writes an invalid value into the project. */
export function Num({ value, onChange, min, max, step, placeholder, allowNull = false, unit, id, ariaLabel }: { value: number | null | undefined; onChange: (v: number | null) => void; min?: number; max?: number; step?: number; placeholder?: string; allowNull?: boolean; unit?: string; id?: string; ariaLabel?: string }) {
  const [text, setText] = useState(value == null ? '' : String(value));
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setText(value == null ? '' : String(Math.round(value * 1e6) / 1e6)); setErr(null); }, [value]);
  const commit = () => {
    const t = text.trim().replace(',', '.');
    if (t === '') { if (allowNull) { setErr(null); if (value != null) onChange(null); } else { setErr('Required'); } return; }
    const v = Number(t);
    if (!isFinite(v)) { setErr('Enter a number'); return; }
    if (min != null && v < min) { setErr(`Must be at least ${min}`); return; }
    if (max != null && v > max) { setErr(`Must be at most ${max}`); return; }
    setErr(null);
    if (v !== value) onChange(v);
  };
  return <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <input id={id} aria-label={ariaLabel} inputMode="decimal" className={err ? 'invalid' : ''} value={text} placeholder={placeholder ?? (allowNull ? 'unknown' : '')} step={step}
        onChange={e => setText(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(); (e.target as HTMLInputElement).blur(); } }} aria-invalid={!!err} />
      {unit && <small style={{ whiteSpace: 'nowrap' }}>{unit}</small>}
    </span>
    {err && <small role="alert" style={{ color: 'var(--danger)' }}>{err}</small>}
  </span>;
}

export function Text({ value, onChange, placeholder, area, ariaLabel }: { value: string; onChange: (v: string) => void; placeholder?: string; area?: boolean; ariaLabel?: string }) {
  const [t, setT] = useState(value);
  useEffect(() => setT(value), [value]);
  const commit = () => { if (t !== value) onChange(t); };
  return area ? <textarea aria-label={ariaLabel} value={t} placeholder={placeholder} onChange={e => setT(e.target.value)} onBlur={commit} />
    : <input aria-label={ariaLabel} value={t} placeholder={placeholder} onChange={e => setT(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />;
}

export function Select<T extends string>({ value, onChange, options, ariaLabel }: { value: T; onChange: (v: T) => void; options: readonly (readonly [T, string])[]; ariaLabel?: string }) {
  return <select aria-label={ariaLabel} value={value} onChange={e => onChange(e.target.value as T)}>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>;
}

export const ConfBadge = ({ c }: { c: Confidence }) => <span className={`badge ${c === 'verified' ? 'ok' : c === 'estimated' ? 'warn' : ''}`}>{c === 'verified' ? 'Verified' : c === 'estimated' ? 'Estimated' : 'Unknown'}</span>;

export const PriceBadge = ({ s }: { s: PriceStatus | 'assumption' | 'unknown-qty' }) => {
  const map = { verified: ['ok', 'Verified price'], placeholder: ['warn', 'Placeholder'], 'quote-required': ['danger', 'Quote required'], outdated: ['warn', 'Outdated'], assumption: ['warn', 'Assumption'], 'unknown-qty': ['danger', 'Qty incomplete'] } as const;
  return <span className={`badge ${map[s][0]}`}>{map[s][1]}</span>;
};

export function Banner({ kind, children }: { kind: 'warn' | 'danger' | 'info' | 'ok'; children: ReactNode }) {
  return <div className={`banner ${kind}`} role={kind === 'danger' ? 'alert' : 'note'}><span aria-hidden>{kind === 'ok' ? '✓' : kind === 'info' ? 'ℹ' : '⚠'}</span><div className="grow">{children}</div></div>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) { return <div className="empty"><h3>{title}</h3>{children}</div>; }

export function download(name: string, data: BlobPart, mime: string) {
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const safeName = (s: string) => s.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 60) || 'project';
