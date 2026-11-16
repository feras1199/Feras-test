"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

type Preview = { label: string; alsoDeleted: string[]; money: string[]; unlinked: number };

/**
 * Delete with a confirm step. It first asks the server what would go with the
 * record, shows that, and needs DELETE typed when money is involved. Deleted
 * records go to the recycle bin (Settings > Recently deleted).
 */
export function DeleteButton({ entity, id, noun, small, onDeleted }: { entity: string; id: string; noun: string; small?: boolean; onDeleted?: () => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setOpen(true);
    setPreview(null);
    setTyped("");
    setError(null);
    const res = await fetch(`/api/records/${entity}/${id}`).catch(() => null);
    const json = res ? await res.json().catch(() => ({})) : {};
    if (!res?.ok) return setError(json.error ?? "Couldn't check what this would delete");
    setPreview(json);
  }

  async function confirm() {
    if (!preview) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/records/${entity}/${id}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm: preview.money.length ? typed.trim() : true }) }).catch(() => null);
    const json = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res?.ok) return setError(json.error ?? "Couldn't delete. Nothing was changed.");
    setOpen(false);
    if (onDeleted) onDeleted();
    else router.push(`${json.next ?? "/"}${String(json.next ?? "/").includes("?") ? "&" : "?"}deleted=${encodeURIComponent(json.label ?? noun)}`);
    router.refresh();
  }

  const needsWord = !!preview?.money.length;
  return (
    <>
      <button type="button" className={`btn border border-red-300 bg-white text-red-800 hover:bg-red-50 ${small ? "!min-h-[32px] !px-2 text-xs" : ""}`} onClick={start} aria-label={small ? `Delete ${noun}` : undefined}>
        Delete{small ? "" : ` ${noun}`}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-labelledby="del-title">
          <button className="absolute inset-0 bg-black/40" aria-label="Close" onClick={() => setOpen(false)} />
          <div className="relative w-full max-w-lg rounded-t-2xl bg-paper p-5 shadow-xl sm:rounded-2xl">
            <h2 id="del-title" className="font-display text-xl font-semibold">Delete this {noun}?</h2>
            {!preview && !error && <p className="mt-3 text-sm text-stone-600">Checking what goes with it…</p>}
            {preview && (
              <div className="mt-3 space-y-3 text-sm">
                <p><strong>{preview.label}</strong> will be deleted{preview.alsoDeleted.length ? ", together with:" : "."}</p>
                {preview.alsoDeleted.length > 0 && <ul className="list-inside list-disc">{preview.alsoDeleted.map((a) => <li key={a}>{a}</li>)}</ul>}
                {needsWord && (
                  <div className="rounded-xl bg-red-50 p-3 text-red-900">
                    <p className="font-semibold">Money is involved: {preview.money.join(", ")}.</p>
                    <p className="mt-1">If the job was cancelled, consider setting the project to Cancelled instead, so the history stays. To delete anyway, type DELETE.</p>
                    <input aria-label="Type DELETE to confirm" className="input mt-2" value={typed} onChange={(e) => setTyped(e.target.value)} autoCapitalize="characters" autoComplete="off" placeholder="DELETE" />
                  </div>
                )}
                <p className="text-stone-600">You can undo this from Settings › Recently deleted.</p>
              </div>
            )}
            {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
            <div className="mt-5 flex gap-2">
              <button type="button" className="btn bg-red-700 text-white hover:bg-red-800" disabled={busy || !preview || (needsWord && typed.trim() !== "DELETE")} onClick={confirm}>{busy ? "Deleting…" : "Delete"}</button>
              <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** A note at the top of the page someone lands on after deleting (?deleted=...). */
export function DeletedNote() {
  const label = useSearchParams().get("deleted");
  if (!label) return null;
  return <p role="status" className="mb-4 rounded-xl bg-forest-50 p-3 text-sm text-forest-900">Deleted: {label}. Changed your mind? <a className="underline" href="/settings/deleted">Restore it from Recently deleted</a>.</p>;
}
