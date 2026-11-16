import { useMemo, useRef, useState } from 'react';
import { Plus, Upload, Download, ExternalLink, RotateCcw } from 'lucide-react';
import { useStore } from '../../store/useStore.ts';
import { CATEGORIES, SEED_MATERIALS, SEED_SUPPLIERS } from '../../core/catalogue.ts';
import { toCsv } from '../../core/exports/data.ts';
import { money, UNIT_LABEL } from '../../core/units.ts';
import { today } from '../../core/project.ts';
import { Banner, download, Field, Num, PriceBadge, Select, Text } from '../kit.tsx';
import type { Material, PriceStatus, Unit } from '../../core/types.ts';

const UNITS: Unit[] = ['each', 'm2', 'm3', 't', 'lm', 'roll', 'bag', 'item'];
const STALE_DAYS = 90;
export const isStale = (m: Material) => m.priceStatus === 'verified' && !!m.verifiedDate && (Date.now() - new Date(m.verifiedDate).getTime()) / 864e5 > STALE_DAYS;
const COLS = ['id', 'name', 'category', 'supplierId', 'manufacturer', 'unit', 'price', 'gstInclusive', 'priceStatus', 'verifiedDate', 'sourceUrl', 'length_mm', 'width_mm', 'thickness_mm', 'lengthM', 'widthM', 'density', 'packSize', 'minOrder', 'increment', 'group', 'note'];

export function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(cur); cur = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some(x => x.trim())) rows.push(row); row = []; } else cur += c;
  }
  row.push(cur); if (row.some(x => x.trim())) rows.push(row);
  return rows;
}

