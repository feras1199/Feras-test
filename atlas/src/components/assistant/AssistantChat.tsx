"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { clock, recorderType, shrinkPhoto } from "@/components/media/browser";

interface Proposal { id: string; kind: string; summary: string; details?: string[]; endpoint: string; method: "POST" | "PATCH"; body: Record<string, unknown> }
interface Shared { id: string; kind: "photo" | "voice" | "document"; name: string; transcript?: string }
interface Turn { role: "user" | "assistant"; content: string; files?: Shared[]; lookups?: { tool: string; ok: boolean }[]; proposals?: Proposal[]; status?: string }
type Outcome = { state: "saving" } | { state: "saved"; note?: string; href?: string } | { state: "dismissed" } | { state: "error"; message: string };

const TOOL_LABELS: Record<string, string> = {
  search_records: "Search", today_overview: "Today list", list_enquiries: "Pipeline", get_customer: "Customer", get_project: "Project",
  list_payments: "Payments", get_estimate: "Estimate", list_tasks: "Tasks", propose_task: "Task suggestion", propose_follow_up: "Follow-up suggestion", propose_change_request: "Change request",
  search_cost_library: "Cost Library", propose_customer_details: "Customer details", propose_enquiry: "Enquiry suggestion", propose_estimate_lines: "Estimate lines",
};
const MAX_FILES_PER_MESSAGE = 4;
const MAX_FILES_PER_CHAT = 6;
const MAX_SECONDS = 15 * 60;
const ICON = { photo: "🖼", voice: "🎙", document: "📄" } as const;

async function share(blob: Blob, name: string, extra: Record<string, string> = {}): Promise<Shared> {
  const fd = new FormData();
  fd.append("file", blob, name);
  fd.append("name", name);
  for (const [k, v] of Object.entries(extra)) fd.append(k, v);
  const res = await fetch("/api/assistant/attachments", { method: "POST", body: fd }).catch(() => null);
  const json = res ? await res.json().catch(() => ({})) : {};
  if (!res?.ok) throw new Error(json.error ?? "Couldn't reach the server. Check your signal and try again.");
  return json.file as Shared;
}

/** What to say after a confirmed suggestion is saved, and where to look. */
function savedNote(p: Proposal, json: Record<string, unknown>): { note?: string; href?: string } {
  if (p.kind === "change-request") return { note: "Sent to the owner. Nothing in ATLAS has changed yet." };
  if (p.kind === "customer") { const c = json.customer as { id?: string } | undefined; return { note: "Customer added.", href: c?.id ? `/customers/${c.id}` : undefined }; }
  if (p.kind === "customer-fill") {
    const c = json.customer as { id?: string } | undefined;
    const filled = (json.filled as string[] | undefined) ?? [];
    const kept = (json.kept as string[] | undefined) ?? [];
    const note = filled.length ? `Filled in: ${filled.join(", ")}.` : "Nothing new to fill: those boxes already had details.";
    return { note: kept.length ? `${note} Left as saved: ${kept.join(", ")}.` : note, href: c?.id ? `/customers/${c.id}` : undefined };
  }
  if (p.kind === "enquiry") { const e = json.enquiry as { customerIds?: string[] } | undefined; return { note: "Enquiry added to the pipeline.", href: e?.customerIds?.[0] ? `/customers/${e.customerIds[0]}` : "/pipeline" }; }
  if (p.kind === "estimate-lines") {
    const id = /\/api\/estimates\/([^/]+)\//.exec(p.endpoint)?.[1];
    const scope = json.scopeWritten ? " Customer scope written." : json.scopeKept ? " Your customer scope was left as it is." : "";
    return { note: `Added ${json.added ?? 0} line(s), marked "AI suggested". Check each quantity on the estimate.${scope}`, href: id ? `/estimates/${id}` : undefined };
  }
  return { note: "Saved." };
}

