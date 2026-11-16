import { useMemo, useRef, useState } from 'react';
import { Camera, Plus, Lightbulb, Ruler } from 'lucide-react';
import { useStore } from '../../store/useStore.ts';
import { CONDITION_LABEL, IDEAS, ideaChanges, NO_CONDITIONS, rankIdeas, type Conditions } from '../../core/ideas.ts';
import { generateProposals, yardOf } from '../../core/proposals.ts';
import { rectPoints } from '../../core/geometry.ts';
import { newObject, uid } from '../../core/project.ts';
import { GEOM, type Project, type SiteObject } from '../../core/types.ts';
import { STYLE } from '../../core/style.ts';
import { prepareUpload, useMediaUrl } from '../media.ts';
import { Banner, Field, Num } from '../kit.tsx';
import { ApiError } from '../../store/storage.ts';
import { withExampleAllowances } from '../../core/catalogue.ts';

/** Small top-view sketch of an idea fitted to this yard (balanced tier). */
function Sketch({ objects }: { objects: SiteObject[] }) {
  const pts = objects.flatMap(o => o.points);
  if (!pts.length) return null;
  const minX = Math.min(...pts.map(p => p.x)), maxX = Math.max(...pts.map(p => p.x)), minY = Math.min(...pts.map(p => p.y)), maxY = Math.max(...pts.map(p => p.y));
  const w = maxX - minX || 1, h = maxY - minY || 1, pad = 0.4;
  const order = (o: SiteObject) => (o.type === 'boundary' ? 0 : o.type === 'building' ? 1 : o.type === 'gravel' || o.type === 'turf' ? 2 : o.type === 'pergola' ? 5 : GEOM[o.type] === 'area' ? 3 : 4);
  return <svg viewBox={`${minX - pad} ${minY - pad} ${w + 2 * pad} ${h + 2 * pad}`} style={{ width: '100%', aspectRatio: `${(w + 2 * pad) / (h + 2 * pad)}`, maxHeight: 190, background: '#f6f8f4', borderRadius: 8, border: '1px solid var(--line)' }} role="img" aria-label="Plan sketch of this idea">
    {[...objects].sort((a, b) => order(a) - order(b)).map(o => {
      const st = STYLE[o.type], g = GEOM[o.type], sw = Math.max(w, h) / 160;
      if (g === 'area') return <polygon key={o.id} points={o.points.map(p => `${p.x},${p.y}`).join(' ')} fill={o.type === 'boundary' ? 'none' : o.type === 'pergola' ? 'rgba(91,70,54,.18)' : st.fill ?? 'none'} stroke={st.stroke} strokeWidth={o.type === 'boundary' ? sw * 2 : sw} strokeDasharray={o.type === 'boundary' || o.type === 'pergola' ? `${sw * 6} ${sw * 3}` : undefined} />;
      if (g === 'line') return <polyline key={o.id} points={o.points.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke={st.stroke} strokeWidth={o.type === 'wall' ? sw * 5 : sw * 1.5} />;
      const p = o.points[0], r = o.type === 'tree' ? (Number(o.props.spread) || 3) / 2 : o.type === 'firepit' ? 0.5 : 0.18;
      return <circle key={o.id} cx={p.x} cy={p.y} r={r} fill={o.type === 'tree' ? 'rgba(76,122,67,.35)' : st.fill ?? st.stroke} stroke={st.stroke} strokeWidth={sw} />;
    })}
  </svg>;
}

function PhotoTile({ id, name }: { id: string; name: string }) {
  const p = useStore(s => s.project!);
  const { url } = useMediaUrl(p.id, id);
  return <figure style={{ margin: 0 }}>{url ? <img src={url} alt={name} style={{ width: '100%', borderRadius: 8, display: 'block', aspectRatio: '4 / 3', objectFit: 'cover' }} /> : <div className="empty" style={{ aspectRatio: '4 / 3' }}>Loading…</div>}<figcaption><small>{name}</small></figcaption></figure>;
}

export function IdeasPanel({ onGenerated }: { onGenerated: () => void }) {
  const s = useStore(), p = s.project!;
  const photos = p.media.filter(m => m.mime.startsWith('image/') && m.kind !== 'render');
  const yard = yardOf(p);
  const hasDesign = p.objects.some(o => o.layer === 'proposed');
  const [cond, setCond] = useState<Conditions>(() => ({ ...NO_CONDITIONS, ...(p.proposals?.[0]?.brief.conditions ?? {}) }));
  const [size, setSize] = useState<{ w: number | null; d: number | null; house: number | null }>({ w: null, d: null, house: null });
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState<string | null>(null);
  const [examples, setExamples] = useState(false);
  const file = useRef<HTMLInputElement>(null), cam = useRef<HTMLInputElement>(null);
  const ranked = useMemo(() => rankIdeas(p, cond), [p.objects, cond]); // eslint-disable-line
  const sketches = useMemo(() => {
    const name = (id: string) => s.materials.find(m => m.id === id)?.name ?? id;
    const base = p.objects.filter(o => o.layer === 'existing');
    return Object.fromEntries(IDEAS.map(i => [i.id, [...base, ...ideaChanges({ ...p, objects: base } as Project, i.id, 'balanced', name).map(c => (c.op as any).object as SiteObject)]]));
  }, [p.objects, s.materials]); // eslint-disable-line

  const upload = async (files: FileList) => {
    setBusy(true); setMsg(null);
    const errs: string[] = [];
    for (const f of Array.from(files)) {
      try {
        const prep = await prepareUpload(f);
        if (!prep.isImage) throw new Error(`${f.name}: use a JPEG, PNG or WebP photo here.`);
        const id = uid('med');
        await s.storage!.putMedia(p.id, id, prep.blob);
        s.update(x => { x.media.push({ id, name: f.name, kind: 'photo', mime: prep.mime, size: prep.blob.size, addedAt: new Date().toISOString(), tags: [] }); }, { audit: `Before photo uploaded: ${f.name}` });
      } catch (e: any) { errs.push(e instanceof ApiError ? `${f.name}: ${e.message}` : e.message); }
    }
    setBusy(false); if (errs.length) setMsg(errs.join(' '));
  };
  const makeSite = () => {
    if (!size.w || !size.d) return;
    const w = size.w, d = size.d, hw = size.house ?? 0;
    s.update(x => {
      const b = newObject('boundary', rectPoints(0, 0, w, d), x.objects); b.name = 'Site outline (from quick size)'; b.confidence = 'estimated';
      x.objects.push(b);
      if (hw > 0) { const h = newObject('building', rectPoints((w - Math.min(hw, w)) / 2, 0, Math.min(hw, w), 1.2), x.objects); h.name = 'House'; x.objects.push(h); }
    }, { undo: true, audit: `Quick site size entered: ${w} × ${d} m${hw ? `, house ${hw} m wide` : ''} (estimated)` });
  };
  const useIdea = (ideaId: string) => {
    const brief = { style: IDEAS.find(i => i.id === ideaId)!.name, inclusions: [], budgetMax: p.brief.budgetMax, constraints: p.site.conditions.slice(0, 200), sourceMediaIds: photos.slice(0, 1).map(m => m.id), ideaId, conditions: { ...cond } };
    const pa = examples ? withExampleAllowances(p.priceAssumptions, s.materials) : p.priceAssumptions;
    const r = generateProposals({ ...p, priceAssumptions: pa }, brief, s.materials, s.suppliers, s.settings);
    if (r.error) { setMsg(r.error); return; }
    s.update(x => { x.priceAssumptions = pa; x.proposals = [...(x.proposals ?? []).filter(k => k.status === 'applied'), ...r.proposals]; if (x.status === 'draft') x.status = 'concept'; }, { audit: `Idea chosen: ${brief.style}; generated Economy / Balanced / Premium${examples ? ' (example allowances applied to unpriced items)' : ''}` });
    onGenerated();
  };

  return <div className="card" data-testid="ideas-panel">
    <h2><Lightbulb size={17} style={{ verticalAlign: -3 }} /> Start from the before photo</h2>
    <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', alignItems: 'start' }}>
      <div>
        <h3>1. Before photo</h3>
        {photos.length ? <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>{photos.slice(0, 4).map(m => <PhotoTile key={m.id} id={m.id} name={m.name} />)}</div> : <div className="empty" style={{ padding: 16 }}>No photo yet</div>}
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn sm primary" disabled={busy} onClick={() => cam.current?.click()}><Camera size={14} /> Take photo</button>
          <button className="btn sm" disabled={busy} onClick={() => file.current?.click()}><Plus size={14} /> Upload photo</button>
          <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={e => { if (e.target.files?.length) void upload(e.target.files); e.target.value = ''; }} />
          <input ref={file} data-testid="before-photo-input" type="file" accept="image/*" multiple hidden onChange={e => { if (e.target.files?.length) void upload(e.target.files); e.target.value = ''; }} />
        </div>
      </div>
      <div>
        <h3>2. What do you see?</h3>
        <div className="grid" style={{ gap: 4 }}>{(Object.keys(CONDITION_LABEL) as (keyof Conditions)[]).map(k => <label key={k} className="row" style={{ gap: 8, fontSize: '.88rem' }}><input type="checkbox" checked={cond[k]} onChange={e => setCond({ ...cond, [k]: e.target.checked })} />{CONDITION_LABEL[k]}</label>)}</div>
        <small>The studio cannot read the photo by itself without an AI key. These answers and the yard size drive the suggestions.</small>
      </div>
      <div>
        <h3>3. Yard size</h3>
        {yard ? <><div className="stat" style={{ fontSize: '1.2rem' }}>{yard.w.toFixed(1)} × {yard.d.toFixed(1)} m</div><small>usable yard from the site outline{p.objects.find(o => o.type === 'boundary')?.confidence !== 'verified' ? ' (estimated: measure before quoting)' : ''}</small></>
          : <><div className="grid g2" style={{ gap: 6 }}>
            <Field label="Width"><Num ariaLabel="Yard width" value={size.w} allowNull min={2} max={100} unit="m" onChange={v => setSize({ ...size, w: v })} /></Field>
            <Field label="Depth"><Num ariaLabel="Yard depth" value={size.d} allowNull min={2} max={100} unit="m" onChange={v => setSize({ ...size, d: v })} /></Field>
            <Field label="House width along yard" hint="0 if none"><Num ariaLabel="House width" value={size.house} allowNull min={0} max={100} unit="m" onChange={v => setSize({ ...size, house: v })} /></Field>
          </div>
            <button className="btn sm primary" style={{ marginTop: 6 }} disabled={!size.w || !size.d} onClick={makeSite}><Ruler size={14} /> Use this size</button>
            <small style={{ display: 'block', marginTop: 4 }}>Pace it out or use a laser. Marked as estimated until measured. You can refine the shape in Site Drawing.</small></>}
      </div>
    </div>
    {msg && <div style={{ marginTop: 10 }}><Banner kind="danger">{msg}</Banner></div>}
    {hasDesign && <div style={{ marginTop: 10 }}><Banner kind="info">This project already has a design applied. To try a different idea, restore the "Before …" version in Design Studio, or start a new project.</Banner></div>}
    {yard && !hasDesign && <>
      <h3 style={{ marginTop: 16 }}>4. Ideas for this yard</h3>
      <div className="cards" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))' }}>
        {ranked.map((r, i) => <div className="card" key={r.idea.id} data-testid={`idea-${r.idea.id}`} style={{ display: 'flex', flexDirection: 'column', gap: 8, opacity: r.fits ? 1 : 0.6 }}>
          <div className="row between"><b>{r.idea.name}</b>{!r.fits ? <span className="badge">Doesn't fit</span> : i === 0 ? <span className="badge ok">Best fit</span> : r.score >= 60 ? <span className="badge info">Good fit</span> : <span className="badge">Possible</span>}</div>
          {r.fits && <Sketch objects={sketches[r.idea.id]} />}
          <div style={{ fontSize: '.85rem' }}>{r.idea.pitch}</div>
          {r.why.length > 0 && <ul style={{ margin: 0, paddingLeft: 18, fontSize: '.8rem', color: 'var(--muted)' }}>{r.why.map(w => <li key={w}>{w}</li>)}</ul>}
          <button className="btn primary sm" style={{ marginTop: 'auto' }} disabled={!r.fits} onClick={() => useIdea(r.idea.id)}>Use this idea: show Economy / Balanced / Premium</button>
        </div>)}
      </div>
      <label className="row" style={{ marginTop: 10, gap: 8, fontSize: '.88rem' }}><input type="checkbox" checked={examples} onChange={e => setExamples(e.target.checked)} aria-label="Use example allowances" />
        Fill items that have no price with example allowances, so the three prices can be compared. They are labelled "EXAMPLE ALLOWANCE, not a quote" until you replace them.</label>
      <small style={{ display: 'block', marginTop: 6 }}>Sketches are fitted to the yard size and drawn in the Balanced version. Positions are proposals to measure and agree on site.</small>
    </>}
  </div>;
}