export function Materials() {
  const s = useStore();
  const [cat, setCat] = useState('all'), [q, setQ] = useState(''), [open, setOpen] = useState<string | null>(null), [tab, setTab] = useState<'materials' | 'suppliers'>('materials');
  const [report, setReport] = useState<string[] | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const sup = useMemo(() => new Map(s.suppliers.map(x => [x.id, x])), [s.suppliers]);
  const list = s.materials.filter(m => (cat === 'all' || m.category === cat) && (!q || `${m.name} ${m.manufacturer ?? ''} ${sup.get(m.supplierId)?.name ?? ''}`.toLowerCase().includes(q.toLowerCase())));
  const save = (id: string, fn: (m: Material) => void) => void s.setCatalogue(s.materials.map(m => { if (m.id !== id) return m; const c = structuredClone(m); fn(c); return c; }), s.suppliers);
  const setPrice = (m: Material, v: number | null) => save(m.id, c => { (c.history ??= []).push({ date: today(), price: m.price, note: `was ${m.priceStatus}` }); c.price = v; c.priceStatus = v == null ? 'quote-required' : 'verified'; c.verifiedDate = today(); c.note = [c.note, `Price entered manually by ${s.settings.userName} on ${today()}.`].filter(Boolean).join(' '); });
  const exportCsv = () => download('materials-catalogue.csv', toCsv([COLS, ...s.materials.map(m => [m.id, m.name, m.category, m.supplierId, m.manufacturer ?? '', m.unit, m.price ?? '', m.gstInclusive, m.priceStatus, m.verifiedDate ?? '', m.sourceUrl ?? '', m.dims?.l ?? '', m.dims?.w ?? '', m.dims?.t ?? '', m.lengthM ?? '', m.widthM ?? '', m.density ?? '', m.packSize ?? '', m.minOrder ?? '', m.increment ?? '', m.group ?? '', m.note ?? ''])]), 'text/csv');
  const importCsv = async (f: File) => {
    const msgs: string[] = [];
    try {
      const rows = parseCsv(await f.text());
      if (rows.length < 2) throw new Error('The file has no data rows.');
      const head = rows[0].map(h => h.trim());
      for (const need of ['id', 'name', 'unit']) if (!head.includes(need)) throw new Error(`Missing required column "${need}". Export the catalogue first to get the right column layout.`);
      const next = structuredClone(s.materials); let added = 0, updated = 0;
      rows.slice(1).forEach((r, i) => {
        const g = (k: string) => (r[head.indexOf(k)] ?? '').trim(), n = (k: string) => { const v = g(k); return v === '' ? undefined : Number(v); };
        const id = g('id'), unit = g('unit') as Unit;
        if (!id || !g('name')) return msgs.push(`Row ${i + 2}: skipped (no id or name).`);
        if (!UNITS.includes(unit)) return msgs.push(`Row ${i + 2} (${id}): skipped, unit "${unit}" is not one of ${UNITS.join(', ')}.`);
        const price = n('price');
        if (price !== undefined && (!isFinite(price) || price < 0)) return msgs.push(`Row ${i + 2} (${id}): skipped, price "${g('price')}" is not a valid number.`);
        const ex = next.find(m => m.id === id);
        const m: Material = { ...(ex ?? { id, priceStatus: 'placeholder' as PriceStatus, gstInclusive: true, supplierId: 'generic', category: 'Consumables' }), name: g('name'), unit, category: g('category') || ex?.category || 'Consumables', supplierId: sup.has(g('supplierId')) ? g('supplierId') : ex?.supplierId ?? 'generic', manufacturer: g('manufacturer') || ex?.manufacturer,
          price: price ?? null, gstInclusive: head.includes('gstInclusive') ? g('gstInclusive').toLowerCase() !== 'false' : ex?.gstInclusive ?? true, priceStatus: (['verified', 'placeholder', 'quote-required', 'outdated'].includes(g('priceStatus')) ? g('priceStatus') : price == null ? 'quote-required' : 'verified') as PriceStatus, verifiedDate: g('verifiedDate') || today(), sourceUrl: g('sourceUrl') || ex?.sourceUrl,
          dims: n('length_mm') || n('width_mm') || n('thickness_mm') ? { l: n('length_mm'), w: n('width_mm'), t: n('thickness_mm') } : ex?.dims, lengthM: n('lengthM') ?? ex?.lengthM, widthM: n('widthM') ?? ex?.widthM, density: n('density') ?? ex?.density, packSize: n('packSize') ?? ex?.packSize, minOrder: n('minOrder') ?? ex?.minOrder, increment: n('increment') ?? ex?.increment, group: g('group') || ex?.group, note: g('note') || ex?.note };
        if (ex) { if (ex.price !== m.price) (m.history ??= [...(ex.history ?? [])]).push({ date: today(), price: ex.price, note: `CSV import ${f.name}` }); Object.assign(ex, m); updated++; } else { next.push(m); added++; }
      });
      await s.setCatalogue(next, s.suppliers);
      msgs.unshift(`Imported ${f.name}: ${added} added, ${updated} updated.`);
    } catch (e: any) { msgs.unshift(`Import failed: ${e.message}`); }
    setReport(msgs);
  };
  const addNew = () => { const id = `custom-${Date.now().toString(36)}`; void s.setCatalogue([{ id, name: 'New material', category: cat === 'all' ? 'Consumables' : cat, supplierId: 'generic', unit: 'each', price: null, gstInclusive: true, priceStatus: 'quote-required' }, ...s.materials], s.suppliers); setOpen(id); };
  const stale = s.materials.filter(isStale).length, unpriced = s.materials.filter(m => m.price == null).length;

  return <>
    <h1>Materials Library</h1>
    <p className="muted">One catalogue for every project. "Verified" means the price was read from the supplier's published list on the date shown, or entered by you. Stock availability is never assumed.</p>
    <div className="tabs"><button className={tab === 'materials' ? 'active' : ''} onClick={() => setTab('materials')}>Materials ({s.materials.length})</button><button className={tab === 'suppliers' ? 'active' : ''} onClick={() => setTab('suppliers')}>Suppliers ({s.suppliers.length})</button></div>
    {tab === 'materials' && <>
      {(stale > 0 || unpriced > 0) && <Banner kind="warn">{unpriced} materials have no price (quote required){stale ? `; ${stale} verified prices are more than ${STALE_DAYS} days old` : ''}. Unpriced items are excluded from estimates and flagged there.</Banner>}
      <div className="row" style={{ marginBottom: 10 }}>
        <input className="grow" style={{ minWidth: 160 }} aria-label="Search materials" placeholder="Search name, maker or supplier" value={q} onChange={e => setQ(e.target.value)} />
        <select aria-label="Category" style={{ width: 'auto' }} value={cat} onChange={e => setCat(e.target.value)}><option value="all">All categories</option>{CATEGORIES.map(c => <option key={c}>{c}</option>)}</select>
        <button className="btn" onClick={addNew}><Plus size={15} /> Add</button>
        <button className="btn" onClick={() => file.current?.click()}><Upload size={15} /> Import CSV</button>
        <button className="btn" onClick={exportCsv}><Download size={15} /> Export CSV</button>
        <input ref={file} type="file" accept=".csv,text/csv" hidden onChange={e => { const f = e.target.files?.[0]; if (f) void importCsv(f); e.target.value = ''; }} />
      </div>
      {report && <Banner kind={report[0].startsWith('Import failed') ? 'danger' : 'info'}><div className="row between"><b>{report[0]}</b><button className="btn sm ghost" onClick={() => setReport(null)}>Dismiss</button></div>{report.length > 1 && <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{report.slice(1, 12).map((r, i) => <li key={i}>{r}</li>)}</ul>}</Banner>}
      <div className="tablewrap"><table><thead><tr><th>Material</th><th className="hide-sm">Supplier</th><th>Unit</th><th className="num">Price</th><th>Status</th><th></th></tr></thead><tbody>
        {list.map(m => <FragmentRow key={m.id} m={m} open={open === m.id} toggle={() => setOpen(open === m.id ? null : m.id)} supName={sup.get(m.supplierId)?.name ?? m.supplierId} save={save} setPrice={setPrice} />)}
        {list.length === 0 && <tr><td colSpan={6} className="muted">No materials match.</td></tr>}
      </tbody></table></div>
      <div className="row" style={{ marginTop: 12 }}><button className="btn sm" onClick={() => { if (confirm('Replace the whole catalogue with the built-in seed list? Your manual prices will be lost.')) void s.setCatalogue(structuredClone(SEED_MATERIALS), structuredClone(SEED_SUPPLIERS)); }}><RotateCcw size={14} /> Reset to built-in catalogue</button></div>
    </>}
    {tab === 'suppliers' && <div className="tablewrap"><table><thead><tr><th>Supplier</th><th>Region</th><th className="num">Delivery per order (inc GST)</th><th>Notes</th></tr></thead><tbody>
      {s.suppliers.map(x => <tr key={x.id}><td><b>{x.name}</b>{x.url && <><br /><a href={x.url} target="_blank" rel="noreferrer">{x.url.replace('https://', '')} <ExternalLink size={11} /></a></>}</td><td>{x.region}</td>
        <td className="num" style={{ minWidth: 150 }}><Num ariaLabel={`Delivery fee for ${x.name}`} value={x.deliveryFee} allowNull min={0} placeholder="unknown" onChange={v => void s.setCatalogue(s.materials, s.suppliers.map(k => (k.id === x.id ? { ...k, deliveryFee: v, deliveryStatus: v == null ? 'quote-required' : 'placeholder' } : k)))} unit="$" /><small>{x.deliveryFee == null ? 'Not known: flagged in estimates' : 'Entered by you'}</small></td>
        <td style={{ fontSize: '.82rem' }}>{x.note}</td></tr>)}
    </tbody></table></div>}
  </>;
}