export function AssistantChat({ suggestions, canShare = true }: { suggestions: string[]; canShare?: boolean }) {
  const router = useRouter();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<Shared[]>([]);
  const [uploading, setUploading] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, Outcome>>({});
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const rec = useRef<{ mr: MediaRecorder; stream: MediaStream; chunks: Blob[]; started: number; timer: number } | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Block body: some browsers return a promise from scrollIntoView, which React would treat as a cleanup.
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, busy]);

  const sharedSoFar = turns.reduce((n, t) => n + (t.files?.length ?? 0), 0) + pending.length;
  const roomFor = Math.min(MAX_FILES_PER_MESSAGE - pending.length, MAX_FILES_PER_CHAT - sharedSoFar);

  async function addFiles(list: FileList | null) {
    if (!list?.length) return;
    setError(null);
    const files = Array.from(list).slice(0, Math.max(0, roomFor));
    if (files.length < list.length) setError(roomFor <= 0 ? "That's the most files for one chat. Start a new chat for more." : `Only ${roomFor} more file(s) fit in this message.`);
    for (const f of files) {
      setUploading(`Sending ${f.name}…`);
      try {
        const blob = f.type.startsWith("image/") ? await shrinkPhoto(f) : f;
        const saved = await share(blob, f.name);
        setPending((p) => [...p, saved]);
      } catch (e) {
        setError(`${f.name}: ${(e as Error).message}`);
      } finally {
        setUploading(null);
      }
    }
    if (picker.current) picker.current.value = "";
  }

  async function startRecording() {
    setError(null);
    if (roomFor <= 0) return setError("That's the most files for one chat. Start a new chat for more.");
    const type = recorderType();
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") return setError("This browser can't record audio. Use Safari on iPhone or Chrome on Android.");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return setError("ATLAS isn't allowed to use the microphone. Allow the microphone for this site in your browser settings, then try again.");
    }
    const mr = new MediaRecorder(stream, { ...(type ? { mimeType: type } : {}), audioBitsPerSecond: 64_000 });
    const chunks: Blob[] = [];
    mr.ondataavailable = (ev) => { if (ev.data.size) chunks.push(ev.data); };
    const started = Date.now();
    const timer = window.setInterval(() => {
      const s = (Date.now() - started) / 1000;
      setSeconds(s);
      if (s >= MAX_SECONDS) stopRecording();
    }, 250);
    rec.current = { mr, stream, chunks, started, timer };
    mr.start(1000);
    setSeconds(0);
    setRecording(true);
  }

  function stopRecording(discard = false) {
    const r = rec.current;
    if (!r) return;
    rec.current = null;
    clearInterval(r.timer);
    setRecording(false);
    r.mr.onstop = async () => {
      r.stream.getTracks().forEach((t) => t.stop());
      if (discard) return;
      const durationS = (Date.now() - r.started) / 1000;
      const blob = new Blob(r.chunks, { type: r.mr.mimeType || "audio/webm" });
      if (durationS < 1 || blob.size === 0) return setError("That recording was empty. Hold on a moment longer before tapping Stop.");
      const when = new Date().toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" });
      setUploading("Listening to your voice note…");
      try {
        const saved = await share(blob, `Voice note, ${when}`, { durationS: durationS.toFixed(1) });
        setPending((p) => [...p, saved]);
      } catch (e) {
        setError(`${(e as Error).message} The recording wasn't sent.`);
      } finally {
        setUploading(null);
      }
    };
    r.mr.stop();
  }

  async function ask(text: string) {
    const q = text.trim();
    if ((!q && !pending.length) || busy || uploading || recording) return;
    const next: Turn[] = [...turns, { role: "user", content: q, files: pending.length ? pending : undefined }];
    const sent = pending;
    setTurns(next); setDraft(""); setPending([]); setBusy(true); setError(null);
    const messages = next.slice(-20).map(({ role, content, files }) => ({ role, content, ...(files?.length ? { attachmentIds: files.map((f) => f.id) } : {}) }));
    // A trimmed history must still start with the person's message.
    while (messages.length && messages[0]!.role !== "user") messages.shift();
    const res = await fetch("/api/assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages }) }).catch(() => null);
    const json = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res?.ok) { setError(json.issues?.[0]?.message ?? json.error ?? "Couldn't reach the assistant. Check your connection."); setTurns(turns); setDraft(q); setPending(sent); return; }
    setTurns([...next, { role: "assistant", content: json.text, lookups: json.lookups, proposals: json.proposals, status: json.status }]);
  }

  async function confirm(p: Proposal) {
    setDone((d) => ({ ...d, [p.id]: { state: "saving" } }));
    const res = await fetch(p.endpoint, { method: p.method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(p.body) }).catch(() => null);
    const json = res ? await res.json().catch(() => ({})) : {};
    setDone((d) => ({ ...d, [p.id]: res?.ok ? { state: "saved", ...savedNote(p, json) } : { state: "error", message: json.issues?.[0]?.message ?? json.error ?? "Couldn't save. Nothing was changed." } }));
    if (res?.ok) router.refresh();
  }

  const working = busy || !!uploading;

  return (
    <div className="card flex min-h-[60vh] flex-col p-0">
      <div className="flex-1 space-y-4 p-4 sm:p-5" aria-live="polite">
        {turns.length === 0 && (
          <div>
            <p className="muted mb-3">Try one of these, or ask your own question.{canShare && " You can also share a PDF, photo or voice note and say which job it's for, and ATLAS will suggest what to fill in."}</p>
            <div className="flex flex-wrap gap-2">{suggestions.map((s) => <button key={s} type="button" className="btn-secondary text-sm" onClick={() => ask(s)}>{s}</button>)}</div>
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className={t.role === "user" ? "flex justify-end" : ""}>
            <div className={t.role === "user" ? "max-w-[85%] rounded-2xl bg-forest-700 px-4 py-2 text-white" : "max-w-full"}>
              {!!t.files?.length && (
                <ul className="mb-1 space-y-1 text-xs">
                  {t.files.map((f) => (
                    <li key={f.id}>
                      <span aria-hidden>{ICON[f.kind]} </span><a className="underline break-all" href={`/api/files/${f.id}`} target="_blank" rel="noreferrer">{f.name}</a>
                      {f.transcript && <details className="mt-1"><summary className="cursor-pointer">What was said</summary><p className="whitespace-pre-wrap opacity-90">{f.transcript}</p></details>}
                    </li>
                  ))}
                </ul>
              )}
              {t.content && <p className="whitespace-pre-wrap text-sm leading-relaxed">{t.content}</p>}
              {t.status === "refused" && <p className="mt-1 text-xs text-stone-500">ATLAS declined this one. Try rephrasing.</p>}
              {t.status === "incomplete" && <p className="mt-1 text-xs text-gold-600">This answer may be incomplete.</p>}
              {!!t.lookups?.length && <p className="mt-2 text-xs text-stone-500">Checked: {[...new Set(t.lookups.map((l) => TOOL_LABELS[l.tool] ?? l.tool))].join(", ")}</p>}
              {t.proposals?.map((p) => {
                const st = done[p.id];
                return (
                  <div key={p.id} className="mt-3 rounded-xl border border-gold-300 bg-gold-50 p-3 text-sm" data-proposal={p.kind}>
                    <p className="font-medium">Suggested: {p.summary}</p>
                    {!!p.details?.length && <ul className="mt-2 list-disc space-y-0.5 pl-5 text-stone-700">{p.details.map((d, j) => <li key={j} className="break-words">{d}</li>)}</ul>}
                    {st?.state === "saved" ? (
                      <p className="mt-2 text-forest-700">{st.note}{st.href && <> <Link className="font-semibold underline" href={st.href}>Open</Link></>}</p>
                    ) : st?.state === "dismissed" ? <p className="mt-2 text-stone-500">Dismissed. Nothing was changed.</p>
                      : (
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button type="button" className="btn-primary text-sm" disabled={st?.state === "saving"} onClick={() => confirm(p)}>{st?.state === "saving" ? "Saving…" : "Confirm"}</button>
                          <button type="button" className="btn-secondary text-sm" disabled={st?.state === "saving"} onClick={() => setDone((d) => ({ ...d, [p.id]: { state: "dismissed" } }))}>Dismiss</button>
                        </div>
                      )}
                    {st?.state === "error" && <p role="alert" className="mt-2 text-red-700">{st.message}</p>}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        {busy && <p className="muted text-sm">{turns[turns.length - 1]?.files?.length ? "Reading that…" : "Looking that up…"}</p>}
        <div ref={end} />
      </div>
      <div className="border-t border-stone-200 p-3">
        {(!!pending.length || uploading || recording) && (
          <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
            {pending.map((f) => (
              <span key={f.id} className="inline-flex max-w-full items-center gap-1 rounded-full border border-stone-300 bg-stone-50 py-1 pl-3 pr-1">
                <span aria-hidden>{ICON[f.kind]}</span><span className="truncate">{f.name}</span>
                <button type="button" className="ml-1 inline-flex h-8 w-8 items-center justify-center rounded-full hover:bg-stone-200" aria-label={`Remove ${f.name}`} onClick={() => setPending((p) => p.filter((x) => x.id !== f.id))}>×</button>
              </span>
            ))}
            {uploading && <span className="muted">{uploading}</span>}
            {recording && (
              <span className="inline-flex flex-wrap items-center gap-2">
                <span className="font-semibold text-red-700" aria-live="polite">● Recording {clock(seconds)}</span>
                <button type="button" className="btn-primary text-sm" onClick={() => stopRecording()}>Stop and add</button>
                <button type="button" className="btn-secondary text-sm" onClick={() => stopRecording(true)}>Discard</button>
              </span>
            )}
          </div>
        )}
        <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); ask(draft); }}>
          <label htmlFor="assistant-q" className="sr-only">Ask ATLAS</label>
          <textarea id="assistant-q" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(draft); } }} rows={1} maxLength={4000} placeholder={pending.length ? "Say which job it's for, e.g. “This is for the Sample job, fill the estimate”" : "Ask about customers, jobs, quotes, payments…"} className="input min-w-0 flex-1 basis-48 resize-none py-2" />
          <div className="flex gap-2">
            {canShare && (
              <>
                <input ref={picker} id="assistant-file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp,image/heic,image/*,audio/*" multiple className="sr-only" onChange={(e) => addFiles(e.target.files)} />
                <button type="button" className="btn-secondary" disabled={working || recording || roomFor <= 0} onClick={() => picker.current?.click()} aria-label="Add a PDF or photo" title="Add a PDF or photo">📎</button>
                <button type="button" className="btn-secondary" disabled={working || recording || roomFor <= 0} onClick={startRecording} aria-label="Record a voice note" title="Record a voice note">🎙</button>
              </>
            )}
            <button type="submit" className="btn-primary" disabled={working || recording || (!draft.trim() && !pending.length)}>Ask</button>
          </div>
        </form>
      </div>
      {error && <p role="alert" className="px-4 pb-3 text-sm text-red-700">{error}</p>}
    </div>
  );
}
