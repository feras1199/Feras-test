import { useMemo, useState } from 'react';
import { Send, Sparkles, History, Check, X, Wand2 } from 'lucide-react';
import { useDerived, useStore } from '../../store/useStore.ts';
import { aiContext, applyOps, describeOp, impactOf, parseCommand, validateOps, type Op } from '../../core/ops.ts';
import { generateAlternatives } from '../../core/alternatives.ts';
import { money } from '../../core/units.ts';
import { uid } from '../../core/project.ts';
import { Banner, Empty } from '../kit.tsx';
import { ApiError } from '../../store/storage.ts';

const EXAMPLES = ['Make this design $2,000 cheaper', 'Replace the wall with sandstone', 'Make the wall 12 m long', 'Make the paving 6 x 4', 'Show cheaper materials', 'What measurements are missing?', 'Why does the wall need engineering?'];
type Goal = 'cost' | 'speed' | 'maintenance' | 'premium';

export function Design() {
  const s = useStore(), d = useDerived()!, p = s.project!;
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ answer: string; ops: Op[]; rejected: string[]; source: string } | null>(null);
  const [goal, setGoal] = useState<Goal>('cost');
  const aiOn = !!s.storage?.health.ai.configured;
  const [useAi, setUseAi] = useState(false);
  const hasDesign = p.objects.some(o => o.layer === 'proposed');
  const alts = useMemo(() => (hasDesign ? generateAlternatives(p, s.materials, s.suppliers, s.settings) : []), [p.objects, p.estimate, s.materials, s.suppliers]); // eslint-disable-line
  const impact = res?.ops.length ? impactOf(p, res.ops, s.materials, s.suppliers) : null;

  const saveVersion = (name: string) => s.update(x => { x.versions.push({ id: uid('ver'), name, date: new Date().toISOString(), objects: structuredClone(x.objects) }); }, { audit: `Design version saved: ${name}` });
  const run = async (q: string) => {
    if (!q.trim()) return;
    setBusy(true); setRes(null);
    try {
      if (useAi && aiOn) {
        const r = await s.storage!.assist(q, aiContext(p, s.materials));
        const v = validateOps(r.ops, p, s.materials);
        setRes({ answer: r.answer, ops: v.ops, rejected: v.rejected, source: `Live AI (${r.model})` });
      } else {
        const r = parseCommand(q, p, s.materials, s.suppliers, s.selectedId ?? undefined);
        setRes({ answer: r.answer, ops: r.ops, rejected: [], source: 'Built-in command interpreter (rule-based, not a language model)' });
      }
    } catch (e: any) { setRes({ answer: e instanceof ApiError && e.code === 'AI_NOT_CONFIGURED' ? 'Live AI is not configured on the server. Untick "Use live AI" to use the built-in commands.' : `The assistant request failed: ${e.message}`, ops: [], rejected: [], source: 'Error' }); }
    setBusy(false);
  };
  const approve = () => {
    if (!res?.ops.length) return;
    const ops = res.ops;
    saveVersion(`Before: ${text.slice(0, 40) || 'assistant change'}`);
    s.update(x => { const n = applyOps(x, ops); x.objects = n.objects; x.estimate = n.estimate; }, { undo: true, audit: `Assistant change approved: ${ops.map(o => describeOp(o, p, s.materials)).join('; ')}` });
    s.notify('ok', 'Change applied. Quantities, estimate and documents are updated.'); setRes(null); setText('');
  };
  const best = alts.length ? [...alts].sort((a, b) => goal === 'cost' ? a.estimate.priceInc - b.estimate.priceInc : goal === 'speed' ? a.estimate.labourHours - b.estimate.labourHours : goal === 'premium' ? b.estimate.priceInc - a.estimate.priceInc : (a.tier === 'economy' ? 0 : a.tier === 'balanced' ? 1 : 2) - (b.tier === 'economy' ? 0 : b.tier === 'balanced' ? 1 : 2))[0] : null;

  return <>
    <h1>Design Studio</h1>
    <p className="muted">Ask for a change in plain words. You always see the cost impact and approve before anything changes. Quantities and prices are calculated by the engine, never by an AI model.</p>
    {!hasDesign && <Empty title="No proposed design yet"><p>Draw proposed walls, paving and gardens in Site Drawing first. Then come back to compare alternatives and make changes by instruction.</p><button className="btn primary" onClick={() => s.go('drawing')}>Go to Site Drawing</button></Empty>}
    {hasDesign && <>
      <div className="card">
        <h2><Wand2 size={17} style={{ verticalAlign: -3 }} /> Design assistant</h2>
        <form className="row" onSubmit={e => { e.preventDefault(); void run(text); }}>
          <input className="grow" style={{ minWidth: 200 }} aria-label="Instruction for the design assistant" placeholder='e.g. "Make this design $2,000 cheaper"' value={text} onChange={e => setText(e.target.value)} />
          <button className="btn primary" type="submit" disabled={busy || !text.trim()}><Send size={15} /> {busy ? 'Working…' : 'Ask'}</button>
        </form>
        <div className="pill-list" style={{ marginTop: 8 }}>{EXAMPLES.map(x => <button key={x} className="btn sm" onClick={() => { setText(x); void run(x); }}>{x}</button>)}</div>
        <label className="row" style={{ marginTop: 8, fontSize: '.84rem' }}><input type="checkbox" checked={useAi && aiOn} disabled={!aiOn} onChange={e => setUseAi(e.target.checked)} /> Use live AI for free-form instructions {aiOn ? <span className="badge ok">{s.storage!.health.ai.model}</span> : <span className="badge warn">not configured: built-in commands only</span>}</label>
        {useAi && aiOn && <small>Sends the design geometry, materials and prices to the AI provider. Customer name, address and photos are not sent.</small>}
        {res && <div style={{ marginTop: 12 }} data-testid="assistant-result">
          <small>{res.source}</small>
          <div style={{ whiteSpace: 'pre-wrap', margin: '4px 0 8px' }}>{res.answer}</div>
          {res.rejected.length > 0 && <Banner kind="warn">{res.rejected.length} suggested change(s) were rejected by validation: {res.rejected.join(' | ')}</Banner>}
          {res.ops.length > 0 && impact && <div className="card" style={{ background: 'var(--surface-2)' }}>
            <h3>Proposed changes</h3>
            <ul style={{ margin: '0 0 8px', paddingLeft: 18 }}>{res.ops.map((o, i) => <li key={i}>{describeOp(o, p, s.materials)}</li>)}</ul>
            <div className="row"><span>Price inc GST: <b>{money(impact.before, 0)}</b> → <b>{money(impact.after, 0)}</b></span>
              <span className={`badge ${impact.delta <= 0 ? 'ok' : 'warn'}`}>{impact.delta <= 0 ? '−' : '+'}{money(Math.abs(impact.delta), 0)}</span>
              {impact.afterFlags !== impact.beforeFlags && <span className="badge warn">open pricing items {impact.beforeFlags} → {impact.afterFlags}</span>}</div>
            <div className="row" style={{ marginTop: 10 }}><button className="btn primary" onClick={approve}><Check size={15} /> Approve and apply</button><button className="btn" onClick={() => setRes(null)}><X size={15} /> Discard</button></div>
            <small style={{ display: 'block', marginTop: 6 }}>The current design is saved as a version first, so this can be reversed.</small>
          </div>}
        </div>}
      </div>

      <div className="card">
        <div className="row between"><h2 style={{ margin: 0 }}>Alternatives on the same layout</h2>
          <label className="row" style={{ fontSize: '.84rem' }}>Optimise for <select aria-label="Optimise for" style={{ width: 'auto' }} value={goal} onChange={e => setGoal(e.target.value as Goal)}><option value="cost">Lowest installed cost</option><option value="speed">Fastest construction</option><option value="maintenance">Lowest maintenance</option><option value="premium">Premium appearance</option></select></label></div>
        <p className="muted" style={{ marginTop: 6 }}>Each option swaps materials only; dimensions, drainage and structural items stay as drawn. Costs are total installed cost (materials, labour, overheads, margin, GST) from the same engine as the estimate.</p>
        <div className="cards">{alts.map(a => <div className="card" key={a.tier} data-testid={`alt-${a.tier}`} style={best?.tier === a.tier ? { borderColor: 'var(--accent)', boxShadow: '0 0 0 2px var(--accent-50)' } : undefined}>
          <div className="row between"><h3 style={{ margin: 0 }}>{a.name}</h3>{best?.tier === a.tier && <span className="badge ok">Best for this goal</span>}</div>
          <div className="stat" style={{ margin: '6px 0 2px' }}>{money(a.estimate.priceInc, 0)}</div>
          <small>inc GST · {a.estimate.labourHours.toFixed(0)} labour hours{a.estimate.flags.length ? ` · ${a.estimate.flags.length} unpriced or incomplete items excluded` : ''}</small>
          <h3 style={{ marginTop: 10 }}>Materials</h3><ul style={{ margin: 0, paddingLeft: 18, fontSize: '.84rem' }}>{a.changes.map((c, i) => <li key={i}>{c}</li>)}</ul>
          <h3 style={{ marginTop: 10 }}>For</h3><ul style={{ margin: 0, paddingLeft: 18, fontSize: '.84rem' }}>{a.pros.map((c, i) => <li key={i}>{c}</li>)}</ul>
          <h3 style={{ marginTop: 10 }}>Against</h3><ul style={{ margin: 0, paddingLeft: 18, fontSize: '.84rem' }}>{a.cons.map((c, i) => <li key={i}>{c}</li>)}</ul>
          <p style={{ fontSize: '.84rem', marginTop: 8 }}><b>Maintenance:</b> {a.maintenance}</p>
          {a.flags.length > 0 && <details className="explain"><summary>{a.flags.length} engineering / regulatory flags</summary><ul style={{ paddingLeft: 18 }}>{a.flags.map((f, i) => <li key={i}>{f}</li>)}</ul></details>}
          <details className="explain"><summary>Assumptions to verify</summary><ul style={{ paddingLeft: 18 }}>{a.assumptions.map((f, i) => <li key={i}>{f}</li>)}</ul></details>
          <button className="btn primary sm" style={{ marginTop: 10 }} onClick={() => { saveVersion(`Before applying ${a.name}`); s.update(x => { x.objects = structuredClone(a.objects); }, { undo: true, audit: `Applied ${a.name} alternative` }); s.notify('ok', `${a.name} alternative applied to the drawing.`); }}>Apply this alternative</button>
        </div>)}</div>
        <Banner kind="info">Photorealistic AI rendering is not built into this version. The plan, 3D massing view and drawings are generated from the real geometry; an illustrative render would need an image-generation service and would always carry an "illustrative only" label.</Banner>
      </div>

      <div className="card">
        <div className="row between"><h2 style={{ margin: 0 }}><History size={17} style={{ verticalAlign: -3 }} /> Design versions</h2><button className="btn sm" onClick={() => saveVersion(`Revision ${p.versions.length + 1}`)}>Save current as a version</button></div>
        {p.versions.length === 0 ? <p className="muted" style={{ marginTop: 8 }}>No saved versions. A version is saved automatically before each assistant change or applied alternative.</p> :
          <div className="tablewrap" style={{ marginTop: 10 }}><table><thead><tr><th>Version</th><th>Saved</th><th className="num">Objects</th><th></th></tr></thead><tbody>
            {[...p.versions].reverse().map(v => <tr key={v.id}><td>{v.name}</td><td>{new Date(v.date).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })}</td><td className="num">{v.objects.length}</td>
              <td className="num"><button className="btn sm" onClick={() => { s.update(x => { x.objects = structuredClone(v.objects); }, { undo: true, audit: `Restored design version: ${v.name}` }); s.notify('ok', `Restored "${v.name}".`); }}>Restore</button></td></tr>)}
          </tbody></table></div>}
      </div>
    </>}
    <span hidden><Sparkles /></span>
  </>;
}
