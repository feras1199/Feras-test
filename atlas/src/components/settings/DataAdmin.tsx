"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Preview = { source: string; ignored: string[]; tables: { entity: string; label: string; inFile: number; alreadyInAtlas: number }[] };
type Result = { entity: string; added: number; replaced: number; skipped: number };

const SOURCE_LABEL = { postgres: "ATLAS database", airtable: "Airtable (old base, read and write)", memory: "Demo data (fictional, resets on restart)" } as const;

function AirtablePull({ serverToken, libraryCount }: { serverToken: boolean; libraryCount: number }) {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Result[] | null>(null);

  async function pull() {
    setBusy(true); setError(null); setDone(null);
    try {
      const res = await fetch("/api/admin/airtable-pull", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: token.trim() || undefined, mode: "add-new", confirm: true }) }).catch(() => null);
      const json = res ? await res.json().catch(() => ({})) : {};
      if (!res?.ok) throw new Error(json.issues?.[0]?.message ?? json.error ?? "Couldn't reach the server");
      setDone(json.results); setToken("");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const label: Record<string, string> = { costItems: "Cost Library items", productivity: "productivity rates", omissionRules: "omission rules" };
  return (
    <section className="card p-5 lg:col-span-2" aria-label="Price lists from Airtable">
      <h2 className="mb-1 font-semibold">Get your price lists from Airtable</h2>
      <p className="mb-3 text-sm text-stone-700">
        {libraryCount > 0 ? `Your Cost Library has ${libraryCount.toLocaleString("en-AU")} items. Run this again to add anything new from Airtable; items already in ATLAS are kept as they are.` : "Your Cost Library is empty. This copies your Cost Library, productivity rates and omission rules from Airtable in one go."} Airtable is only read, never changed.
      </p>
      {!serverToken && (
        <ol className="mb-3 list-decimal space-y-1 pl-5 text-sm text-stone-700">
          <li>Open <a className="text-forest-700 underline" href="https://airtable.com/create/tokens" target="_blank" rel="noreferrer">airtable.com/create/tokens</a> and tap <b>Create token</b>.</li>
          <li>Name it ATLAS. Under scopes add <b>data.records:read</b>. Under access add the <b>Whispering Leaf</b> base. Tap Create, then copy the token.</li>
          <li>Paste it below. ATLAS uses it once and doesn&apos;t keep it. You can delete the token in Airtable afterwards.</li>
        </ol>
      )}
      {!serverToken && <label className="block text-sm"><span className="label">Airtable token</span><input className="input font-mono" value={token} onChange={(e) => setToken(e.target.value)} placeholder="pat…" autoComplete="off" autoCapitalize="off" spellCheck={false} /></label>}
      <button className="btn-primary mt-3" disabled={busy || (!serverToken && token.trim().length < 20)} onClick={pull}>{busy ? "Copying from Airtable…" : "Copy price lists from Airtable"}</button>
      {done && <p role="status" className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Done: {done.map((r) => `${r.added} ${label[r.entity] ?? r.entity} added`).join(", ")}{done.some((r) => r.skipped) ? `; ${done.reduce((n, r) => n + r.skipped, 0)} were already here and kept` : ""}.</p>}
      {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
    </section>
  );
}

