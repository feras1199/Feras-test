import { useState } from 'react';
import { Plus, Trash2, Download } from 'lucide-react';
import { useDerived, useStore } from '../../store/useStore.ts';
import { marginFromMarkup, markupFromMargin, objectDirectCost } from '../../core/estimate.ts';
import { estimateCsv } from '../../core/exports/data.ts';
import { generateAlternatives } from '../../core/alternatives.ts';
import { fmt, money, UNIT_LABEL } from '../../core/units.ts';
import { today, uid } from '../../core/project.ts';
import { Banner, download, Empty, Field, Num, PriceBadge, safeName, Text } from '../kit.tsx';
import type { ExtraLine } from '../../core/types.ts';

type View = 'internal' | 'customer' | 'materials' | 'labour' | 'quantities' | 'compare' | 'settings';

export function EstimatePage() {
  const s = useStore(), d = useDerived()!, p = s.project!, e = d.estimate;
  const [view, setView] = useState<View>('internal');
  const has = p.objects.some(o => o.layer === 'proposed');
  if (!has) return <><h1>Cost Estimator</h1><Empty title="Nothing to estimate yet"><p>Add proposed walls, paving, gardens and other items in Site Drawing. The estimate is calculated from the drawing.</p><button className="btn primary" onClick={() => s.go('drawing')}>Go to Site Drawing</button></Empty></>;
  const set = (fn: (x: typeof p.estimate) => void, audit?: string) => s.update(x => fn(x.estimate), { audit });
  const tabs: [View, string][] = [['internal', 'Internal estimate'], ['customer', 'Customer view'], ['materials', 'Materials only'], ['labour', 'Labour only'], ['quantities', 'Quantities and formulas'], ['compare', 'Compare alternatives'], ['settings', 'Rates and margins']];
  return <>
    <div className="row between"><h1>Cost Estimator</h1><button className="btn" onClick={() => download(`${safeName(p.name)}-estimate.csv`, estimateCsv(p, e), 'text/csv')}><Download size={15} /> Estimate CSV</button></div>
    <p className="muted">Calculated from the drawing and the Materials Library. Change a dimension or material and every figure here updates.</p>
    {p.synthetic && <Banner kind="info">Synthetic demo: labour rates, productivity, equipment and disposal lines are assumptions for demonstration, not market rates.</Banner>}
    {e.flags.length > 0 && <Banner kind="warn"><b>Estimate incomplete: {e.flags.length} open items.</b> Unpriced items are excluded from the total, never guessed.
      <details className="explain"><summary>Show open items</summary><ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{e.flags.map((f, i) => <li key={i}>{f}</li>)}</ul></details></Banner>}
    {e.assumed.length > 0 && <Banner kind="warn"><b>{e.assumed.length} items use assumed prices for this project.</b> They are included in the total and labelled "Assumption".
      <details className="explain"><summary>Show assumed prices</summary><ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{e.assumed.map((f, i) => <li key={i}>{f}</li>)}</ul></details></Banner>}
    <div className="grid g4" style={{ marginBottom: 14 }}>
      <div className="card"><small>Total cost (ex GST)</small><div className="stat" data-testid="cost">{money(e.cost, 0)}</div><small>direct + overhead + contingency</small></div>
      <div className="card"><small>Gross profit</small><div className="stat">{money(e.profit, 0)}</div><small>{e.markupPct}% markup = {e.marginPct.toFixed(1)}% margin</small></div>
      <div className="card"><small>Price ex GST</small><div className="stat">{money(e.priceEx, 0)}</div><small>GST {money(e.gst, 0)}</small></div>
      <div className="card"><small>Price inc GST</small><div className="stat" data-testid="price-inc">{money(e.priceInc, 0)}</div><small>{e.labourHours.toFixed(1)} labour hours</small></div>
    </div>
    <div className="tabs" role="tablist">{tabs.map(([k, l]) => <button key={k} role="tab" className={view === k ? 'active' : ''} onClick={() => setView(k)}>{l}</button>)}</div>

    {(view === 'internal' || view === 'materials' || view === 'labour') && <div className="tablewrap"><table><thead><tr><th>Item</th><th className="hide-sm">Supplier / basis</th><th className="num">Qty</th><th className="num">Rate ex GST</th><th className="num">Cost ex GST</th><th>Status</th></tr></thead><tbody>
      {e.lines.filter(l => view === 'internal' || (view === 'materials' ? l.group === 'Materials' || l.group === 'Delivery' : l.group === 'Labour')).map(l => <tr key={l.key}>
        <td><small>{l.group}</small><br />{l.desc}{l.note && <><br /><small>{l.note}</small></>}</td><td className="hide-sm"><small>{l.supplier ?? ''}</small></td>
        <td className="num">{l.qty == null ? '?' : `${fmt(l.qty)} ${UNIT_LABEL[l.unit as keyof typeof UNIT_LABEL] ?? l.unit}`}</td><td className="num">{l.rateEx == null ? '-' : money(l.rateEx)}</td>
        <td className="num">{l.rateEx == null ? <span className="badge danger">not priced</span> : money(l.costEx)}</td><td><PriceBadge s={l.status} />{l.materialId && (l.status === 'assumption' || l.rateEx == null) && <AssumedPrice id={l.materialId} />}</td></tr>)}
      {view === 'internal' && <>
        <tr className="total"><td colSpan={4}>Direct cost</td><td className="num">{money(e.direct)}</td><td></td></tr>
        <tr><td colSpan={4}>Overhead {p.estimate.overheadPct}% of direct cost</td><td className="num">{money(e.overhead)}</td><td></td></tr>
        <tr><td colSpan={4}>Contingency {p.estimate.contingencyPct}% of (direct + overhead)</td><td className="num">{money(e.contingency)}</td><td></td></tr>
        <tr className="total"><td colSpan={4}>Total cost</td><td className="num">{money(e.cost)}</td><td></td></tr>
        <tr><td colSpan={4}>Markup {p.estimate.markupPct}% on cost (gross margin {e.marginPct.toFixed(2)}% of price)</td><td className="num">{money(e.profit)}</td><td></td></tr>
        <tr className="total"><td colSpan={4}>Price ex GST</td><td className="num">{money(e.priceEx)}</td><td></td></tr>
        <tr><td colSpan={4}>GST {p.estimate.gstPct}%</td><td className="num">{money(e.gst)}</td><td></td></tr>
        <tr className="total"><td colSpan={4}>Price inc GST</td><td className="num">{money(e.priceInc)}</td><td></td></tr></>}
      {view === 'materials' && <tr className="total"><td colSpan={4}>Materials and delivery, ex GST (at cost)</td><td className="num">{money(e.totals.materials + e.totals.delivery)}</td><td></td></tr>}
      {view === 'labour' && <tr className="total"><td colSpan={4}>Labour at cost, ex GST ({e.labourHours.toFixed(1)} h incl. excavation; supervision on top)</td><td className="num">{money(e.totals.labour)}</td><td></td></tr>}
    </tbody></table></div>}

    {view === 'customer' && <div className="card"><h2>What the customer sees</h2><p className="muted">Each element's share of the selling price. Export the PDF from Documents.</p>
      <div className="tablewrap"><table><tbody>
        {p.objects.filter(o => o.layer === 'proposed').map(o => ({ o, c: objectDirectCost(p, o.id, d.lines, s.materials).cost })).filter(x => x.c > 0).map(({ o, c }) => <tr key={o.id}><td>{o.name}</td><td className="num">{money(c * (e.direct ? e.priceEx / e.direct : 0), 0)}</td></tr>)}
        <tr className="total"><td>Total ex GST</td><td className="num">{money(e.priceEx, 0)}</td></tr><tr><td>GST</td><td className="num">{money(e.gst, 0)}</td></tr><tr className="total"><td>Total inc GST</td><td className="num">{money(e.priceInc, 0)}</td></tr>
      </tbody></table></div></div>}

    {view === 'quantities' && <QuantityTable />}
    {view === 'compare' && <Compare />}
    {view === 'settings' && <div className="grid g2">
      <div className="card"><h2>Labour rates (ex GST, per hour)</h2>
        <Banner kind="warn">These are your assumptions. The app holds no verified market labour rates.</Banner>
        <div className="grid g3">
          <Field label="Skilled"><Num value={p.estimate.rates.skilled} min={0} unit="$/h" onChange={v => set(x => { x.rates.skilled = v!; }, `Skilled rate ${v}`)} /></Field>
          <Field label="General"><Num value={p.estimate.rates.general} min={0} unit="$/h" onChange={v => set(x => { x.rates.general = v!; }, `General rate ${v}`)} /></Field>
          <Field label="Supervisor"><Num value={p.estimate.rates.supervisor} min={0} unit="$/h" onChange={v => set(x => { x.rates.supervisor = v!; }, `Supervisor rate ${v}`)} /></Field>
          <Field label="Skilled share of hours"><Num value={p.estimate.skilledShare * 100} min={0} max={100} unit="%" onChange={v => set(x => { x.skilledShare = v! / 100; })} /></Field>
          <Field label="Supervision"><Num value={p.estimate.supervisionPct} min={0} max={100} unit="% of hours" onChange={v => set(x => { x.supervisionPct = v!; })} /></Field>
          <Field label="Access factor" hint="Set from site access"><Num value={p.estimate.accessFactor} min={0.5} max={3} unit="×" onChange={v => set(x => { x.accessFactor = v!; })} /></Field>
        </div>
        <h3 style={{ marginTop: 14 }}>Productivity (hours per unit)</h3>
        <div className="grid g3">{Object.entries(p.estimate.productivity).map(([k, v]) => <Field key={k} label={k.replace('wall.', 'wall: ')}><Num value={v} min={0} max={50} unit={k === 'excavation' ? 'h/m³' : ['drain', 'edging'].includes(k) ? 'h/m' : ['light', 'pit', 'tree', 'planting'].includes(k) ? 'h each' : 'h/m²'} onChange={nv => set(x => { x.productivity[k] = nv!; }, `Productivity ${k} = ${nv}`)} /></Field>)}</div>
      </div>
      <div className="card"><h2>Margins</h2>
        <div className="grid g2">
          <Field label="Overhead" hint="% of direct cost"><Num value={p.estimate.overheadPct} min={0} max={100} unit="%" onChange={v => set(x => { x.overheadPct = v!; })} /></Field>
          <Field label="Contingency" hint="% of direct + overhead"><Num value={p.estimate.contingencyPct} min={0} max={100} unit="%" onChange={v => set(x => { x.contingencyPct = v!; })} /></Field>
          <Field label="Markup on cost"><Num value={p.estimate.markupPct} min={0} max={500} unit="%" onChange={v => set(x => { x.markupPct = v!; }, `Markup ${v}%`)} /></Field>
          <Field label="…or target margin on price" hint="Converts to markup"><Num value={Math.round(marginFromMarkup(p.estimate.markupPct) * 100) / 100} min={0} max={95} unit="%" onChange={v => set(x => { x.markupPct = Math.round(markupFromMargin(v!) * 1000) / 1000; }, `Target margin ${v}%`)} /></Field>
          <Field label="GST"><Num value={p.estimate.gstPct} min={0} max={50} unit="%" onChange={v => set(x => { x.gstPct = v!; })} /></Field>
          <Field label="Spoil bulking factor"><Num value={p.estimate.bulkingFactor} min={1} max={2} unit="×" onChange={v => set(x => { x.bulkingFactor = v!; })} /></Field>
        </div>
        <Banner kind="info">Markup is profit as a share of cost; margin is profit as a share of price. 25% markup is 20% margin.</Banner>
        <h3 style={{ marginTop: 10 }}>Equipment, subcontractors, disposal, delivery</h3>
        <Extras />
      </div>
    </div>}
  </>;
}

