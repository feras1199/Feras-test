"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Preview = { source: string; ignored: string[]; tables: { entity: string; label: string; inFile: number; alreadyInAtlas: number }[] };
type Result = { entity: string; added: number; replaced: number; skipped: number };

const SOURCE_LABEL = { postgres: "ATLAS database", airtable: "Airtable (old base, read and write)", memory: "Demo data (fictional, resets on restart)" } as const;

export function DataAdmin({ source, counts }: { source: keyof typeof SOURCE_LABEL; counts: { label: string; n: number }[] }) {
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
        <p className="mb-3 text-sm text-stone-700">One file with every record ATLAS holds. Keep it somewhere safe, such as Google Drive. It can be imported back here. It includes customer details and internal costs, so don&apos;t share it.</p>
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
