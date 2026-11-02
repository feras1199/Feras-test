"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

interface Proposal { id: string; kind: string; summary: string; endpoint: string; method: "POST" | "PATCH"; body: Record<string, unknown> }
interface Turn { role: "user" | "assistant"; content: string; lookups?: { tool: string; ok: boolean }[]; proposals?: Proposal[]; status?: string }

const TOOL_LABELS: Record<string, string> = {
  search_records: "Search", today_overview: "Today list", list_enquiries: "Pipeline", get_customer: "Customer", get_project: "Project",
  list_payments: "Payments", get_estimate: "Estimate", list_tasks: "Tasks", propose_task: "Task suggestion", propose_follow_up: "Follow-up suggestion",
};

export function AssistantChat({ suggestions, canPropose }: { suggestions: string[]; canPropose: boolean }) {
  const router = useRouter();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, "saving" | "saved" | "dismissed" | string>>({});
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Block body: some browsers return a promise from scrollIntoView, which React would treat as a cleanup.
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, busy]);

  async function ask(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    const next: Turn[] = [...turns, { role: "user", content: q }];
    setTurns(next); setDraft(""); setBusy(true); setError(null);
    const res = await fetch("/api/assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: next.slice(-20).map(({ role, content }) => ({ role, content })) }) }).catch(() => null);
    const json = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res?.ok) { setError(json.error ?? "Couldn't reach the assistant. Check your connection."); setTurns(turns); setDraft(q); return; }
    setTurns([...next, { role: "assistant", content: json.text, lookups: json.lookups, proposals: json.proposals, status: json.status }]);
  }

  async function confirm(p: Proposal) {
    setDone((d) => ({ ...d, [p.id]: "saving" }));
    const res = await fetch(p.endpoint, { method: p.method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(p.body) }).catch(() => null);
    const json = res ? await res.json().catch(() => ({})) : {};
    setDone((d) => ({ ...d, [p.id]: res?.ok ? "saved" : `error:${json.issues?.[0]?.message ?? json.error ?? "Couldn't save. Nothing was changed."}` }));
    if (res?.ok) router.refresh();
  }

  return (
    <div className="card flex min-h-[60vh] flex-col p-0">
      <div className="flex-1 space-y-4 p-4 sm:p-5" aria-live="polite">
        {turns.length === 0 && (
          <div>
            <p className="muted mb-3">Try one of these, or ask your own question.</p>
            <div className="flex flex-wrap gap-2">{suggestions.map((s) => <button key={s} type="button" className="btn-secondary text-sm" onClick={() => ask(s)}>{s}</button>)}</div>
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className={t.role === "user" ? "flex justify-end" : ""}>
            <div className={t.role === "user" ? "max-w-[85%] rounded-2xl bg-forest-700 px-4 py-2 text-white" : "max-w-full"}>
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{t.content}</p>
              {t.status === "refused" && <p className="mt-1 text-xs text-stone-500">ATLAS declined this one. Try rephrasing.</p>}
              {t.status === "incomplete" && <p className="mt-1 text-xs text-gold-600">This answer may be incomplete.</p>}
              {!!t.lookups?.length && <p className="mt-2 text-xs text-stone-500">Checked: {[...new Set(t.lookups.map((l) => TOOL_LABELS[l.tool] ?? l.tool))].join(", ")}</p>}
              {t.proposals?.map((p) => {
                const st = done[p.id];
                return (
                  <div key={p.id} className="mt-3 rounded-xl border border-gold-300 bg-gold-50 p-3 text-sm">
                    <p className="font-medium">Suggested: {p.summary}</p>
                    {st === "saved" ? <p className="mt-2 text-forest-700">Saved.</p>
                      : st === "dismissed" ? <p className="mt-2 text-stone-500">Dismissed. Nothing was changed.</p>
                      : !canPropose ? <p className="mt-2 text-stone-500">You don't have permission to make this change.</p>
                      : (
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button type="button" className="btn-primary !min-h-[36px] text-sm" disabled={st === "saving"} onClick={() => confirm(p)}>{st === "saving" ? "Saving…" : "Confirm"}</button>
                          <button type="button" className="btn-secondary !min-h-[36px] text-sm" disabled={st === "saving"} onClick={() => setDone((d) => ({ ...d, [p.id]: "dismissed" }))}>Dismiss</button>
                        </div>
                      )}
                    {st?.startsWith("error:") && <p role="alert" className="mt-2 text-red-700">{st.slice(6)}</p>}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        {busy && <p className="muted text-sm">Looking that up…</p>}
        <div ref={end} />
      </div>
      <form className="flex gap-2 border-t border-stone-200 p-3" onSubmit={(e) => { e.preventDefault(); ask(draft); }}>
        <label htmlFor="assistant-q" className="sr-only">Ask ATLAS</label>
        <textarea id="assistant-q" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(draft); } }} rows={1} maxLength={4000} placeholder="Ask about customers, jobs, quotes, payments…" className="input flex-1 resize-none py-2" />
        <button type="submit" className="btn-primary" disabled={busy || !draft.trim()}>Ask</button>
      </form>
      {error && <p role="alert" className="px-4 pb-3 text-sm text-red-700">{error}</p>}
    </div>
  );
}
