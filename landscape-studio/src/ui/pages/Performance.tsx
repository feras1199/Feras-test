import { useMemo } from 'react';
import { useDerived, useStore } from '../../store/useStore.ts';
import { money, fmt } from '../../core/units.ts';
import { Banner, Num, Text } from '../kit.tsx';

const CATS = ['Materials', 'Labour', 'Equipment', 'Subcontractors', 'Disposal', 'Delivery', 'Other'] as const;

export function Performance() {
  const s = useStore(), d = useDerived()!, p = s.project!, e = d.estimate;
  const est: Record<string, number> = { Materials: e.totals.materials, Labour: e.totals.labour, Equipment: e.totals.equipment, Subcontractors: e.totals.subcontract, Disposal: e.totals.disposal, Delivery: e.totals.delivery, Other: e.totals.other };
  const row = (c: string) => p.actuals.find(a => a.category === c);
  const setA = (c: string, patch: Partial<{ actual: number; hoursAct: number; note: string }>) => s.update(x => { let r = x.actuals.find(a => a.category === c); if (!r) { r = { category: c, estimated: est[c], actual: 0 }; x.actuals.push(r); } r.estimated = est[c]; Object.assign(r, patch); }, { audit: `Actual recorded: ${c}` });
  const actTotal = p.actuals.reduce((a, r) => a + r.actual, 0), hrsAct = row('Labour')?.hoursAct;
  const realProfit = actTotal ? e.priceEx - actTotal * (1 + p.estimate.overheadPct / 100) : null;
  const history = useMemo(() => s.projects.length, [s.projects]);
  return <>
    <h1>Project Performance</h1>
    <p className="muted">Record what the job actually cost. Compare against the estimate to improve future rates. Suggestions are advisory; you decide the rates.</p>
    <div className="tablewrap"><table><thead><tr><th>Category</th><th className="num">Estimated (cost, ex GST)</th><th className="num">Actual (ex GST)</th><th className="num">Variance</th><th>Cause / note</th></tr></thead><tbody>
      {CATS.map(c => { const r = row(c), v = r ? r.actual - est[c] : null; return <tr key={c}><td>{c}</td><td className="num">{money(est[c])}</td>
        <td className="num" style={{ minWidth: 130 }}><Num ariaLabel={`Actual ${c}`} value={r?.actual ?? null} allowNull min={0} unit="$" onChange={v2 => setA(c, { actual: v2 ?? 0 })} /></td>
        <td className="num" style={{ color: v != null && v > 0 ? 'var(--danger)' : 'var(--ok)' }}>{v == null ? '-' : `${v > 0 ? '+' : ''}${money(v)}`}</td>
        <td><Text ariaLabel={`Note ${c}`} value={r?.note ?? ''} onChange={t => setA(c, { note: t })} /></td></tr>; })}
      <tr className="total"><td>Total direct</td><td className="num">{money(e.direct)}</td><td className="num">{actTotal ? money(actTotal) : '-'}</td><td className="num">{actTotal ? money(actTotal - e.direct) : '-'}</td><td></td></tr>
    </tbody></table></div>
    <div className="grid g3" style={{ marginTop: 14 }}>
      <div className="card"><small>Labour hours: estimated</small><div className="stat">{fmt(e.labourHours, 1)}</div>
        <small>Actual</small><Num ariaLabel="Actual labour hours" value={hrsAct ?? null} allowNull min={0} unit="h" onChange={v => setA('Labour', { hoursAct: v ?? undefined })} /></div>
      <div className="card"><small>Gross profit: estimated</small><div className="stat">{money(e.profit, 0)}</div><small>Actual (price ex GST − actual cost − overhead): {realProfit == null ? 'enter actuals' : money(realProfit, 0)}</small></div>
      <div className="card"><small>Suggested productivity adjustment</small>
        {hrsAct && e.labourHours ? <><div className="stat">{fmt((hrsAct / e.labourHours) * 100, 0)}%</div><small>Actual hours were {fmt(hrsAct / e.labourHours, 2)}× the estimate. If this job was typical, scale productivity rates by this factor in Estimate → Rates.</small>
          <button className="btn sm" style={{ marginTop: 8 }} onClick={() => s.update(x => { const k = hrsAct / e.labourHours; for (const key of Object.keys(x.estimate.productivity)) x.estimate.productivity[key] = Math.round(x.estimate.productivity[key] * k * 1000) / 1000; }, { audit: 'Productivity scaled from actuals (this project only)' })}>Apply to this project's rates</button></> : <small>Enter actual labour hours to get a suggestion.</small>}</div>
    </div>
    <Banner kind="info">Learning across projects currently works one project at a time ({history} projects stored). A company-wide rate library built from many completed jobs is a listed next step.</Banner>
  </>;
}
