"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";

type Hit = { type: string; id: string; title: string; subtitle?: string; href: string };

export function GlobalSearch() {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    clearTimeout(timer.current);
    if (q.trim().length < 2) {
      setHits(null);
      return;
    }
    timer.current = setTimeout(async () => {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q.trim())}`).catch(() => null);
      if (!res?.ok) return setErr("Search is unavailable right now");
      setErr(null);
      setHits((await res.json()).hits);
    }, 250);
  }, [q]);

  return (
    <div className="relative max-w-xl">
      <label htmlFor="global-search" className="sr-only">Search customers, enquiries, projects, quotes</label>
      <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
      <input id="global-search" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setQ("")}
        placeholder="Search customers, projects, quotes…" className="input !min-h-[40px] pl-9" autoComplete="off" />
      {(hits || err) && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-96 overflow-auto rounded-xl border border-stone-200 bg-white p-1 shadow-card">
          {err && <p className="p-3 text-sm text-red-700">{err}</p>}
          {hits && hits.length === 0 && <p className="p-3 text-sm text-stone-500">No matches for “{q}”.</p>}
          {hits?.map((h) => (
            <Link key={h.type + h.id} href={h.href} onClick={() => setQ("")} className="flex items-start gap-3 rounded-lg p-2 hover:bg-stone-50">
              <span className="chip mt-0.5 bg-forest-50 text-forest-700">{h.type}</span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{h.title}</span>
                {h.subtitle && <span className="block truncate text-xs text-stone-500">{h.subtitle}</span>}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
