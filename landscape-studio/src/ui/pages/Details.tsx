import { useMemo, useState } from 'react';
import { ShieldCheck, ExternalLink } from 'lucide-react';
import { useDerived, useStore } from '../../store/useStore.ts';
import { STATUS_LABEL as CL, type CStatus } from '../../core/compliance.ts';
import { STATUS_LABEL, today, uid } from '../../core/project.ts';
import { buildSheets } from '../../core/exports/sheets.ts';
import { sheetToSvg } from '../../core/exports/render.ts';
import { Banner, Empty, Field, Text } from '../kit.tsx';
import type { Project } from '../../core/types.ts';
import { CUSTOMER_APPROVAL_MEANS, CUSTOMER_APPROVAL_NOT, STATUS_ORDER, statusChangeError } from '../../core/approval.ts';
import { assemblies } from '../../core/layers.ts';
import { Iso3D } from './Iso3D.tsx';
import { BuildLayers } from './BuildLayers.tsx';

const BADGE: Record<CStatus, string> = { verified: 'ok', potential: 'danger', insufficient: 'warn', na: '' };
const ORDER: Project['status'][] = STATUS_ORDER;

export function Details() {
  const s = useStore(), d = useDerived()!, p = s.project!;
  const [tab, setTab] = useState<'checks' | 'layers' | 'details' | 'approvals'>('checks');
  const [filter, setFilter] = useState<CStatus | 'all'>('all');
  const [form, setForm] = useState({ scope: '', reviewer: '', credential: '', reference: '', note: '' });
  const walls = p.objects.filter(o => o.type === 'wall' && o.layer === 'proposed');
  const isReviewer = s.settings.role === 'reviewer';
  const sheets = useMemo(() => buildSheets({ project: p, materials: s.materials, settings: s.settings, lines: d.lines, checks: d.checks, tasks: d.tasks, size: 'A3' }).filter(x => /section|elevation/.test(x.title)), [p, s.materials, s.settings, d]);
  const counts = (st: CStatus) => d.checks.filter(c => c.status === st).length;
  const setStatus = (st: Project['status']) => {
    const why = statusChangeError(p, st, s.settings.role, d.blockers);
    if (why) return s.notify('error', why);
    s.update(x => { x.status = st; if (st === 'approved') x.approvals.push({ id: uid('apr'), scope: 'project', kind: 'issue', reviewer: s.settings.userName, role: s.settings.role, credential: '(see engineering approvals)', reference: `Status set to ${st}`, date: today() }); if (st === 'issued') x.approvals.push({ id: uid('apr'), scope: 'project', kind: 'issue', reviewer: s.settings.userName, role: s.settings.role, credential: '(see engineering approvals)', reference: 'Issued for construction', date: today() }); }, { audit: `Status changed to ${STATUS_LABEL[st]}` });
  };
  return <>
    <h1>Construction Details and Compliance</h1>
    <p className="muted">Screening checks against published NSW sources, concept details, and the approval gate. None of this is planning approval, certification or engineering sign-off.</p>
    <div className="grid g4" style={{ marginBottom: 14 }}>
      {(['potential', 'insufficient', 'verified', 'na'] as CStatus[]).map(st => <button key={st} className="card" style={{ textAlign: 'left', cursor: 'pointer', font: 'inherit', borderColor: filter === st ? 'var(--accent)' : undefined }} onClick={() => { setFilter(filter === st ? 'all' : st); setTab('checks'); }}>
        <span className={`badge ${BADGE[st]}`}>{CL[st]}</span><div className="stat">{counts(st)}</div></button>)}
    </div>
    <div className="tabs" role="tablist">
      <button role="tab" className={tab === 'checks' ? 'active' : ''} onClick={() => setTab('checks')}>NSW checks ({d.checks.length})</button>
      <button role="tab" className={tab === 'layers' ? 'active' : ''} onClick={() => setTab('layers')}>Build layers ({assemblies(p, d.lines, s.materials).length})</button>
      <button role="tab" className={tab === 'details' ? 'active' : ''} onClick={() => setTab('details')}>Concept details ({sheets.length})</button>
      <button role="tab" className={tab === 'approvals' ? 'active' : ''} onClick={() => setTab('approvals')}>Approvals and status</button>
    </div>

    {tab === 'checks' && d.checks.filter(c => filter === 'all' || c.status === filter).map(c => <div className="card" key={c.id} data-check={c.id}>
      <div className="row between"><h3 style={{ margin: 0 }}>{c.title}</h3><span className={`badge ${BADGE[c.status]}`}>{CL[c.status]}</span></div>
      <p style={{ margin: '8px 0' }}><b>{c.result}</b></p>
      <dl className="kv">
        <dt>Rule</dt><dd>{c.rule}</dd><dt>Project data used</dt><dd>{c.parameter}</dd><dt>Uncertainty</dt><dd>{c.uncertainty}</dd><dt>Needs human review</dt><dd>{c.humanReview}</dd>
        <dt>Source</dt><dd><a href={c.sourceUrl} target="_blank" rel="noreferrer">{c.sourceName} <ExternalLink size={12} /></a></dd>
        <dt>Jurisdiction</dt><dd>{c.jurisdiction}</dd><dt>Source version</dt><dd>{c.effective}</dd><dt>Source checked</dt><dd>{c.checked}</dd>
      </dl>
    </div>)}

    {tab === 'layers' && <>
      <div className="card"><h2>3D massing of the current design</h2><div style={{ height: 320, border: '1px solid var(--line)', borderRadius: 9, overflow: 'hidden' }}><Iso3D project={p} materials={s.materials} /></div></div>
      <BuildLayers />
    </>}
    {tab === 'details' && (sheets.length === 0 ? <Empty title="No walls or paving in the design"><p>Concept elevations and sections appear here once the design includes a retaining wall or paving.</p></Empty> : <>
      <Banner kind="warn">Concept details show the arrangement of components and the quantities they drive. They contain no structural design. Use the manufacturer's installation guide or an engineer's drawing for construction.</Banner>
      {sheets.map(sh => <div key={sh.number} style={{ marginBottom: 14 }}><div className="row between"><h3>{sh.number} {sh.title}</h3></div><div className="sheet-prev" dangerouslySetInnerHTML={{ __html: sheetToSvg(sh).replace(/width="[\d.]+mm" height="[\d.]+mm"/, '') }} /></div>)}
    </>)}

    {tab === 'approvals' && <>
      <div className="card">
        <h2>Project status</h2>
        <div className="row">{ORDER.map(st => <button key={st} disabled={s.settings.role === 'crew'} className={`btn sm ${p.status === st ? 'active' : ''}`} aria-pressed={p.status === st} onClick={() => setStatus(st)}>{STATUS_LABEL[st]}</button>)}</div>
        <Banner kind="info"><b>Customer selection</b> means: {CUSTOMER_APPROVAL_MEANS} It is <b>not</b> {CUSTOMER_APPROVAL_NOT.join(', ').toLowerCase()}.</Banner>
        <small style={{ display: 'block', marginTop: 8 }}>Every drawing carries this status. "Approved" and "Issued for construction" need the Authorised reviewer role and no open technical blockers. The crew role cannot change status.</small>
        <h3 style={{ marginTop: 14 }}>Before issue for construction</h3>
        {d.blockers.length === 0 ? <Banner kind="ok">No open blockers recorded.</Banner> : <Banner kind="danger"><ul style={{ margin: 0, paddingLeft: 18 }}>{d.blockers.map((b, i) => <li key={i}>{b}</li>)}</ul></Banner>}
      </div>
      <div className="card">
        <h2>Measurement sign-off</h2>
        {p.approvals.filter(a => a.kind === 'measurements').map(a => <div key={a.id} className="row between" style={{ borderTop: '1px solid var(--line)', padding: '6px 0' }}><span>Signed off by <b>{a.reviewer}</b> ({a.role}) on {a.date}{a.note ? `: ${a.note}` : ''}</span><button className="btn sm ghost" onClick={() => s.update(x => { x.approvals = x.approvals.filter(k => k.id !== a.id); }, { audit: 'Measurement sign-off withdrawn' })}>Withdraw</button></div>)}
        {d.tasks.length > 0 && <Banner kind="warn">{d.tasks.length} set-out measurements still have no verified record (see Site Capture → Measurements). You can sign off anyway, but it will be recorded.</Banner>}
        <button className="btn" disabled={s.settings.role === 'crew'} onClick={() => s.update(x => { x.approvals.push({ id: uid('apr'), scope: 'project', kind: 'measurements', reviewer: s.settings.userName, role: s.settings.role, credential: '', reference: '', date: today(), note: d.tasks.length ? `${d.tasks.length} measurements outstanding at sign-off` : 'All key measurements verified' }); }, { audit: `Measurements signed off by ${s.settings.userName}` })}><ShieldCheck size={16} /> Sign off site measurements as {s.settings.userName}</button>
      </div>
      <div className="card">
        <h2>Engineering approvals</h2>
        <p className="muted">Record an engineer's approval against a specific wall. The approval stores who entered it and the document reference. This software cannot verify a person's registration, and it never generates approvals itself.</p>
        {p.approvals.filter(a => a.kind === 'engineering').map(a => <div key={a.id} className="row between" style={{ borderTop: '1px solid var(--line)', padding: '6px 0' }}>
          <span><b>{p.objects.find(o => o.id === a.scope)?.name ?? a.scope}</b>: {a.reviewer}, credential "{a.credential}", ref "{a.reference}", {a.date}</span>
          <button className="btn sm ghost" disabled={!isReviewer} onClick={() => s.update(x => { x.approvals = x.approvals.filter(k => k.id !== a.id); }, { audit: `Engineering approval withdrawn: ${a.reference}` })}>Withdraw</button></div>)}
        {walls.length === 0 ? <small>No proposed retaining walls.</small> : !isReviewer ? <Banner kind="info">Only a user in the "Authorised reviewer" role can record an engineering approval. Your current role is "{s.settings.role}". Change it in Settings if you are the reviewing engineer.</Banner> :
          <div className="grid g2" style={{ marginTop: 10 }}>
            <Field label="Wall"><select value={form.scope} onChange={e => setForm({ ...form, scope: e.target.value })}><option value="">Select wall…</option>{walls.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>
            <Field label="Engineer name"><Text value={form.reviewer} onChange={v => setForm({ ...form, reviewer: v })} /></Field>
            <Field label="Registration / credential (as stated by the engineer)"><Text value={form.credential} onChange={v => setForm({ ...form, credential: v })} /></Field>
            <Field label="Design document reference"><Text value={form.reference} onChange={v => setForm({ ...form, reference: v })} placeholder="Drawing or certificate number" /></Field>
            <div><button className="btn primary" disabled={!form.scope || !form.reviewer.trim() || !form.credential.trim() || !form.reference.trim()} onClick={() => { s.update(x => { x.approvals.push({ id: uid('apr'), scope: form.scope, kind: 'engineering', reviewer: form.reviewer.trim(), role: 'reviewer', credential: form.credential.trim(), reference: form.reference.trim(), date: today(), note: `Entered by ${s.settings.userName}` }); }, { audit: `Engineering approval recorded for ${walls.find(w => w.id === form.scope)?.name}: ${form.reviewer}, ref ${form.reference}` }); setForm({ scope: '', reviewer: '', credential: '', reference: '', note: '' }); }}>Record approval</button>
              <small style={{ display: 'block', marginTop: 6 }}>All four fields are required.</small></div>
          </div>}
      </div>
      <div className="card">
        <h2>Audit trail</h2>
        <div className="tablewrap" style={{ maxHeight: 320, overflowY: 'auto' }}><table><thead><tr><th>When</th><th>Who</th><th>What</th></tr></thead><tbody>
          {[...p.audit].reverse().slice(0, 200).map((a, i) => <tr key={i}><td style={{ whiteSpace: 'nowrap' }}>{new Date(a.at).toLocaleString('en-AU', { dateStyle: 'short', timeStyle: 'short' })}</td><td>{a.by}</td><td>{a.action}</td></tr>)}
        </tbody></table></div>
      </div>
    </>}
  </>;
}