function AssumedPrice({ id }: { id: string }) {
  const s = useStore(), p = s.project!, cur = p.priceAssumptions?.[id];
  return <div style={{ minWidth: 130, marginTop: 4 }}><Num ariaLabel="Assumed price inc GST" value={cur?.price ?? null} allowNull min={0} placeholder="assume $" unit="inc GST"
    onChange={v => s.update(x => { x.priceAssumptions ??= {}; if (v == null) delete x.priceAssumptions[id]; else x.priceAssumptions[id] = { price: v, note: `Allowance entered by ${s.settings.userName} ${today()}` }; }, { audit: `Assumed price for ${id}: ${v ?? 'removed'}` })} /></div>;
}

function Extras() {
  const s = useStore(), p = s.project!;
  const upd = (fn: (l: ExtraLine[]) => void) => s.update(x => fn(x.estimate.extras));
  return <>
    {p.estimate.extras.map((l, i) => <div key={l.id} className="grid" style={{ gridTemplateColumns: '1.2fr 2.5fr .9fr .8fr 1fr auto', gap: 6, marginBottom: 6, alignItems: 'start' }}>
      <select aria-label="Category" value={l.category} onChange={e => upd(x => { x[i].category = e.target.value as ExtraLine['category']; })}><option value="equipment">Equipment</option><option value="subcontract">Subcontractor</option><option value="disposal">Disposal</option><option value="delivery">Delivery</option><option value="other">Other</option></select>
      <Text ariaLabel="Description" value={l.desc} onChange={v => upd(x => { x[i].desc = v; })} />
      <Num ariaLabel="Quantity" value={l.qty} min={0} onChange={v => upd(x => { x[i].qty = v!; })} />
      <Text ariaLabel="Unit" value={l.unit} onChange={v => upd(x => { x[i].unit = v; })} />
      <Num ariaLabel="Rate ex GST" value={l.rate} min={0} unit="$" onChange={v => upd(x => { x[i].rate = v!; })} />
      <button className="btn sm ghost icon" aria-label="Remove line" onClick={() => upd(x => { x.splice(i, 1); })}><Trash2 size={14} /></button>
    </div>)}
    <button className="btn sm" onClick={() => upd(x => { x.push({ id: uid('x'), category: 'equipment', desc: 'New line', qty: 1, unit: 'day', rate: 0, assumption: true }); })}><Plus size={14} /> Add line</button>
  </>;
}

