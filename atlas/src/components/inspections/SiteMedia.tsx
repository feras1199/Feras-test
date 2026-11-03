"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export type MediaFile = { id: string; kind: "photo" | "voice"; name: string; durationS?: number; createdBy: string; createdTime: string; transcript?: string };
type AiStatus = { demo: boolean; transcription: boolean; writeUp: boolean };

const MAX_SECONDS = 15 * 60;
const PHOTO_EDGE = 1600;

/** Shrinks a phone photo to a sensible size (and turns HEIC into JPEG) before it is uploaded. */
async function shrinkPhoto(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, PHOTO_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", 0.82));
    if (!blob) throw new Error();
    return blob;
  } catch {
    throw new Error(`Couldn't read ${file.name}. Try taking the photo again.`);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function upload(inspectionId: string, blob: Blob, extra: Record<string, string> = {}) {
  const fd = new FormData();
  fd.append("file", blob);
  for (const [k, v] of Object.entries(extra)) fd.append(k, v);
  const res = await fetch(`/api/inspections/${inspectionId}/files`, { method: "POST", body: fd }).catch(() => null);
  const json = res ? await res.json().catch(() => ({})) : {};
  if (!res?.ok) throw new Error(json.error ?? "Couldn't reach the server. Check your signal and try again.");
}

function recorderType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  return ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/ogg;codecs=opus"].find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const when = (iso: string) => new Date(iso).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export function SiteMedia({ inspectionId, files, editable, available, ai = { demo: false, transcription: false, writeUp: false }, summary = "" }: { inspectionId: string; files: MediaFile[]; editable: boolean; available: boolean; ai?: AiStatus; summary?: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const rec = useRef<{ mr: MediaRecorder; stream: MediaStream; chunks: Blob[]; started: number; timer: number } | null>(null);
  const [writing, setWriting] = useState(false);
  const [aiResult, setAiResult] = useState<string | null>(null);
  const aiReady = ai.transcription && ai.writeUp;
  const photos = files.filter((f) => f.kind === "photo");
  const voices = files.filter((f) => f.kind === "voice");

  useEffect(() => () => {
    const r = rec.current;
    if (r) { clearInterval(r.timer); r.stream.getTracks().forEach((t) => t.stop()); }
  }, []);

  async function addPhotos(list: FileList | null) {
    if (!list?.length) return;
    setBusy(true); setError(null);
    const all = Array.from(list);
    let done = 0;
    try {
      for (const f of all) {
        setStatus(`Saving photo ${done + 1} of ${all.length}…`);
        await upload(inspectionId, await shrinkPhoto(f));
        done++;
      }
      setStatus(`${done} photo${done === 1 ? "" : "s"} saved.`);
    } catch (e) {
      setError(`${(e as Error).message}${done ? ` ${done} of ${all.length} saved.` : ""}`);
      setStatus(null);
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  async function startRecording() {
    setError(null); setStatus(null);
    const type = recorderType();
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("This browser can't record audio. Use Safari on iPhone or Chrome on Android.");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError("ATLAS isn't allowed to use the microphone. Allow the microphone for this site in your browser settings, then try again.");
      return;
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
      if (discard) { setStatus("Recording discarded."); return; }
      const durationS = (Date.now() - r.started) / 1000;
      const blob = new Blob(r.chunks, { type: r.mr.mimeType || "audio/webm" });
      if (durationS < 1 || blob.size === 0) { setError("That recording was empty. Hold on a moment longer before tapping Stop."); return; }
      setBusy(true); setStatus("Saving voice note…");
      try {
        await upload(inspectionId, blob, { durationS: durationS.toFixed(1) });
        setStatus("Voice note saved.");
        if (aiReady) void writeUp();
      } catch (e) {
        setError(`${(e as Error).message} The recording wasn't saved.`);
        setStatus(null);
      } finally {
        setBusy(false);
        router.refresh();
      }
    };
    r.mr.stop();
  }

  async function writeUp() {
    setWriting(true); setError(null); setAiResult(null);
    try {
      const res = await fetch(`/api/inspections/${inspectionId}/ai-fill`, { method: "POST" }).catch(() => null);
      const json = res ? await res.json().catch(() => ({})) : {};
      if (!res?.ok) throw new Error(json.error ?? "Couldn't reach the server. Your voice notes are saved; try Write up again later.");
      const filled: string[] = json.filled ?? [];
      const kept: string[] = json.kept ?? [];
      setAiResult(`${filled.length ? `Filled in: ${filled.join(", ")}.` : "No empty boxes needed filling."}${kept.length ? ` Left your own writing in: ${kept.join(", ")}.` : ""} Check them below before relying on them.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWriting(false);
      router.refresh();
    }
  }

  async function remove(f: MediaFile) {
    if (!confirm(`Remove ${f.name}? It's kept in the history and can be brought back if needed.`)) return;
    setBusy(true); setError(null); setStatus(null);
    const res = await fetch(`/api/files/${f.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ archived: true }) }).catch(() => null);
    if (!res?.ok) setError("Couldn't remove it. Try again.");
    setBusy(false);
    router.refresh();
  }

  if (!available) {
    return <section className="card p-5"><h2 className="font-semibold">Photos and voice notes</h2><p className="mt-1 text-sm text-stone-600">These work once ATLAS runs on its own database.</p></section>;
  }

  return (
    <section className="card p-5" aria-label="Photos and voice notes">
      <h2 className="mb-3 font-semibold">Photos and voice notes</h2>

      <div className="grid gap-4 md:grid-cols-2 [&>*]:min-w-0">
        <div>
          <h3 className="mb-2 text-sm font-semibold text-stone-700">Photos ({photos.length})</h3>
          {photos.length === 0 ? <p className="mb-2 text-sm text-stone-500">No photos yet.</p> : (
            <ul className="mb-3 grid grid-cols-3 gap-2">
              {photos.map((p) => (
                <li key={p.id} className="relative">
                  <a href={`/api/files/${p.id}`} target="_blank" rel="noreferrer" aria-label={`Open ${p.name}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/files/${p.id}`} alt={p.name} loading="lazy" className="aspect-square w-full rounded-lg object-cover" />
                  </a>
                  {editable && <button type="button" onClick={() => remove(p)} disabled={busy} className="absolute right-1 top-1 rounded-full bg-white/90 px-2 text-xs shadow" aria-label={`Remove ${p.name}`}>✕</button>}
                </li>
              ))}
            </ul>
          )}
          {editable && (
            <label className={`btn-secondary inline-flex cursor-pointer ${busy || recording ? "pointer-events-none opacity-50" : ""}`}>
              Take or add photos
              <input type="file" accept="image/*" multiple className="sr-only" disabled={busy || recording} onChange={(e) => { addPhotos(e.target.files); e.target.value = ""; }} />
            </label>
          )}
        </div>

        <div>
          <h3 className="mb-2 text-sm font-semibold text-stone-700">Voice notes ({voices.length})</h3>
          {voices.length === 0 ? <p className="mb-2 text-sm text-stone-500">No voice notes yet.</p> : (
            <ul className="mb-3 space-y-3">
              {voices.map((v) => (
                <li key={v.id} className="rounded-lg border border-stone-200 p-2">
                  <div className="mb-1 flex items-center justify-between gap-2 text-xs text-stone-600">
                    <span className="min-w-0 break-words">{v.name}{v.durationS ? ` · ${clock(v.durationS)}` : ""} · {v.createdBy}</span>
                    {editable && <button type="button" onClick={() => remove(v)} disabled={busy} className="shrink-0 underline" aria-label={`Remove ${v.name}`}>Remove</button>}
                  </div>
                  <audio controls preload="metadata" src={`/api/files/${v.id}`} className="w-full" aria-label={v.name} />
                  {v.transcript !== undefined && <details className="mt-1 text-xs"><summary className="cursor-pointer text-stone-600">What was said</summary><p className="mt-1 whitespace-pre-wrap text-stone-700">{v.transcript || "No speech picked up."}</p></details>}
                  <p className="sr-only">Recorded {when(v.createdTime)}</p>
                </li>
              ))}
            </ul>
          )}
          {editable && (recording ? (
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Recording">
              <span className="inline-flex items-center gap-2 rounded-full bg-red-50 px-3 py-2 text-sm font-medium text-red-800"><span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-600" aria-hidden />Recording {clock(seconds)}</span>
              <button type="button" className="btn-primary" onClick={() => stopRecording()}>Stop and save</button>
              <button type="button" className="btn-secondary" onClick={() => stopRecording(true)}>Discard</button>
            </div>
          ) : (
            <button type="button" className="btn-primary" disabled={busy} onClick={startRecording}>● Record a voice note</button>
          ))}
          {recording && <p className="mt-2 text-xs text-stone-500">Keep ATLAS open while you talk. It stops by itself at 15 minutes.</p>}
        </div>
      </div>

      {voices.length > 0 && (
        <div className="mt-4 rounded-xl border border-stone-200 p-3" aria-label="AI write-up">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">AI write-up{ai.demo ? " (demo stand-in)" : ""}</h3>
            {editable && aiReady && <button type="button" className="btn-secondary !min-h-[36px] !px-3 text-xs" disabled={writing || busy || recording} onClick={writeUp}>{writing ? "Writing up…" : summary ? "Write up again" : "✨ Write up voice notes"}</button>}
          </div>
          {!aiReady && <p className="mt-1 text-xs text-stone-500">Turning voice notes into text and filling in the notes needs two keys on the server: a transcription key and an Anthropic key. Until then, voice notes are saved and play back as normal.</p>}
          {writing && <p className="mt-2 text-sm text-stone-600" role="status">Listening to the voice notes and filling in the site notes…</p>}
          {aiResult && !writing && <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800" role="status">{aiResult}</p>}
          {summary && <div className="mt-2"><p className="label">Meeting summary</p><p className="whitespace-pre-wrap text-sm text-stone-800">{summary}</p></div>}
        </div>
      )}

      {status && !error && <p role="status" className="mt-3 text-sm text-forest-700">{status}</p>}
      {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
    </section>
  );
}