export function DataAdmin({ source, counts, serverToken = false, libraryCount = 0 }: { source: keyof typeof SOURCE_LABEL; counts: { label: string; n: number }[]; serverToken?: boolean; libraryCount?: number }) {
  const router = useRouter();
  const [file, setFile] = useState<unknown>(null);
  const [fileName, setFileName] = useState("");
  const [mode, setMode] = useState<"add-new" | "replace">("add-new");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [results, setResults] = useState<Result[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canImport = source === "postgres";
  const total = counts.reduce((n, c) => n + c.n, 0);

  async function send(confirm: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ file, mode, preview: !confirm, confirm: confirm || undefined }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Couldn't reach the server");
      setPreview(json.preview);
      if (json.results) { setResults(json.results); router.refresh(); }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onFile(f: File | undefined) {
    setPreview(null); setResults(null); setError(null); setFile(null); setFileName(f?.name ?? "");
    if (!f) return;
    try {
      setFile(JSON.parse(await f.text()));
    } catch {
      setError("That file isn't valid JSON. Use an ATLAS backup or the Airtable export file.");
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
      {canImport && <AirtablePull serverToken={serverToken} libraryCount={libraryCount} />}
      <section className="card p-5">
        <h2 className="mb-1 font-semibold">Where your data lives</h2>
        <p className="text-sm text-stone-700">{SOURCE_LABEL[source]} · {total.toLocaleString("en-AU")} records</p>
        {counts.length > 0 && (
          <ul className="mt-3 divide-y divide-stone-100 text-sm">
            {counts.map((c) => <li key={c.label} className="flex justify-between py-1.5"><span>{c.label}</span><span className="tabular-nums">{c.n.toLocaleString("en-AU")}</span></li>)}
          </ul>
        )}
      </section>

      <section className="card p-5">
        <h2 className="mb-1 font-semibold">Download a backup</h2>
        <p className="mb-3 text-sm text-stone-700">One file with every record ATLAS holds. Keep it somewhere safe, such as Google Drive. It can be imported back here. It includes customer details and internal costs, so don&apos;t share it. Photos and voice notes aren&apos;t in this file yet.</p>
        <a href="/api/admin/export" className="btn-primary inline-flex" download>Download backup (.json)</a>
      </section>

      <section className="card p-5 lg:col-span-2">
        <h2 className="mb-1 font-semibold">Import data</h2>
        {!canImport && <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">Importing works once ATLAS runs on its own database. You can still preview a file here to check it reads correctly.</p>}
        <p className="mb-3 text-sm text-stone-700">Choose an Airtable export file or an ATLAS backup. You&apos;ll see what&apos;s in it before anything is saved. Airtable itself is never changed.</p>
        <label className="block text-sm"><span className="label">File</span><input type="file" accept="application/json,.json" className="input" onChange={(e) => onFile(e.target.files?.[0])} /></label>
        <fieldset className="mt-3 space-y-2 text-sm">
          <legend className="label">If a record is already in ATLAS</legend>
          <label className="flex items-start gap-2"><input type="radio" name="mode" className="mt-1 h-5 w-5" checked={mode === "add-new"} onChange={() => setMode("add-new")} /><span><b>Keep the ATLAS version</b> (recommended). Only records ATLAS doesn&apos;t have yet are added.</span></label>
          <label className="flex items-start gap-2"><input type="radio" name="mode" className="mt-1 h-5 w-5" checked={mode === "replace"} onChange={() => setMode("replace")} /><span><b>Replace it with the file&apos;s version.</b> Changes made in ATLAS to those records are lost. Download a backup first.</span></label>
        </fieldset>
        <button className="btn-secondary mt-3" disabled={!file || busy} onClick={() => send(false)}>{busy && !preview ? "Reading…" : "Check the file"}</button>

        {preview && (
          <div className="mt-4 rounded-xl border border-stone-200 p-4" role="region" aria-label="Import preview">
            <p className="mb-2 text-sm font-medium">{fileName}: {preview.source}</p>
            <table className="w-full text-sm">
              <thead><tr className="text-left text-stone-500"><th className="py-1 font-normal">Table</th><th className="py-1 text-right font-normal">In file</th><th className="py-1 text-right font-normal">Already in ATLAS</th></tr></thead>
              <tbody>{preview.tables.map((t) => <tr key={t.entity} className="border-t border-stone-100"><td className="py-1">{t.label}</td><td className="py-1 text-right tabular-nums">{t.inFile}</td><td className="py-1 text-right tabular-nums">{t.alreadyInAtlas}</td></tr>)}</tbody>
            </table>
            {preview.ignored.length > 0 && <p className="mt-2 text-xs text-stone-500">Not used by ATLAS, left out: {preview.ignored.join(", ")}</p>}
            {!results && canImport && (
              <button className="btn-primary mt-3" disabled={busy} onClick={() => send(true)}>
                {busy ? "Importing…" : mode === "replace" ? "Import and replace matching records" : "Import new records"}
              </button>
            )}
          </div>
        )}
        {results && (
          <p role="status" className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            Done: {results.reduce((n, r) => n + r.added, 0)} added, {results.reduce((n, r) => n + r.replaced, 0)} replaced, {results.reduce((n, r) => n + r.skipped, 0)} already there and kept.
          </p>
        )}
        {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      </section>
    </div>
  );
}
