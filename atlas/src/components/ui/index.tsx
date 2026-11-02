import Link from "next/link";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="h1">{title}</h1>
        {subtitle && <p className="muted mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: React.ReactNode; action?: { href: string; label: string } }) {
  return (
    <div className="rounded-2xl border border-dashed border-stone-300 bg-stone-50 px-6 py-10 text-center">
      <p className="font-medium text-forest-900">{title}</p>
      {children && <div className="muted mx-auto mt-1 max-w-md">{children}</div>}
      {action && <Link href={action.href} className="btn-primary mt-4">{action.label}</Link>}
    </div>
  );
}

const TONES: Record<string, string> = {
  green: "bg-forest-100 text-forest-800",
  gold: "bg-gold-300/50 text-forest-900",
  red: "bg-red-100 text-red-800",
  stone: "bg-stone-100 text-stone-700",
  blue: "bg-sky-100 text-sky-800",
};
export function Chip({ tone = "stone", children }: { tone?: keyof typeof TONES; children: React.ReactNode }) {
  return <span className={`chip ${TONES[tone]}`}>{children}</span>;
}

export function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-stone-500">{label}</div>
      <div className="mt-1 font-display text-2xl font-semibold text-forest-900">{value}</div>
      {hint && <div className="mt-1 text-xs text-stone-500">{hint}</div>}
    </div>
  );
}

export function statusTone(status: string | null | undefined): keyof typeof TONES {
  const s = (status ?? "").toLowerCase();
  if (/(won|paid|completed|accepted|on track|active|in progress|approved)/.test(s)) return "green";
  if (/(lost|overdue|declined|cancelled|delayed|at risk)/.test(s)) return "red";
  if (/(proposal|quoted|follow|due|sent|waiting|pending)/.test(s)) return "gold";
  if (/(new|visit|inspect)/.test(s)) return "blue";
  return "stone";
}
