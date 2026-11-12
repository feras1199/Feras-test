import { useRef, useState } from 'react';
import { Camera, Trash2, Sparkles, MapPinned, Plus, Ruler, X, Check, FlaskConical, FileText } from 'lucide-react';
import { useDerived, useStore } from '../../store/useStore.ts';
import { forgetMedia, prepareUpload, useMediaUrl } from '../media.ts';
import { Banner, ConfBadge, Empty, Field, Num, Select, Text } from '../kit.tsx';
import { today, uid } from '../../core/project.ts';
import { dist, asRectangle, resizeRectangle, setPolylineLength } from '../../core/geometry.ts';
import { fmtLen } from '../../core/units.ts';
import { GEOM, type Measurement, type MeasureMethod, type MediaRef, type Project, type SiteObject } from '../../core/types.ts';
import type { MeasureTask } from '../../core/validation.ts';
import { ApiError } from '../../store/storage.ts';

const METHODS: [MeasureMethod, string, Measurement['confidence']][] = [
  ['laser', 'Laser distance meter', 'verified'], ['tape', 'Tape measure', 'verified'], ['survey', 'Registered survey / survey plan', 'verified'],
  ['plan', 'Scaled from an existing plan', 'estimated'], ['scan', 'Phone LiDAR / photogrammetry scan', 'estimated'], ['photo-estimate', 'Estimated from photo', 'estimated'],
  ['aerial', 'Scaled from aerial image', 'estimated'], ['assumed', 'Assumed', 'estimated'],
];
const TAG_TYPES = ['Building', 'Retaining wall', 'Fence', 'Paving', 'Garden bed', 'Tree', 'Steps', 'Drain / pit', 'Level change', 'Service fixture', 'Obstruction', 'Needs measuring'];

export function Capture() {
  const s = useStore(), d = useDerived()!, p = s.project!;
  const [tab, setTab] = useState<'media' | 'measure' | 'notes'>('media');
  return <>
    <h1>Site Capture</h1>
    <p className="muted">Photos and documents are evidence. Measurements are only "verified" when taken with an instrument or from a survey; everything else stays an estimate.</p>
    <div className="tabs" role="tablist">
      <button role="tab" className={tab === 'media' ? 'active' : ''} onClick={() => setTab('media')}>Photos and files ({p.media.length})</button>
      <button role="tab" className={tab === 'measure' ? 'active' : ''} onClick={() => setTab('measure')}>Measurements ({p.measurements.length}) · {d.tasks.length} needed</button>
      <button role="tab" className={tab === 'notes' ? 'active' : ''} onClick={() => setTab('notes')}>Site notes ({p.progress.length})</button>
    </div>
    {tab === 'media' && <MediaTab />}
    {tab === 'measure' && <MeasureTab />}
    {tab === 'notes' && <NotesTab />}
  </>;
}

function MediaTab() {
  const s = useStore(), p = s.project!;
  const input = useRef<HTMLInputElement>(null), cam = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false), [busy, setBusy] = useState(false), [errors, setErrors] = useState<string[]>([]), [open, setOpen] = useState<string | null>(null);
  const add = async (files: FileList | File[]) => {
    setBusy(true); const errs: string[] = []; let ok = 0;
    for (const f of Array.from(files)) {
      try {
        const prep = await prepareUpload(f);
        const id = uid('med');
        await s.storage!.putMedia(p.id, id, prep.blob);
        const ref: MediaRef = { id, name: f.name, kind: prep.isImage ? 'photo' : /\.(glb|gltf|obj|usdz|ply|las|laz|e57)$/i.test(f.name) ? 'scan' : /\.pdf$/i.test(f.name) ? 'plan' : 'document', mime: prep.mime, size: prep.blob.size, addedAt: new Date().toISOString(), tags: [] };
        s.update(x => { x.media.push(ref); }, { audit: `Uploaded ${f.name}` });
        ok++;
      } catch (e: any) { errs.push(e instanceof ApiError && e.status === 0 ? `${f.name}: upload interrupted (${e.message})` : e.message ?? String(e)); }
    }
    setBusy(false); setErrors(errs);
    if (ok) s.notify('ok', `${ok} file${ok > 1 ? 's' : ''} added.`);
  };
  const current = p.media.find(m => m.id === open);
  return <>
    <div className={`drop ${over ? 'over' : ''}`} onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={e => { e.preventDefault(); setOver(false); void add(e.dataTransfer.files); }}>
      <div className="row" style={{ justifyContent: 'center' }}>
        <button className="btn primary" disabled={busy} onClick={() => cam.current?.click()}><Camera size={16} /> Take photo</button>
        <button className="btn" disabled={busy} onClick={() => input.current?.click()}><Plus size={16} /> Upload photos, plans or scans</button>
      </div>
      <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={e => { if (e.target.files?.length) void add(e.target.files); e.target.value = ''; }} />
      <input ref={input} data-testid="file-input" type="file" multiple hidden onChange={e => { if (e.target.files?.length) void add(e.target.files); e.target.value = ''; }} />
      <small style={{ display: 'block', marginTop: 8 }}>{busy ? 'Processing…' : 'Or drop files here. JPEG, PNG, WebP photos; PDF plans; GLB, GLTF, OBJ, USDZ, PLY, LAS, E57 scans (stored for reference). Location metadata is stripped from photos.'}</small>
    </div>
    {errors.length > 0 && <div style={{ marginTop: 10 }}><Banner kind="danger"><b>{errors.length} file{errors.length > 1 ? 's were' : ' was'} not added</b><ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{errors.map((e, i) => <li key={i}>{e}</li>)}</ul></Banner></div>}
    <div style={{ marginTop: 14 }}>
      {p.media.length === 0 ? <Empty title="No photos yet"><p>Walk the site and photograph each area from two or three angles, including a wide shot of every wall, level change and drain. Add any survey or plan PDFs.</p></Empty> :
        <div className="photo-grid">{p.media.map(m => <Thumb key={m.id} m={m} onOpen={() => setOpen(m.id)} />)}</div>}
    </div>
    {current && <Viewer m={current} onClose={() => setOpen(null)} />}
  </>;
}

