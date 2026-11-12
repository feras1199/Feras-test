import { useMemo } from 'react';
import { Download } from 'lucide-react';
import { useDerived, useStore } from '../../store/useStore.ts';
import { purchaseSchedule } from '../../core/assemblies.ts';
import { scheduleCsv, toCsv } from '../../core/exports/data.ts';
import { exGst, fmt, money, toPurchase, UNIT_LABEL } from '../../core/units.ts';
import { Banner, download, Empty, PriceBadge, safeName } from '../kit.tsx';
import type { PoLine } from '../../core/types.ts';

export function Procurement() {
  const s = useStore(), d = useDerived()!, p = s.project!;
  const sched = useMemo(() => purchaseSchedule(d.lines, s.materials), [d.lines, s.materials]);
  const sup = new Map(s.suppliers.map(x => [x.id, x]));
  const status = (k: string) => p.procurement.find(l => l.key === k)?.status ?? 'to-order';
  const setStatus = (key: string, st: PoLine['status']) => s.update(x => { const l = x.procurement.find(z => z.key === key); if (l) l.status = st; else x.procurement.push({ key, status: st }); }, { audit: `Procurement ${key}: ${st}` });
  const bySup = new Map<string, typeof sched>();
  for (const r of sched) bySup.set(r.material.supplierId, [...(bySup.get(r.material.supplierId) ?? []), r]);
  if (!sched.length) return <><h1>Procurement</h1><Empty title="No materials to order"><p>The purchase list is generated from the design quantities.</p></Empty></>;
  const order = (sid: string) => download(`${safeName(p.name)}-order-${sid}.csv`, toCsv([[`Order request: ${sup.get(sid)?.name}`], [`Project ${p.name}`, `Site ${p.site.suburb}`], [], ['Product', 'Qty', 'Unit', 'Listed price', 'Note'], ...bySup.get(sid)!.map(r => [r.material.name, r.purchaseQty ?? 'TBC', UNIT_LABEL[r.purchaseUnit], r.material.price ?? 'quote', r.note])]), 'text/csv');
  return <>
    <div className="row between"><h1>Procurement</h1><button className="btn" onClick={() => download(`${safeName(p.name)}-material-schedule.csv`, scheduleCsv(p, d.lines, s.materials, s.suppliers), 'text/csv')}><Download size={15} /> Full schedule CSV</button></div>
    <p className="muted">Purchase quantities after waste, unit conversion and pack rounding, grouped by supplier. Prices and stock must be confirmed with the supplier before ordering.</p>
    <Banner kind="info">No supplier ordering API is connected. Use "Order request CSV" to email a supplier, then mark lines as ordered and delivered here.</Banner>
    {[...bySup.entries()].map(([sid, rows]) => {
      const total = rows.reduce((a, r) => a + (r.material.price != null && r.purchaseQty != null ? exGst(r.material.price, r.material.gstInclusive) * r.purchaseQty : 0), 0);
      const x = sup.get(sid);
      return <div className="card" key={sid}>
        <div className="row between"><div><h2 style={{ margin: 0 }}>{x?.name ?? sid}</h2><small>{x?.region} · delivery {x?.deliveryFee == null ? 'unknown, ask supplier' : money(x.deliveryFee)}</small></div>
          <div className="row"><b>{money(total)} ex GST</b><button className="btn sm" onClick={() => order(sid)}><Download size={14} /> Order request CSV</button></div></div>
        <div className="tablewrap" style={{ marginTop: 10 }}><table><thead><tr><th>Product</th><th className="num">Design qty</th><th className="num">Order</th><th className="num">Line ex GST</th><th>Price</th><th>Status</th></tr></thead><tbody>
          {rows.map(r => <tr key={r.key}><td>{r.material.name}<br /><small>{r.note}</small><Alternatives r={r} /></td>
            <td className="num">{r.designQty == null ? '?' : `${fmt(r.designQty)} ${UNIT_LABEL[r.designUnit]}`}</td>
            <td className="num"><b>{r.purchaseQty == null ? 'INCOMPLETE' : `${fmt(r.purchaseQty)} ${UNIT_LABEL[r.purchaseUnit]}`}</b></td>
            <td className="num">{r.material.price == null || r.purchaseQty == null ? '-' : money(exGst(r.material.price, r.material.gstInclusive) * r.purchaseQty)}</td>
            <td><PriceBadge s={r.material.priceStatus} /></td>
            <td><select aria-label={`Order status for ${r.material.name}`} value={status(r.key)} onChange={e => setStatus(r.key, e.target.value as PoLine['status'])}><option value="to-order">To order</option><option value="ordered">Ordered</option><option value="delivered">Delivered</option></select></td></tr>)}
        </tbody></table></div></div>;
    })}
  </>;
}

function Alternatives({ r }: { r: ReturnType<typeof purchaseSchedule>[number] }) {
  const s = useStore();
  if (r.designQty == null || !r.material.group) return null;
  const alts = s.materials.filter(m => m.group === r.material.group && m.id !== r.material.id && m.price != null && m.supplierId !== r.material.supplierId);
  const rows = alts.map(m => { const pq = toPurchase(m, r.designQty!, r.designUnit); return pq.qty == null ? null : { m, cost: exGst(m.price!, m.gstInclusive) * pq.qty, pq }; }).filter(Boolean) as { m: typeof alts[number]; cost: number; pq: ReturnType<typeof toPurchase> }[];
  if (!rows.length) return null;
  const sup = new Map(s.suppliers.map(x => [x.id, x.name]));
  return <details className="explain"><summary>Compare {rows.length} other supplier option(s)</summary>{rows.map(x => <div key={x.m.id}>{sup.get(x.m.supplierId)}: {x.m.name}, {fmt(x.pq.qty)} {UNIT_LABEL[x.pq.unit]} = {money(x.cost)} ex GST, before delivery</div>)}<small>Different products may differ in specification. Delivery is not included.</small></details>;
}