function FragmentRow({ m, open, toggle, supName, save, setPrice }: { m: Material; open: boolean; toggle: () => void; supName: string; save: (id: string, fn: (m: Material) => void) => void; setPrice: (m: Material, v: number | null) => void }) {
  const s = useStore();
  return <>
    <tr data-material={m.id}>
      <td><b>{m.name}</b><br /><small>{m.category}{m.dims ? ` · ${[m.dims.l, m.dims.w, m.dims.t].filter(Boolean).join(' × ')} mm` : ''}{m.density ? ` · ${m.density} t/m³` : ''}</small></td>
      <td className="hide-sm">{supName}</td><td>{UNIT_LABEL[m.unit]}</td>
      <td className="num" style={{ minWidth: 118 }}><Num ariaLabel={`Price for ${m.name}`} value={m.price} allowNull min={0} placeholder="no price" onChange={v => setPrice(m, v)} /><small>{m.gstInclusive ? 'inc GST' : 'ex GST'}</small></td>
      <td><PriceBadge s={isStale(m) ? 'outdated' : m.priceStatus} /><br /><small>{m.verifiedDate ?? ''}</small></td>
      <td className="num"><button className="btn sm" onClick={toggle} aria-expanded={open}>{open ? 'Close' : 'Details'}</button></td>
    </tr>
    {open && <tr><td colSpan={6} style={{ background: 'var(--surface-2)' }}>
      <div className="grid g3">
        <Field label="Name"><Text value={m.name} onChange={v => save(m.id, c => { c.name = v || c.name; })} /></Field>
        <Field label="Category"><select value={m.category} onChange={e => save(m.id, c => { c.category = e.target.value; })}>{[...new Set([...CATEGORIES, m.category])].map(c => <option key={c}>{c}</option>)}</select></Field>
        <Field label="Supplier"><select value={m.supplierId} onChange={e => save(m.id, c => { c.supplierId = e.target.value; })}>{s.suppliers.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
        <Field label="Unit of sale"><Select value={m.unit} onChange={v => save(m.id, c => { c.unit = v; })} options={UNITS.map(u => [u, UNIT_LABEL[u]] as const)} /></Field>
        <Field label="Price status"><Select value={m.priceStatus} onChange={v => save(m.id, c => { c.priceStatus = v; })} options={[['verified', 'Verified'], ['placeholder', 'Placeholder'], ['quote-required', 'Quote required'], ['outdated', 'Outdated']]} /></Field>
        <Field label="GST"><Select value={m.gstInclusive ? 'inc' : 'ex'} onChange={v => save(m.id, c => { c.gstInclusive = v === 'inc'; })} options={[['inc', 'Price includes GST'], ['ex', 'Price excludes GST']]} /></Field>
        <Field label="Length"><Num value={m.dims?.l} allowNull min={1} onChange={v => save(m.id, c => { c.dims = { ...c.dims, l: v ?? undefined }; })} unit="mm" /></Field>
        <Field label="Width / face height"><Num value={m.dims?.w} allowNull min={1} onChange={v => save(m.id, c => { c.dims = { ...c.dims, w: v ?? undefined }; })} unit="mm" /></Field>
        <Field label="Thickness"><Num value={m.dims?.t} allowNull min={1} onChange={v => save(m.id, c => { c.dims = { ...c.dims, t: v ?? undefined }; })} unit="mm" /></Field>
        <Field label="Bulk density" hint={m.densitySource ?? 'Needed to convert m³ to tonnes'}><Num value={m.density} allowNull min={0.1} max={5} onChange={v => save(m.id, c => { c.density = v ?? undefined; c.densitySource = v == null ? undefined : `Entered by ${s.settings.userName}`; })} unit="t/m³" /></Field>
        <Field label="Pack size (buy in multiples of)"><Num value={m.packSize} allowNull min={1} onChange={v => save(m.id, c => { c.packSize = v ?? undefined; })} /></Field>
        <Field label="Minimum order"><Num value={m.minOrder} allowNull min={0} onChange={v => save(m.id, c => { c.minOrder = v ?? undefined; })} unit={UNIT_LABEL[m.unit]} /></Field>
        <Field label="Roll / length per unit"><Num value={m.lengthM} allowNull min={0.1} onChange={v => save(m.id, c => { c.lengthM = v ?? undefined; })} unit="m" /></Field>
        <Field label="Coverage per unit"><Num value={m.coverageM2} allowNull min={0.01} onChange={v => save(m.id, c => { c.coverageM2 = v ?? undefined; })} unit="m²" /></Field>
        <Field label="Substitution group" hint="Products sharing a group can replace each other"><Text value={m.group ?? ''} onChange={v => save(m.id, c => { c.group = v || undefined; })} /></Field>
      </div>
      <div style={{ marginTop: 10 }}><Field label="Notes, installation requirements, availability"><Text area value={m.note ?? ''} onChange={v => save(m.id, c => { c.note = v; })} /></Field></div>
      <div className="row" style={{ marginTop: 8, fontSize: '.84rem' }}>
        {m.sourceUrl ? <a href={m.sourceUrl} target="_blank" rel="noreferrer">Price source <ExternalLink size={12} /></a> : <span className="muted">No source URL recorded</span>}
        <span className="muted">Availability: {m.availability ?? 'not confirmed'}</span>
        {m.slip && <span className="muted">Slip rating: {m.slip}</span>}
      </div>
      {m.history?.length ? <details className="explain" style={{ marginTop: 6 }}><summary>Price history ({m.history.length})</summary>{m.history.map((h, i) => <div key={i}>{h.date}: {h.price == null ? 'no price' : money(h.price)} {h.note ?? ''}</div>)}</details> : null}
      <div className="row" style={{ marginTop: 8 }}><button className="btn sm danger" onClick={() => { if (confirm(`Delete "${m.name}" from the catalogue?`)) void s.setCatalogue(s.materials.filter(x => x.id !== m.id), s.suppliers); }}>Delete material</button></div>
    </td></tr>}
  </>;
}
