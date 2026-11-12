import { useMemo, useState } from 'react';
import { FileDown, FileSpreadsheet, FileCode2, Image, Package, RefreshCw } from 'lucide-react';
import { useDerived, useStore } from '../../store/useStore.ts';
import { buildSheets } from '../../core/exports/sheets.ts';
import { sheetsToPdf, sheetToSvg } from '../../core/exports/render.ts';
import { boqCsv, scheduleCsv, toDxf } from '../../core/exports/data.ts';
import { quotePdf, quoteRows } from '../../core/exports/quote.ts';
import { STATUS_LABEL } from '../../core/project.ts';
import { Banner, download, Empty, safeName } from '../kit.tsx';

export function Documents() {
  const s = useStore(), d = useDerived()!, p = s.project!;
  const [size, setSize] = useState<'A3' | 'A4'>('A3');
  const [idx, setIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const sheets = useMemo(() => buildSheets({ project: p, materials: s.materials, settings: s.settings, lines: d.lines, checks: d.checks, tasks: d.tasks, size }), [p, s.materials, s.settings, d, size]);
  const n = safeName(p.name);
  const sheet = sheets[Math.min(idx, sheets.length - 1)];
  const pdf = () => { setBusy(true); setTimeout(() => { try { download(`${n}-drawings-${size}.pdf`, sheetsToPdf(sheets, p.name).output('arraybuffer'), 'application/pdf'); s.update(() => undefined, { audit: `Drawing pack exported (${size}, ${sheets.length} sheets, status ${STATUS_LABEL[p.status]})` }); } catch (e: any) { s.notify('error', `PDF failed: ${e.message}`); } setBusy(false); }, 20); };
  const png = () => {
    const svg = sheetToSvg(sheet), img = new window.Image(), k = 150 / 25.4;
    img.onload = () => { const c = document.createElement('canvas'); c.width = Math.round(sheet.w * k); c.height = Math.round(sheet.h * k); const g = c.getContext('2d')!; g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height); c.toBlob(b => b && download(`${n}-${sheet.number}.png`, b, 'image/png')); };
    img.onerror = () => s.notify('error', 'PNG export failed in this browser. Use SVG or PDF.');
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  };
  if (!p.objects.length) return <><h1>Documents</h1><Empty title="Nothing to document yet"><p>Draw the site and the design first.</p></Empty></>;
  return <>
    <h1>Documents</h1>
    <p className="muted">Every document is generated from the project data: the same geometry, quantities and status you see elsewhere.</p>
    {p.status !== 'issued' && <Banner kind="warn">Current status: <b>{STATUS_LABEL[p.status]}</b>. Every sheet is stamped "NOT FOR CONSTRUCTION" until the project is approved and issued (Construction Details → Approvals).</Banner>}
    <div className="grid g2">
      <div className="card"><h2>Crew drawing pack</h2>
        <p className="muted" style={{ fontSize: '.85rem' }}>{sheets.length} sheets: existing plan, proposed plan, set-out plan, wall elevations and sections, paving detail, materials schedule, bill of quantities, construction sequence, measurement and review flags.</p>
        <div className="row"><select aria-label="Sheet size" style={{ width: 'auto' }} value={size} onChange={e => setSize(e.target.value as 'A3' | 'A4')}><option value="A3">A3 landscape</option><option value="A4">A4 landscape</option></select>
          <button className="btn primary" disabled={busy} onClick={pdf}><FileDown size={16} /> {busy ? 'Building…' : 'Download PDF pack'}</button></div>
        <small style={{ display: 'block', marginTop: 6 }}>Print at 100% ("actual size") for the stated scales to hold.</small></div>
      <div className="card"><h2>Customer and data exports</h2>
        <div className="row">
          <button className="btn" onClick={() => download(`${n}-preliminary-estimate.pdf`, quotePdf(p, d.estimate, quoteRows(p, d.estimate, d.lines, s.materials), s.settings).output('arraybuffer'), 'application/pdf')}><FileDown size={15} /> Customer estimate PDF</button>
          <button className="btn" onClick={() => download(`${n}-bill-of-quantities.csv`, boqCsv(p, d.lines, s.materials), 'text/csv')}><FileSpreadsheet size={15} /> BoQ CSV</button>
          <button className="btn" onClick={() => download(`${n}-material-schedule.csv`, scheduleCsv(p, d.lines, s.materials, s.suppliers), 'text/csv')}><FileSpreadsheet size={15} /> Schedule CSV</button>
          <button className="btn" onClick={() => download(`${n}-plan.dxf`, toDxf(p), 'application/dxf')}><FileCode2 size={15} /> DXF (CAD)</button>
          <button className="btn" onClick={() => download(`${n}.lis.json`, JSON.stringify(p, null, 1), 'application/json')}><Package size={15} /> Project file (backup)</button>
          {s.storage?.health.airtable.configured && <button className="btn" onClick={async () => { const r = await s.storage!.airtableSync(p).catch((e: any) => ({ ok: false, message: e.message })); s.notify(r.ok ? 'ok' : 'error', r.message); }}><RefreshCw size={15} /> Sync to Airtable</button>}
        </div>
        <small style={{ display: 'block', marginTop: 6 }}>DXF is in metres with one layer per object type. The project file holds everything except photo files.</small></div>
    </div>
    <div className="card">
      <div className="row between"><h2 style={{ margin: 0 }}>Preview</h2>
        <div className="row"><select aria-label="Sheet" style={{ width: 'auto', maxWidth: '60vw' }} value={idx} onChange={e => setIdx(Number(e.target.value))}>{sheets.map((x, i) => <option key={i} value={i}>{x.number} {x.title}</option>)}</select>
          <button className="btn sm" onClick={() => download(`${n}-${sheet.number}.svg`, sheetToSvg(sheet), 'image/svg+xml')}><FileCode2 size={14} /> SVG</button>
          <button className="btn sm" onClick={png}><Image size={14} /> PNG</button></div></div>
      <div className="sheet-prev" style={{ marginTop: 10 }} data-testid="sheet-preview" dangerouslySetInnerHTML={{ __html: sheetToSvg(sheet).replace(/width="[\d.]+mm" height="[\d.]+mm"/, '') }} />
    </div>
  </>;
}
