import { useMemo, useRef, useState } from 'react';
import { Sparkles, ImagePlus, Check, X, Wand2, PencilRuler, HardHat, Box } from 'lucide-react';
import { useDerived, useStore } from '../../store/useStore.ts';
import { applyProposal, generateProposals, ILLUSTRATIVE_LABEL, INCLUSIONS, proposalCost, selectProposal, STYLES } from '../../core/proposals.ts';
import { purchaseSchedule, takeoff } from '../../core/assemblies.ts';
import { CUSTOMER_APPROVAL_MEANS, CUSTOMER_APPROVAL_NOT } from '../../core/approval.ts';
import { fmt, money, UNIT_LABEL } from '../../core/units.ts';
import { uid } from '../../core/project.ts';
import { prepareUpload, useMediaUrl } from '../media.ts';
import { Banner, Empty, Field, Num, Text } from '../kit.tsx';
import { Iso3D } from './Iso3D.tsx';
import { ApiError } from '../../store/storage.ts';
import type { DesignProposal, ProposalBrief, RenderAsset } from '../../core/types.ts';

const INC_LABEL: Record<string, string> = { paving: 'Paving', wall: 'Retaining wall', turf: 'Turf', garden: 'Garden / planting', lighting: 'Lighting', drainage: 'Drainage', deck: 'Deck' };