function Thumb({ m, onOpen }: { m: MediaRef; onOpen: () => void }) {
  const p = useStore(s => s.project!);
  const { url, missing } = useMediaUrl(p.id, m.mime.startsWith('image/') ? m.id : undefined);
  return <button className="photo" onClick={onOpen} aria-label={`Open ${m.name}`}>
    {m.mime.startsWith('image/') ? (url ? <img src={url} alt={m.name} /> : <div style={{ color: '#fff', display: 'grid', placeItems: 'center', height: '100%', fontSize: '.8rem' }}>{missing ? 'File missing' : 'Loading…'}</div>)
      : <div style={{ color: '#fff', display: 'grid', placeItems: 'center', height: '100%' }}><FileText size={30} /></div>}
    <span className="cap">{m.kind === 'aerial' ? 'Aerial · ' : m.kind === 'scan' ? 'Scan · ' : m.kind === 'plan' ? 'Plan · ' : ''}{m.name}{m.tags?.length ? ` · ${m.tags.length} tags` : ''}</span>
  </button>;
}

function Viewer({ m, onClose }: { m: MediaRef; onClose: () => void }) {
  const s = useStore(), p = s.project!;
  const isImg = m.mime.startsWith('image/');
  const { url, missing } = useMediaUrl(p.id, isImg ? m.id : undefined);
  const [tagType, setTagType] = useState(TAG_TYPES[0]);
  const [ai, setAi] = useState<{ state: 'idle' | 'busy' | 'done' | 'error'; text?: string; live?: boolean }>({ state: 'idle' });
  const upd = (fn: (m: MediaRef) => void, audit?: string) => s.update(x => { const mm = x.media.find(k => k.id === m.id); if (mm) fn(mm); }, audit ? { audit } : undefined);
  const onClick = (e: React.MouseEvent<HTMLImageElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    upd(mm => { (mm.tags ??= []).push({ id: uid('tag'), x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, label: tagType, type: tagType, origin: 'user', confirmed: true }); });
  };
  const analyse = async () => {
    setAi({ state: 'busy' });
    try {
      const r = await s.storage!.analyzePhoto(p.id, m.id);
      upd(mm => { for (const f of r.features) (mm.tags ??= []).push({ id: uid('tag'), x: f.x, y: f.y, label: f.label, type: f.type, origin: 'ai-live', confirmed: false }); mm.note = [mm.note, `AI (${r.model}) ${today()}: ${r.summary}${r.measurements.length ? ' Measure: ' + r.measurements.join('; ') : ''}`].filter(Boolean).join('\n'); }, `Live AI photo analysis (${r.model}) on ${m.name}`);
      setAi({ state: 'done', live: true, text: `${r.features.length} features suggested by ${r.model}. Confirm or remove each one.` });
    } catch (e: any) { setAi({ state: 'error', text: e instanceof ApiError && e.code === 'AI_NOT_CONFIGURED' ? 'Live AI analysis is not available: no API key is configured on the server. Nothing was analysed.' : `AI analysis failed: ${e.message}` }); }
  };
  const simulate = () => {
    upd(mm => { for (const [label, x, y] of [['Retaining wall', 0.5, 0.62], ['Fence', 0.82, 0.3], ['Needs measuring', 0.3, 0.75]] as const) (mm.tags ??= []).push({ id: uid('tag'), x, y, label: `${label} (SIMULATED)`, type: label, origin: 'ai-simulated', confirmed: false }); }, `SIMULATED analysis markers added to ${m.name}`);
    setAi({ state: 'done', live: false, text: 'SIMULATED result: three fixed example markers were added to show the review workflow. No model looked at this image.' });
  };
  const useAsRef = () => {
    if (!url) return;
    const img = new Image();
    img.onload = () => { s.update(x => { x.underlay = { mediaId: m.id, x: 0, y: 0, mPerPx: 0.02, opacity: 0.6, calibrated: false, w: img.naturalWidth, h: img.naturalHeight }; const mm = x.media.find(k => k.id === m.id); if (mm) mm.kind = 'aerial'; }, { audit: `Set ${m.name} as drawing reference image (uncalibrated)` }); s.notify('info', 'Reference image placed. Calibrate it with a known distance in Site Drawing.'); s.go('drawing'); };
    img.src = url;
  };
  const del = async () => { await s.storage!.deleteMedia(p.id, m.id).catch(() => undefined); forgetMedia(p.id, m.id); s.update(x => { x.media = x.media.filter(k => k.id !== m.id); if (x.underlay?.mediaId === m.id) delete x.underlay; }, { audit: `Deleted ${m.name}` }); onClose(); };
  return <div className="card" style={{ marginTop: 14 }} data-testid="viewer">
    <div className="row between"><h2 style={{ margin: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.name}</h2><button className="btn ghost icon" aria-label="Close viewer" onClick={onClose}><X size={18} /></button></div>
    {!isImg ? <p className="muted" style={{ marginTop: 8 }}>Stored for reference ({(m.size / 1024).toFixed(0)} KB, {m.mime}). This app does not render PDF pages or 3D scans. Open the file in its own viewer, and enter the measurements you need on the Measurements tab.</p> :
      missing ? <Banner kind="danger">The image file is missing from storage. Delete this entry and upload it again.</Banner> :
        <div className="grid g2" style={{ marginTop: 10, alignItems: 'start' }}>
          <div>
            <div className="tagger">{url && <img src={url} alt={m.name} onClick={onClick} style={{ cursor: 'crosshair' }} />}
              {(m.tags ?? []).map((t, i) => <span key={t.id} className={`pin ${t.origin === 'ai-simulated' ? 'sim' : t.confirmed ? 'confirmed' : ''}`} style={{ left: `${t.x * 100}%`, top: `${t.y * 100}%` }} title={t.label}>{i + 1}</span>)}
            </div>
            <div className="row" style={{ marginTop: 8 }}><small>Click the photo to tag a</small><select aria-label="Feature type" style={{ width: 'auto' }} value={tagType} onChange={e => setTagType(e.target.value)}>{TAG_TYPES.map(t => <option key={t}>{t}</option>)}</select></div>
          </div>
          <div>
            <div className="row">
              <button className="btn" onClick={() => void analyse()} disabled={ai.state === 'busy'}><Sparkles size={16} /> {ai.state === 'busy' ? 'Analysing…' : 'Analyse with AI'}</button>
              <button className="btn" onClick={simulate}><FlaskConical size={16} /> Simulated analysis (demo)</button>
              <button className="btn" onClick={useAsRef}><MapPinned size={16} /> Use as drawing reference</button>
            </div>
            {ai.text && <div style={{ marginTop: 8 }}><Banner kind={ai.state === 'error' ? 'danger' : ai.live ? 'ok' : 'warn'}>{ai.text}</Banner></div>}
            <h3 style={{ marginTop: 12 }}>Tagged features</h3>
            {(m.tags ?? []).length === 0 ? <small>No features tagged. Tags are a visual record only: they never create geometry or dimensions.</small> :
              <div className="tablewrap"><table><tbody>{(m.tags ?? []).map((t, i) => <tr key={t.id}>
                <td style={{ width: 28 }}>{i + 1}</td>
                <td><Text ariaLabel="Tag label" value={t.label} onChange={v => upd(mm => { const k = mm.tags!.find(z => z.id === t.id)!; k.label = v; })} /></td>
                <td><span className={`badge ${t.origin === 'user' ? 'ok' : t.origin === 'ai-live' ? 'info' : 'warn'}`}>{t.origin === 'user' ? 'You' : t.origin === 'ai-live' ? 'AI (live)' : 'SIMULATED'}</span></td>
                <td className="num"><span className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                  {!t.confirmed && <button className="btn sm" onClick={() => upd(mm => { mm.tags!.find(z => z.id === t.id)!.confirmed = true; })}><Check size={14} /> Confirm</button>}
                  <button className="btn sm ghost icon" aria-label="Remove tag" onClick={() => upd(mm => { mm.tags = mm.tags!.filter(z => z.id !== t.id); })}><Trash2 size={14} /></button></span></td>
              </tr>)}</tbody></table></div>}
            <div style={{ marginTop: 10 }}><Field label="Notes for this photo"><Text area value={m.note ?? ''} onChange={v => upd(mm => { mm.note = v; })} /></Field></div>
          </div>
        </div>}
    <div className="row" style={{ marginTop: 12 }}><button className="btn danger sm" onClick={() => void del()}><Trash2 size={14} /> Delete file</button></div>
  </div>;
}

export function EdgeDiagram({ o, link }: { o: SiteObject; link: MeasureTask['link'] }) {
  if (!o.points.length || !('a' in link)) return null;
  const xs = o.points.map(q => q.x), ys = o.points.map(q => q.y);
  const minX = Math.min(...xs), minY = Math.min(...ys), w = Math.max(...xs) - minX || 1, h = Math.max(...ys) - minY || 1;
  const k = Math.min(100 / w, 56 / h), ox = (120 - w * k) / 2, oy = (76 - h * k) / 2;
  const P = o.points.map(q => [ox + (q.x - minX) * k, oy + (q.y - minY) * k]);
  const a = P[link.a], b = P[link.b];
  return <svg width="120" height="76" viewBox="0 0 120 76" role="img" aria-label="Where to measure" style={{ flex: 'none', background: '#fff', border: '1px solid var(--line)', borderRadius: 6 }}>
    {GEOM[o.type] === 'area' ? <polygon points={P.map(q => q.join(',')).join(' ')} fill="#eef2ee" stroke="#8a948c" /> : <polyline points={P.map(q => q.join(',')).join(' ')} fill="none" stroke="#8a948c" strokeWidth="2" />}
    {a && b && <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke="#b3261e" strokeWidth="3" strokeLinecap="round" />}
    {P.map((q, i) => <g key={i}><circle cx={q[0]} cy={q[1]} r={i === link.a || i === link.b ? 4 : 2.5} fill={i === link.a || i === link.b ? '#b3261e' : '#5a6572'} /><text x={q[0] + 5} y={q[1] - 4} fontSize="9" fill="#17202a">{i + 1}</text></g>)}
  </svg>;
}

function drawnValue(p: Project, link: Measurement['link']): number | null {
  if (!link) return null;
  const o = p.objects.find(x => x.id === link.objectId);
  if (!o) return null;
  if ('prop' in link) { const v = o.props[link.prop]; return v == null || v === '' ? null : Number(v); }
  return o.points[link.a] && o.points[link.b] ? dist(o.points[link.a], o.points[link.b]) : null;
}

function MeasureTab() {
  const s = useStore(), d = useDerived()!, p = s.project!;
  const blank = (): Measurement => ({ id: uid('mea'), label: '', value: null, method: 'laser', source: s.settings.userName, confidence: 'verified', date: today(), verifiedBy: s.settings.userName });
  const [draft, setDraft] = useState<Measurement | null>(null);
  const start = (t?: MeasureTask) => setDraft({ ...blank(), label: t?.label ?? '', link: t?.link });
  const save = () => {
    if (!draft || draft.value == null || !draft.label.trim()) return;
    const conf = METHODS.find(m => m[0] === draft.method)![2];
    s.update(x => { x.measurements.push({ ...draft, confidence: conf, verifiedBy: conf === 'verified' ? s.settings.userName : undefined }); }, { audit: `Measurement recorded: ${draft.label} = ${draft.value} m (${draft.method})` });
    setDraft(null);
  };
  const apply = (m: Measurement) => {
    if (!m.link || m.value == null) return;
    const link = m.link, v = m.value;
    s.update(x => {
      const o = x.objects.find(k => k.id === link.objectId); if (!o) return;
      if ('prop' in link) { o.props[link.prop] = v; if (link.prop === 'retainedHeight' && (o.props.exposedHeight == null || o.props.exposedHeight === '')) o.props.exposedHeight = v; return; }
      const r = asRectangle(o.points), n = o.points.length;
      if (r && (link.b === (link.a + 1) % n || link.a === (link.b + 1) % n)) { const e = Math.min(link.a, link.b) === 0 && Math.max(link.a, link.b) === 3 ? 3 : Math.min(link.a, link.b); o.points = e % 2 === 0 ? resizeRectangle(o.points, v, r.h) : resizeRectangle(o.points, r.w, v); }
      else if (GEOM[o.type] === 'line' && n === 2) o.points = setPolylineLength(o.points, v);
    }, { undo: true, audit: `Drawing updated to match measurement: ${m.label}` });
  };
  const canApply = (m: Measurement) => { if (!m.link || m.value == null) return false; const o = p.objects.find(k => k.id === m.link!.objectId); if (!o || o.locked) return false; if ('prop' in m.link) return true; const n = o.points.length; return (!!asRectangle(o.points) && (Math.abs(m.link.a - m.link.b) === 1 || Math.abs(m.link.a - m.link.b) === n - 1)) || (GEOM[o.type] === 'line' && n === 2); };
  const conflicts = d.issues.filter(i => i.kind === 'measurement-conflict' || i.kind === 'diagonal' || i.kind === 'level-conflict');
  return <>
    {conflicts.length > 0 && <Banner kind="danger"><b>Conflicting measurements.</b> Nothing was changed automatically.<ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{conflicts.map((c, i) => <li key={i}>{c.message}</li>)}</ul></Banner>}
    <div className="card">
      <div className="row between"><h2 style={{ margin: 0 }}>Measurements still needed</h2><button className="btn primary" onClick={() => start()}><Plus size={16} /> Record a measurement</button></div>
      <p className="muted" style={{ marginTop: 6 }}>The smallest set that pins down set-out and cost, most important first. Red line shows where to measure; corner numbers match the drawing.</p>
      {d.tasks.length === 0 ? <Banner kind="ok">{p.objects.length ? 'Every key set-out dimension has a verified measurement.' : 'Draw the site first; the app will then list what to measure.'}</Banner> :
        d.tasks.map((t, i) => { const o = p.objects.find(x => x.id === t.objectId)!; return <div key={i} className="row" style={{ borderTop: '1px solid var(--line)', padding: '8px 0', alignItems: 'flex-start', flexWrap: 'nowrap' }}>
          <EdgeDiagram o={o} link={t.link} />
          <div className="grow"><b>{i + 1}. {t.text}</b><br /><small>{t.why}</small></div>
          <button className="btn sm" onClick={() => start(t)}><Ruler size={14} /> Record</button>
        </div>; })}
    </div>
    {draft && <div className="card" data-testid="measure-form">
      <h2>Record measurement</h2>
      <div className="grid g3">
        <Field label="What was measured"><Text value={draft.label} onChange={v => setDraft({ ...draft, label: v })} placeholder="e.g. Rear fence length" /></Field>
        <Field label="Value"><Num ariaLabel="Measured value in metres" value={draft.value} allowNull min={0.001} max={500} onChange={v => setDraft({ ...draft, value: v })} unit="m" /></Field>
        <Field label="Method" hint={METHODS.find(m => m[0] === draft.method)![2] === 'verified' ? 'Counts as verified' : 'Stays an estimate'}><Select value={draft.method} onChange={v => setDraft({ ...draft, method: v })} options={METHODS.map(m => [m[0], m[1]] as const)} /></Field>
        <Field label="Source (person or document)"><Text value={draft.source} onChange={v => setDraft({ ...draft, source: v })} /></Field>
        <Field label="Date"><input type="date" value={draft.date} onChange={e => setDraft({ ...draft, date: e.target.value })} /></Field>
        <Field label="Linked to drawing" hint="Lets the app cross-check the drawing">
          <select value={draft.link ? JSON.stringify(draft.link) : ''} onChange={e => setDraft({ ...draft, link: e.target.value ? JSON.parse(e.target.value) : undefined })}>
            <option value="">Not linked</option>
            {p.objects.filter(o => GEOM[o.type] !== 'point').flatMap(o => { const n = o.points.length, closed = GEOM[o.type] === 'area'; const out = []; for (let i = 0; i < (closed ? n : n - 1); i++) out.push(<option key={`${o.id}${i}`} value={JSON.stringify({ objectId: o.id, a: i, b: (i + 1) % n })}>{o.name}: side {i + 1}</option>); if (closed && n === 4) out.push(<option key={`${o.id}d`} value={JSON.stringify({ objectId: o.id, a: 0, b: 2 })}>{o.name}: diagonal 1 to 3</option>); if (o.type === 'wall') out.push(<option key={`${o.id}h`} value={JSON.stringify({ objectId: o.id, prop: 'retainedHeight' })}>{o.name}: retained height</option>, <option key={`${o.id}e`} value={JSON.stringify({ objectId: o.id, prop: 'exposedHeight' })}>{o.name}: exposed height</option>); return out; })}
            {p.objects.filter(o => o.type === 'tree').map(o => <option key={o.id} value={JSON.stringify({ objectId: o.id, prop: 'dbh' })}>{o.name}: trunk diameter</option>)}
          </select></Field>
      </div>
      <div className="row" style={{ marginTop: 12 }}><button className="btn primary" disabled={draft.value == null || !draft.label.trim()} onClick={save}>Save measurement</button><button className="btn" onClick={() => setDraft(null)}>Cancel</button>
        {(draft.value == null || !draft.label.trim()) && <small>Enter a description and a value greater than zero.</small>}</div>
    </div>}
    <div className="card">
      <h2>Recorded measurements</h2>
      {p.measurements.length === 0 ? <Empty title="No measurements recorded"><p>Record laser or tape measurements here. Each keeps its method, source, date and confidence.</p></Empty> :
        <div className="tablewrap"><table><thead><tr><th>Measurement</th><th className="num">Value</th><th>Confidence</th><th>Method / source</th><th>Date</th><th className="num">Drawing shows</th><th></th></tr></thead><tbody>
          {p.measurements.map(m => { const dv = drawnValue(p, m.link); const diff = dv != null && m.value != null ? Math.abs(dv - m.value) : null; const bad = diff != null && diff > (m.confidence === 'verified' ? 0.01 : 0.3);
            return <tr key={m.id}><td>{m.label}{m.note && <><br /><small>{m.note}</small></>}</td><td className="num"><b>{fmtLen(m.value, m.confidence)}</b></td><td><ConfBadge c={m.confidence} /></td>
              <td>{METHODS.find(x => x[0] === m.method)?.[1]}<br /><small>{m.source}{m.verifiedBy ? ` · verified by ${m.verifiedBy}` : ''}</small></td><td>{m.date}</td>
              <td className="num">{dv == null ? <small>not linked</small> : <span style={{ color: bad ? 'var(--danger)' : undefined }}>{dv.toFixed(3)} m{bad ? ' ⚠' : ' ✓'}</span>}</td>
              <td className="num"><span className="row" style={{ gap: 4, justifyContent: 'flex-end', flexWrap: 'nowrap' }}>{bad && canApply(m) && <button className="btn sm" onClick={() => apply(m)}>Apply to drawing</button>}
                <button className="btn sm ghost icon" aria-label={`Delete measurement ${m.label}`} onClick={() => s.update(x => { x.measurements = x.measurements.filter(k => k.id !== m.id); }, { audit: `Measurement deleted: ${m.label}` })}><Trash2 size={14} /></button></span></td></tr>; })}
        </tbody></table></div>}
    </div>
  </>;
}

function NotesTab() {
  const s = useStore(), p = s.project!;
  const [t, setT] = useState('');
  return <div className="card">
    <h2>Site notes and progress</h2>
    <form className="row" onSubmit={e => { e.preventDefault(); if (!t.trim()) return; s.update(x => { x.progress.unshift({ date: new Date().toISOString(), note: t.trim(), by: s.settings.userName }); }); setT(''); }}>
      <input className="grow" aria-label="New site note" placeholder="e.g. Side gate 1.1 m wide, excavator will fit. Stormwater pit at NW corner." value={t} onChange={e => setT(e.target.value)} />
      <button className="btn primary" type="submit" disabled={!t.trim()}>Add note</button>
    </form>
    {p.progress.length === 0 ? <p className="muted" style={{ marginTop: 10 }}>No notes yet. Use this for site observations and installation progress.</p> :
      <div style={{ marginTop: 10 }}>{p.progress.map((n, i) => <div key={i} style={{ borderTop: '1px solid var(--line)', padding: '8px 0' }}><small>{new Date(n.date).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })} · {n.by}</small><div>{n.note}</div></div>)}</div>}
  </div>;
}