function QuantityTable() {
  const s = useStore(), d = useDerived()!;
  const [edit, setEdit] = useState<string | null>(null), [qty, setQty] = useState<number | null>(null), [why, setWhy] = useState('');
  return <div className="tablewrap"><table><thead><tr><th>Element / item</th><th>Formula and inputs</th><th className="num">Net</th><th className="num">Waste</th><th className="num">Quantity</th><th className="num">Buy</th><th></th></tr></thead><tbody>
    {d.lines.map(l => <tr key={l.key} data-line={l.key}>
      <td><b>{l.objectName}</b><br />{l.component}{l.warning && <><br /><span className="badge danger">{l.warning}</span></>}</td>
      <td style={{ fontSize: '.8rem' }}>{l.formula}<br /><span className="muted">{Object.entries(l.inputs).map(([k, v]) => `${k}: ${v}`).join(' · ')}</span>
        {l.assumptions.length > 0 && <details className="explain"><summary>Assumptions ({l.assumptions.length})</summary><ul style={{ paddingLeft: 18, margin: 0 }}>{l.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul></details>}
        <small> Source: {l.source}</small></td>
      <td className="num">{l.net == null ? '?' : fmt(l.net)}</td><td className="num">{l.wastePct}%</td>
      <td className="num"><b>{l.gross == null ? 'unknown' : `${fmt(l.gross)} ${UNIT_LABEL[l.unit]}`}</b>{l.overridden && <><br /><span className="badge warn" title={`${l.overridden.reason} (${l.overridden.by}, ${l.overridden.date})`}>manual</span></>}</td>
      <td className="num">{l.purchaseQty != null ? `${fmt(l.purchaseQty)} ${UNIT_LABEL[l.purchaseUnit!]}` : ''}{l.purchaseNote && <><br /><small>{l.purchaseNote}</small></>}</td>
      <td className="num">{edit === l.key ? <div style={{ minWidth: 180 }} className="grid">
        <Num ariaLabel="Override quantity" value={qty} allowNull min={0} onChange={setQty} unit={UNIT_LABEL[l.unit]} /><input aria-label="Reason" placeholder="Reason (required)" value={why} onChange={e => setWhy(e.target.value)} />
        <div className="row"><button className="btn sm primary" disabled={qty == null || !why.trim()} onClick={() => { s.update(x => { x.overrides = x.overrides.filter(o => o.key !== l.key); x.overrides.push({ key: l.key, qty: qty!, reason: why.trim(), by: s.settings.userName, date: today() }); }, { audit: `Quantity override ${l.key} = ${qty} (${why})` }); setEdit(null); }}>Save</button><button className="btn sm" onClick={() => setEdit(null)}>Cancel</button></div></div>
        : l.overridden ? <button className="btn sm" onClick={() => s.update(x => { x.overrides = x.overrides.filter(o => o.key !== l.key); }, { audit: `Override removed ${l.key}` })}>Remove override</button>
          : <button className="btn sm" onClick={() => { setEdit(l.key); setQty(l.gross); setWhy(''); }}>Override</button>}</td>
    </tr>)}
  </tbody></table></div>;
}

function Compare() {
  const s = useStore(), p = s.project!, d = useDerived()!;
  const alts = generateAlternatives(p, s.materials, s.suppliers, s.settings);
  const rows = [{ name: 'Current design', e: d.estimate }, ...alts.map(a => ({ name: a.name, e: a.estimate }))];
  return <div className="tablewrap"><table><thead><tr><th></th>{rows.map(r => <th key={r.name} className="num">{r.name}</th>)}</tr></thead><tbody>
    {([['Materials', (e: typeof d.estimate) => e.totals.materials], ['Labour', (e: typeof d.estimate) => e.totals.labour], ['Labour hours', (e: typeof d.estimate) => e.labourHours], ['Total cost', (e: typeof d.estimate) => e.cost], ['Profit', (e: typeof d.estimate) => e.profit], ['Price inc GST', (e: typeof d.estimate) => e.priceInc], ['Open items', (e: typeof d.estimate) => e.flags.length]] as const).map(([k, f]) =>
      <tr key={k} className={k === 'Price inc GST' ? 'total' : ''}><td>{k}</td>{rows.map(r => <td key={r.name} className="num">{k === 'Labour hours' || k === 'Open items' ? fmt(f(r.e), 1) : money(f(r.e), 0)}</td>)}</tr>)}
  </tbody></table></div>;
}