export function Concepts() {
  const s = useStore(), p = s.project!;
  const photos = p.media.filter(m => m.mime.startsWith('image/') && m.kind !== 'render');
  const [brief, setBrief] = useState<ProposalBrief>(() => ({ style: 'Modern', inclusions: ['paving', 'wall', 'turf', 'garden', 'lighting', 'drainage'], budgetMax: p.brief.budgetMax, constraints: p.site.conditions.slice(0, 200), sourceMediaIds: photos.slice(0, 1).map(m => m.id) }));
  const [err, setErr] = useState<string | null>(null);
  const props = p.proposals ?? [];
  const hasDesign = p.objects.some(o => o.layer === 'proposed');
  const imgOn = !!s.storage?.health.image?.configured;
  const applied = props.find(x => x.id === p.activeProposalId);
  const generate = () => {
    const r = generateProposals(p, brief, s.materials, s.suppliers, s.settings);
    if (r.error) { setErr(r.error); return; }
    setErr(null);
    s.update(x => { x.proposals = [...(x.proposals ?? []).filter(k => k.status === 'applied'), ...r.proposals]; if (x.status === 'draft') x.status = 'concept'; x.brief.budgetMax = brief.budgetMax; }, { audit: `Generated ${r.proposals.length} structured design concepts (${brief.style})` });
  };
  return <>
    <h1>Visual Design Concepts</h1>
    <p className="muted">Three structured options the customer can choose from. Each option is a list of real geometry and material changes costed by the estimate engine. Pictures only illustrate them.</p>
    <Banner kind="warn"><b>{ILLUSTRATIVE_LABEL}</b> Concept pictures never create measurements, boundaries, drainage design or engineering.</Banner>

    <div className="card">
      <h2>Design brief</h2>
      <div className="grid g3">
        <Field label="Style"><select id="concept-style" value={brief.style} onChange={e => setBrief({ ...brief, style: e.target.value })}>{STYLES.map(x => <option key={x}>{x}</option>)}</select></Field>
        <Field label="Budget ceiling (inc GST)"><Num value={brief.budgetMax} allowNull min={0} unit="AUD" onChange={v => setBrief({ ...brief, budgetMax: v })} /></Field>
        <Field label="Constraints"><Text value={brief.constraints} onChange={v => setBrief({ ...brief, constraints: v })} placeholder="Access, trees to keep, drainage problems" /></Field>
      </div>
      {!hasDesign ? <div style={{ marginTop: 10 }}><small>Include:</small><div className="pill-list" style={{ marginTop: 4 }}>{INCLUSIONS.map(k => <label key={k} className="btn sm" style={{ gap: 6 }}><input type="checkbox" checked={brief.inclusions.includes(k)} onChange={e => setBrief({ ...brief, inclusions: e.target.checked ? [...brief.inclusions, k] : brief.inclusions.filter(x => x !== k) })} />{INC_LABEL[k]}</label>)}</div>
        <small style={{ display: 'block', marginTop: 6 }}>No proposed design yet, so each option lays out these items inside the drawn site outline, beyond the house. Positions are proposals to be measured on site.</small></div>
        : <small style={{ display: 'block', marginTop: 8 }}>A proposed design already exists, so options keep its layout and dimensions and change materials only.</small>}
      <div style={{ marginTop: 10 }}><small>Site photos used for pictures ({photos.length} uploaded):</small>
        {photos.length === 0 ? <div><small>None yet. Upload photos in Site Capture to generate or compare pictures. Concepts can still be created without them.</small></div> :
          <div className="pill-list" style={{ marginTop: 4 }}>{photos.map(m => <label key={m.id} className="btn sm" style={{ gap: 6 }}><input type="checkbox" checked={brief.sourceMediaIds.includes(m.id)} onChange={e => setBrief({ ...brief, sourceMediaIds: e.target.checked ? [...brief.sourceMediaIds, m.id] : brief.sourceMediaIds.filter(x => x !== m.id) })} />{m.name}</label>)}</div>}</div>
      <div className="row" style={{ marginTop: 12 }}><button className="btn primary" onClick={generate}><Wand2 size={16} /> {props.length ? 'Regenerate concepts' : 'Generate three concepts'}</button>
        {props.length > 0 && <small>Regenerating replaces draft and selected concepts; applied ones are kept.</small>}</div>
      {err && <div style={{ marginTop: 10 }}><Banner kind="danger">{err}</Banner></div>}
      <div style={{ marginTop: 10 }}>{imgOn ? <Banner kind="ok">AI image generation is configured ({s.storage!.health.image!.provider} {s.storage!.health.image!.model}).</Banner>
        : <Banner kind="info"><b>AI image generation is not configured.</b> Everything else works. You can import a render made elsewhere; it will be labelled "Imported illustrative render".</Banner>}</div>
    </div>

    {props.length === 0 ? <Empty title="No concepts yet"><p>Fill in the brief and press "Generate three concepts".</p></Empty> :
      <div className="cards" style={{ marginTop: 14, gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>{props.map(x => <ConceptCard key={x.id} prop={x} />)}</div>}

    {props.some(x => x.status === 'customer-selected') && <ApplyPanel prop={props.find(x => x.status === 'customer-selected')!} />}

    {applied && <div className="card" data-testid="applied-panel">
      <h2>Applied: {applied.title}</h2>
      <p className="muted">The project geometry now carries this design. Edit any dimension or material in Site Drawing and the quantities, estimate, 3D view, drawings and purchase list follow.</p>
      <div style={{ height: 340, border: '1px solid var(--line)', borderRadius: 9, overflow: 'hidden' }}><Iso3D project={p} materials={s.materials} /></div>
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn" onClick={() => s.go('drawing')}><PencilRuler size={15} /> Open 2D plan</button>
        <button className="btn" onClick={() => s.go('details')}><HardHat size={15} /> Build layers</button>
        <button className="btn" onClick={() => s.go('estimate')}><Box size={15} /> Estimate</button>
        <button className="btn" onClick={() => s.go('procurement')}>Purchase list</button>
      </div>
    </div>}
  </>;
}

function RenderView({ r }: { r: RenderAsset }) {
  const p = useStore(s => s.project!);
  const { url, missing } = useMediaUrl(p.id, r.mediaId);
  return <figure style={{ margin: 0, position: 'relative' }}>
    {url ? <img src={url} alt="Illustrative concept render" style={{ width: '100%', borderRadius: 8, display: 'block' }} /> : <div className="empty" style={{ padding: 20 }}>{missing ? 'Render file missing' : 'Loading…'}</div>}
    <figcaption style={{ position: 'absolute', left: 6, right: 6, bottom: 6, background: 'rgba(23,32,42,.82)', color: '#fff', fontSize: '.7rem', padding: '4px 6px', borderRadius: 6 }}>
      {r.origin === 'imported' ? 'Imported illustrative render' : `AI-generated illustration (${r.provider} ${r.model})`} · {ILLUSTRATIVE_LABEL}</figcaption>
  </figure>;
}

function ConceptCard({ prop }: { prop: DesignProposal }) {
  const s = useStore(), p = s.project!;
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState<{ k: 'danger' | 'info' | 'ok'; t: string } | null>(null);
  const [selecting, setSelecting] = useState(false), [cust, setCust] = useState(p.customer.name), [note, setNote] = useState('');
  const upd = (fn: (x: DesignProposal) => void, audit?: string) => s.update(x => { const k = x.proposals?.find(z => z.id === prop.id); if (k) fn(k); }, audit ? { audit } : undefined);
  const over = p.brief.budgetMax != null && prop.costLow > p.brief.budgetMax;
  const ai = async () => {
    const src = prop.brief.sourceMediaIds[0];
    if (!src) { setMsg({ k: 'info', t: 'Select a site photo in the brief first.' }); return; }
    setBusy(true); setMsg(null);
    try {
      const r = await s.storage!.generateRender({ projectId: p.id, proposalId: prop.id, sourceMediaId: src, title: prop.title, style: prop.brief.style, changes: prop.changes.map(c => c.text), materials: prop.materials });
      upd(x => { x.renders.push({ id: r.id, mediaId: r.mediaId, origin: 'ai-generated', provider: r.provider, model: r.model, prompt: r.prompt, sourceMediaIds: [src], createdAt: r.createdAt, createdBy: r.createdBy, status: 'ok' }); }, `AI render generated for "${prop.title}" (${r.provider} ${r.model})`);
      s.update(x => { x.media.push({ id: r.mediaId, name: `Render: ${prop.title}.png`, kind: 'render', mime: 'image/png', size: 0, addedAt: r.createdAt, note: `AI illustrative render (${r.model}). ${ILLUSTRATIVE_LABEL}` }); });
      setMsg({ k: 'ok', t: 'Render generated.' });
    } catch (e: any) { setMsg({ k: e instanceof ApiError && e.code === 'IMAGE_NOT_CONFIGURED' ? 'info' : 'danger', t: e instanceof ApiError && e.code === 'IMAGE_NOT_CONFIGURED' ? 'AI image generation is not configured. No image was generated. Import a render instead.' : `Render failed: ${e.message}` }); }
    setBusy(false);
  };
  const importRender = async (f: File) => {
    setBusy(true); setMsg(null);
    try {
      const prep = await prepareUpload(f);
      if (!prep.isImage) throw new Error('A render must be a JPEG, PNG or WebP image.');
      const mediaId = uid('med'), id = uid('rnd'), now = new Date().toISOString();
      await s.storage!.putMedia(p.id, mediaId, prep.blob);
      s.update(x => {
        x.media.push({ id: mediaId, name: `Imported render: ${f.name}`, kind: 'render', mime: prep.mime, size: prep.blob.size, addedAt: now, note: `Imported illustrative render for "${prop.title}". ${ILLUSTRATIVE_LABEL}` });
        x.proposals!.find(z => z.id === prop.id)!.renders.push({ id, mediaId, origin: 'imported', sourceMediaIds: prop.brief.sourceMediaIds, createdAt: now, createdBy: s.settings.userName, status: 'ok', note: f.name });
      }, { audit: `Imported illustrative render ${f.name} for "${prop.title}"` });
      await s.storage!.logImportedRender({ id, projectId: p.id, proposalId: prop.id, mediaId, sourceMediaIds: prop.brief.sourceMediaIds, createdBy: s.settings.userName });
      setMsg({ k: 'ok', t: 'Imported and labelled "Imported illustrative render".' });
    } catch (e: any) { setMsg({ k: 'danger', t: e.message }); }
    setBusy(false);
  };
  const last = prop.renders[prop.renders.length - 1];
  return <div className="card" data-testid={`concept-${prop.tier}`} style={prop.status === 'customer-selected' || prop.status === 'applied' ? { borderColor: 'var(--accent)', boxShadow: '0 0 0 2px var(--accent-50)' } : undefined}>
    <div className="row between"><span className="badge info">{prop.tier[0].toUpperCase() + prop.tier.slice(1)}</span>
      {prop.status === 'customer-selected' && <span className="badge ok">Customer selected</span>}{prop.status === 'applied' && <span className="badge ok">Applied</span>}</div>
    <h3 style={{ margin: '8px 0 4px' }}>{prop.title}</h3>
    {last ? <RenderView r={last} /> : <div className="empty" style={{ padding: 18, fontSize: '.82rem' }}>No picture yet.<br />{ILLUSTRATIVE_LABEL}</div>}
    <div className="row" style={{ marginTop: 8 }}>
      <button className="btn sm" disabled={busy} onClick={() => void ai()}><Sparkles size={14} /> {busy ? 'Working…' : 'Generate AI render'}</button>
      <button className="btn sm" disabled={busy} onClick={() => file.current?.click()}><ImagePlus size={14} /> Import render</button>
      <input ref={file} type="file" accept="image/*" hidden data-testid={`import-${prop.tier}`} onChange={e => { const f = e.target.files?.[0]; if (f) void importRender(f); e.target.value = ''; }} />
    </div>
    {msg && <div style={{ marginTop: 8 }}><Banner kind={msg.k}>{msg.t}</Banner></div>}
    <p style={{ fontSize: '.86rem', marginTop: 8 }}>{prop.summary}</p>
    <div className="stat" style={{ fontSize: '1.25rem' }}>{money(prop.costLow, 0)} to {money(prop.costHigh, 0)}</div>
    <small>preliminary installed cost inc GST{!prop.costComplete && <span className="badge danger" style={{ marginLeft: 6 }}>incomplete</span>}{over && <span className="badge warn" style={{ marginLeft: 6 }}>over budget</span>}</small>
    <details className="explain" open><summary>Key changes ({prop.changes.length})</summary><ul style={{ paddingLeft: 18, margin: '4px 0' }}>{prop.changes.slice(0, 14).map(c => <li key={c.id}>{c.text}</li>)}{prop.changes.length > 14 && <li>… {prop.changes.length - 14} more</li>}</ul></details>
    <details className="explain"><summary>Main materials</summary><ul style={{ paddingLeft: 18 }}>{prop.materials.map(m => <li key={m}>{m}</li>)}</ul></details>
    <details className="explain"><summary>Benefits and trade-offs</summary><b>For</b><ul style={{ paddingLeft: 18 }}>{prop.pros.map(m => <li key={m}>{m}</li>)}</ul><b>Against</b><ul style={{ paddingLeft: 18 }}>{prop.cons.map(m => <li key={m}>{m}</li>)}</ul><p><b>Maintenance:</b> {prop.maintenance}</p></details>
    <details className="explain"><summary>Assumptions to verify ({prop.assumptions.length + prop.excluded.length})</summary><ul style={{ paddingLeft: 18 }}>{prop.assumptions.map(m => <li key={m}>{m}</li>)}{prop.excluded.map(m => <li key={m}>Excluded: {m}</li>)}</ul></details>
    <details className="explain"><summary>Engineering / planning / drainage flags ({prop.reviewFlags.length})</summary><ul style={{ paddingLeft: 18 }}>{prop.reviewFlags.map(m => <li key={m}>{m}</li>)}</ul></details>
    {prop.status === 'draft' && (!selecting ? <button className="btn primary" style={{ marginTop: 10 }} onClick={() => setSelecting(true)}><Check size={15} /> Customer selects this</button> :
      <div className="grid" style={{ marginTop: 10 }}>
        <Field label="Customer name"><input value={cust} onChange={e => setCust(e.target.value)} aria-label="Customer name for selection" /></Field>
        <Field label="Note (optional)"><input value={note} onChange={e => setNote(e.target.value)} aria-label="Selection note" /></Field>
        <small>{CUSTOMER_APPROVAL_MEANS} It is not {CUSTOMER_APPROVAL_NOT.join(', ').toLowerCase()}.</small>
        <div className="row"><button className="btn primary" disabled={!cust.trim()} onClick={() => { s.update(x => { const n = selectProposal(x, prop.id, cust.trim(), s.settings.userName, note); Object.assign(x, n); }); setSelecting(false); }}>Record customer selection</button><button className="btn" onClick={() => setSelecting(false)}>Cancel</button></div>
      </div>)}
    {prop.selection && <small style={{ display: 'block', marginTop: 8 }}>Selected by {prop.selection.customerName} on {new Date(prop.selection.date).toLocaleDateString('en-AU')} (recorded by {prop.selection.by})</small>}
  </div>;
}

function ApplyPanel({ prop }: { prop: DesignProposal }) {
  const s = useStore(), d = useDerived()!, p = s.project!;
  const [ok, setOk] = useState<string[]>(() => prop.changes.map(c => c.id));
  const impact = useMemo(() => {
    const c = proposalCost(p, prop.changes.filter(x => ok.includes(x.id)).map(x => x.op), s.materials, s.suppliers, s.settings);
    const before = new Map(purchaseSchedule(d.lines, s.materials).map(r => [r.key, r]));
    const after = purchaseSchedule(takeoff(c.project, s.materials), s.materials);
    const rows = after.map(r => ({ name: r.material.name, unit: UNIT_LABEL[r.purchaseUnit], was: before.get(r.key)?.purchaseQty ?? 0, now: r.purchaseQty })).filter(r => r.was !== r.now);
    for (const [k, r] of before) if (!after.some(a => a.key === k)) rows.push({ name: r.material.name, unit: UNIT_LABEL[r.purchaseUnit], was: r.purchaseQty ?? 0, now: 0 });
    return { price: c.est.priceInc, flags: c.est.flags.length, rows };
  }, [ok, p, s.materials, s.suppliers, s.settings, d.lines, prop]);
  const apply = () => {
    try { s.update(x => { Object.assign(x, applyProposal(x, prop.id, ok, s.settings.userName)); }, { undo: true }); s.notify('ok', 'Concept applied. Two design versions saved (before and after).'); }
    catch (e: any) { s.notify('error', e.message); }
  };
  return <div className="card" data-testid="apply-panel">
    <h2>Review changes before applying: {prop.title}</h2>
    <p className="muted">Untick anything you do not want. Only ticked changes alter the project. A version of the current design is saved first.</p>
    <div className="tablewrap"><table><tbody>{prop.changes.map(c => <tr key={c.id}><td style={{ width: 30 }}><input type="checkbox" aria-label={c.text} checked={ok.includes(c.id)} onChange={e => setOk(e.target.checked ? [...ok, c.id] : ok.filter(z => z !== c.id))} /></td><td>{c.text}</td></tr>)}</tbody></table></div>
    <div className="row" style={{ margin: '10px 0' }}><span>Price inc GST: <b>{money(d.estimate.priceInc, 0)}</b> → <b data-testid="apply-after">{money(impact.price, 0)}</b></span>
      <span className={`badge ${impact.price <= d.estimate.priceInc ? 'ok' : 'warn'}`}>{impact.price >= d.estimate.priceInc ? '+' : '−'}{money(Math.abs(impact.price - d.estimate.priceInc), 0)}</span>
      {impact.flags > 0 && <span className="badge danger">{impact.flags} open pricing items after applying</span>}</div>
    <details className="explain"><summary>Affected purchase quantities ({impact.rows.length})</summary><div className="tablewrap"><table><thead><tr><th>Material</th><th className="num">Now</th><th className="num">After</th></tr></thead><tbody>
      {impact.rows.map((r, i) => <tr key={i}><td>{r.name}</td><td className="num">{fmt(r.was)} {r.unit}</td><td className="num">{r.now == null ? 'incomplete' : `${fmt(r.now)} ${r.unit}`}</td></tr>)}</tbody></table></div></details>
    <div className="row" style={{ marginTop: 10 }}>
      <button className="btn primary" disabled={!ok.length} onClick={apply}><Check size={15} /> Approve and apply {ok.length} change{ok.length === 1 ? '' : 's'}</button>
      <button className="btn" onClick={() => s.update(x => { const k = x.proposals!.find(z => z.id === prop.id)!; k.status = 'rejected'; }, { audit: `Contractor rejected applying "${prop.title}"` })}><X size={15} /> Reject</button>
    </div>
  </div>;
}

