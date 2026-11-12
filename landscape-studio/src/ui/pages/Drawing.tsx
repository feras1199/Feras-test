import { useEffect, useMemo, useRef, useState } from 'react';
import { MousePointer2, Hand, Ruler, Undo2, Redo2, Maximize, Grid3x3, Trash2, Copy, RotateCw, RotateCcw, Lock, Unlock, Eye, EyeOff, Box, Crosshair, Check, X, Magnet, Plus } from 'lucide-react';
import { useDerived, useStore } from '../../store/useStore.ts';
import { GEOM, TYPE_LABEL, type ObjType, type Pt, type SiteObject } from '../../core/types.ts';
import { arcThrough, asRectangle, bbox, centroid, dist, distPointToPolyline, pointInPolygon, polygonArea, polylineLength, rectPoints, resizeRectangle, rotate, setPolylineLength, snap, translate } from '../../core/geometry.ts';
import { STYLE } from '../../core/style.ts';
import { newObject, uid } from '../../core/project.ts';
import { defaultMaterial, PATTERN_WASTE, WALL_SYSTEMS, type WallSystem } from '../../core/assemblies.ts';
import { objectDirectCost } from '../../core/estimate.ts';
import { fmt, money, UNIT_LABEL } from '../../core/units.ts';
import { useMediaUrl } from '../media.ts';
import { Banner, ConfBadge, Field, Num, Select, Text } from '../kit.tsx';
import { Iso3D } from './Iso3D.tsx';

type Tool = 'select' | 'pan' | 'measure' | 'calibrate' | ObjType;
const GROUPS: [string, ObjType[]][] = [
  ['Existing site', ['boundary', 'building', 'feature', 'fence', 'tree', 'level']],
  ['Proposed design', ['paving', 'wall', 'garden', 'turf', 'deck', 'gravel', 'steps', 'edging', 'drain', 'pit', 'light', 'cable', 'plant']],
  ['Annotate', ['dimension', 'note', 'line']],
];
const short = (t: ObjType) => TYPE_LABEL[t].replace(' (reference)', '').replace('Retaining wall', 'Retaining wall').replace('Site boundary', 'Site outline');

export function Drawing() {
  const s = useStore(), d = useDerived()!, p = s.project!;
  const svgRef = useRef<SVGSVGElement>(null), wrapRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ x: -1.5, y: -1.5, z: 42 });
  const [tool, setTool] = useState<Tool>('select');
  const [areaMode, setAreaMode] = useState<'rect' | 'poly'>('rect');
  const [lineMode, setLineMode] = useState<'poly' | 'arc'>('poly');
  const [draft, setDraft] = useState<Pt[]>([]);
  const [cursor, setCursor] = useState<Pt | null>(null);
  const [gridOn, setGridOn] = useState(true), [snapOn, setSnapOn] = useState(true), [step, setStep] = useState(0.1);
  const [dims, setDims] = useState(false), [three, setThree] = useState(false);
  const [vis, setVis] = useState({ existing: true, proposed: true, underlay: true });
  const [measure, setMeasure] = useState<Pt[]>([]);
  const [calib, setCalib] = useState<{ pts: Pt[]; value: number | null } | null>(null);
  const drag = useRef<any>(null), pointers = useRef(new Map<number, { x: number; y: number }>()), pinch = useRef<any>(null);
  const viewRef = useRef(view); viewRef.current = view;
  const sel = p.objects.find(o => o.id === s.selectedId) ?? null;
  const underlayUrl = useMediaUrl(p.id, p.underlay?.mediaId).url;

  const fit = () => {
    const el = wrapRef.current; if (!el) return;
    const pts = p.objects.flatMap(o => o.points);
    if (p.underlay) pts.push({ x: p.underlay.x, y: p.underlay.y }, { x: p.underlay.x + p.underlay.w * p.underlay.mPerPx, y: p.underlay.y + p.underlay.h * p.underlay.mPerPx });
    const b = pts.length ? bbox(pts) : { minX: 0, minY: 0, w: 14, h: 10 };
    const W = el.clientWidth, H = el.clientHeight, pad = 60;
    const z = Math.max(5, Math.min(220, Math.min((W - 2 * pad) / Math.max(b.w, 1), (H - 2 * pad) / Math.max(b.h, 1))));
    setView({ z, x: b.minX - (W / z - b.w) / 2, y: b.minY - (H / z - b.h) / 2 });
  };
  useEffect(() => { fit(); }, [p.id]); // eslint-disable-line

  const toModel = (cx: number, cy: number): Pt => { const r = svgRef.current!.getBoundingClientRect(); const v = viewRef.current; return { x: v.x + (cx - r.left) / v.z, y: v.y + (cy - r.top) / v.z }; };
  const S = (q: Pt): [number, number] => [(q.x - view.x) * view.z, (q.y - view.y) * view.z];
  const snapPt = (q: Pt, skipId?: string): Pt => {
    if (!snapOn) return q;
    let best: Pt | null = null, bd = 10 / viewRef.current.z;
    for (const o of p.objects) { if (o.id === skipId || o.hidden) continue; for (const v of o.points) { const dd = dist(q, v); if (dd < bd) { bd = dd; best = v; } } }
    return best ? { ...best } : { x: snap(q.x, step), y: snap(q.y, step) };
  };
  const visible = (o: SiteObject) => !o.hidden && vis[o.layer];
  const hit = (q: Pt): SiteObject | null => {
    const tol = 8 / view.z, list = p.objects.filter(visible);
    for (const o of [...list].reverse()) if (GEOM[o.type] === 'point' && dist(q, o.points[0]) < Math.max(tol * 1.6, o.type === 'tree' ? 0.35 : 0)) return o;
    for (const o of [...list].reverse()) if (GEOM[o.type] === 'line' && distPointToPolyline(q, o.points, false) < tol) return o;
    for (const o of [...list].reverse()) if (GEOM[o.type] === 'area' && o.type !== 'boundary' && pointInPolygon(q, o.points)) return o;
    for (const o of list) if (o.type === 'boundary' && distPointToPolyline(q, o.points, true) < tol) return o;
    return null;
  };

  const create = (type: ObjType, pts: Pt[]) => {
    const o = newObject(type, pts, p.objects, 'proposed');
    if (type === 'tree' || type === 'level') o.layer = 'existing';
    s.update(x => { x.objects.push(o); }, { undo: true, audit: `Added ${o.name}` });
    s.select(o.id);
    if (GEOM[type] !== 'point') setTool('select');
  };
  const finish = () => {
    if (tool === 'select' || tool === 'pan' || tool === 'measure' || tool === 'calibrate') return;
    const g = GEOM[tool];
    if (g === 'area' && draft.length >= 3) create(tool, draft);
    else if (g === 'line' && draft.length >= 2) create(tool, draft);
    else if (draft.length) s.notify('info', g === 'area' ? 'A shape needs at least 3 corners.' : 'A line needs at least 2 points.');
    setDraft([]);
  };
  const cancel = () => { setDraft([]); setMeasure([]); setCalib(null); drag.current = null; };

  const down = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) { const [a, b] = [...pointers.current.values()]; pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), view: viewRef.current, c: toModel((a.x + b.x) / 2, (a.y + b.y) / 2) }; drag.current = null; return; }
    const raw = toModel(e.clientX, e.clientY), q = snapPt(raw);
    if (tool === 'pan' || e.button === 1) { drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, v0: view }; return; }
    if (tool === 'select') {
      if (sel && !sel.locked) { const i = sel.points.findIndex(v => dist(v, raw) < 10 / view.z); if (i >= 0 && visible(sel)) { drag.current = { kind: 'vertex', i, started: false }; return; } }
      const h = hit(raw);
      s.select(h?.id ?? null);
      drag.current = h && !h.locked ? { kind: 'move', from: raw, applied: { x: 0, y: 0 }, started: false, id: h.id } : { kind: 'pan', sx: e.clientX, sy: e.clientY, v0: view };
      return;
    }
    if (tool === 'measure') { setMeasure(m => (m.length >= 2 ? [q] : [...m, q])); return; }
    if (tool === 'calibrate') { setCalib(c => (!c || c.pts.length >= 2 ? { pts: [raw], value: null } : { pts: [...c.pts, raw], value: null })); return; }
    const g = GEOM[tool];
    if (g === 'point') { create(tool, [q]); return; }
    if (g === 'area' && areaMode === 'rect') { drag.current = { kind: 'rect', start: q }; setDraft([q, q]); return; }
    const last = draft[draft.length - 1];
    if (last && dist(last, q) < 1e-6) return;
    if (g === 'area' && draft.length >= 3 && dist(draft[0], q) < 10 / view.z) { finish(); return; }
    const next = [...draft, q];
    if (tool === 'dimension' && next.length === 2) { create(tool, next); setDraft([]); return; }
    if (g === 'line' && lineMode === 'arc' && next.length === 3) { create(tool, arcThrough(next[0], next[1], next[2], 14)); setDraft([]); return; }
    setDraft(next);
  };
  const move = (e: React.PointerEvent) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()], r = svgRef.current!.getBoundingClientRect();
      const z = Math.max(5, Math.min(400, pinch.current.view.z * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.current.d)));
      setView({ z, x: pinch.current.c.x - ((a.x + b.x) / 2 - r.left) / z, y: pinch.current.c.y - ((a.y + b.y) / 2 - r.top) / z });
      return;
    }
    const raw = toModel(e.clientX, e.clientY);
    const dr = drag.current;
    if (!dr) { setCursor(snapPt(raw)); return; }
    if (dr.kind === 'pan') { setView({ ...dr.v0, x: dr.v0.x - (e.clientX - dr.sx) / dr.v0.z, y: dr.v0.y - (e.clientY - dr.sy) / dr.v0.z }); return; }
    if (dr.kind === 'rect') { const q = snapPt(raw); setCursor(q); setDraft([dr.start, q]); return; }
    if (dr.kind === 'vertex' && sel) {
      const q = snapPt(raw, sel.id), id = sel.id, i = dr.i;
      s.update(x => { const o = x.objects.find(k => k.id === id); if (o) { o.points[i] = q; if (o.confidence === 'verified') o.confidence = 'estimated'; } }, dr.started ? undefined : { undo: true });
      dr.started = true; setCursor(q); return;
    }
    if (dr.kind === 'move') {
      const want = { x: snap(raw.x - dr.from.x, snapOn ? step : 0), y: snap(raw.y - dr.from.y, snapOn ? step : 0) };
      const dx = want.x - dr.applied.x, dy = want.y - dr.applied.y;
      if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return;
      const id = dr.id;
      s.update(x => { const o = x.objects.find(k => k.id === id); if (o) o.points = translate(o.points, dx, dy); }, dr.started ? undefined : { undo: true });
      dr.started = true; dr.applied = want;
    }
  };
  const up = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    const dr = drag.current; drag.current = null;
    if (dr?.kind === 'rect' && tool !== 'select') {
      const q = snapPt(toModel(e.clientX, e.clientY)), w = Math.abs(q.x - dr.start.x), h = Math.abs(q.y - dr.start.y);
      if (w >= 0.05 && h >= 0.05) create(tool as ObjType, rectPoints(Math.min(q.x, dr.start.x), Math.min(q.y, dr.start.y), w, h));
      else s.notify('info', 'Press and drag to draw a rectangle. For other shapes switch to "Corners" and click each corner.');
      setDraft([]);
    }
    if (dr?.kind === 'vertex' && dr.started && sel) s.update(() => undefined, { audit: `Reshaped ${sel.name}` });
  };

  useEffect(() => {
    const el = svgRef.current; if (!el) return;
    const wheel = (e: WheelEvent) => { e.preventDefault(); const v = viewRef.current, r = el.getBoundingClientRect(); const k = Math.exp(-e.deltaY * 0.0015), z = Math.max(5, Math.min(400, v.z * k)); const mx = v.x + (e.clientX - r.left) / v.z, my = v.y + (e.clientY - r.top) / v.z; setView({ z, x: mx - (e.clientX - r.left) / z, y: my - (e.clientY - r.top) / z }); };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [three]);

  const removeSel = () => { if (!sel || sel.locked) return; const id = sel.id, nm = sel.name; s.update(x => { x.objects = x.objects.filter(o => o.id !== id); x.measurements = x.measurements.map(m => (m.link?.objectId === id ? { ...m, link: undefined } : m)); }, { undo: true, audit: `Deleted ${nm}` }); s.select(null); };
  const duplicate = () => { if (!sel) return; const c: SiteObject = { ...structuredClone(sel), id: uid('obj'), name: `${sel.name} copy`, points: translate(sel.points, 0.5, 0.5), locked: false, confidence: 'estimated' }; s.update(x => { x.objects.push(c); }, { undo: true, audit: `Duplicated ${sel.name}` }); s.select(c.id); };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return;
      if (e.key === 'Escape') { cancel(); setTool('select'); }
      else if (e.key === 'Enter') finish();
      else if ((e.key === 'Delete' || e.key === 'Backspace') && sel) { e.preventDefault(); removeSel(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) s.redo(); else s.undo(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); s.redo(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd' && sel) { e.preventDefault(); duplicate(); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  const pick = (t: Tool) => { cancel(); setTool(t); if (t !== 'select') s.select(null); };
  const applyCalib = () => {
    if (!calib || calib.pts.length < 2 || !calib.value || !p.underlay) return;
    const dPx = dist(calib.pts[0], calib.pts[1]) / p.underlay.mPerPx, v = calib.value;
    s.update(x => { const u = x.underlay!; const k = v / dPx; const a = calib.pts[0]; const fx = (a.x - u.x) / u.mPerPx, fy = (a.y - u.y) / u.mPerPx; u.mPerPx = k; u.x = a.x - fx * k; u.y = a.y - fy * k; u.calibrated = true; }, { audit: `Reference image calibrated: ${v} m known distance` });
    setCalib(null); setTool('select'); s.notify('ok', 'Reference image scaled. Anything traced from it is still an estimate until measured.');
  };

  const ordered = useMemo(() => [...p.objects].sort((a, b) => rank(a) - rank(b)), [p.objects]);
  const gpx = step * view.z, major = view.z;
  const hint = tool === 'select' ? (sel ? 'Drag to move. Drag a corner to reshape. Delete key removes.' : 'Click an object to select it. Drag empty space to pan. Scroll or pinch to zoom.')
    : tool === 'pan' ? 'Drag to pan.' : tool === 'measure' ? (measure.length === 2 ? `Distance ${dist(measure[0], measure[1]).toFixed(3)} m on the drawing (not a site measurement)` : 'Click two points to check a distance on the drawing.')
    : tool === 'calibrate' ? 'Click two points on the reference image that are a known distance apart, then enter that distance.'
    : GEOM[tool] === 'point' ? `Click to place: ${short(tool)}.` : GEOM[tool] === 'area' && areaMode === 'rect' ? `Press and drag to draw a rectangle: ${short(tool)}.`
    : lineMode === 'arc' && GEOM[tool] === 'line' ? 'Arc: click start, a point on the curve, then the end.' : `Click each corner. ${draft.length ? 'Press Finish (or Enter / double-click) when done.' : ''}`;
  const live = draft.length && cursor && tool !== 'select' ? (GEOM[tool as ObjType] === 'area' && areaMode === 'rect' ? `${Math.abs(draft[1].x - draft[0].x).toFixed(2)} × ${Math.abs(draft[1].y - draft[0].y).toFixed(2)} m` : `${dist(draft[draft.length - 1], cursor).toFixed(2)} m`) : null;

  return <div className="draw">
    <div className="palette" role="toolbar" aria-label="Drawing tools">
      <button className={`tool ${tool === 'select' ? 'active' : ''}`} onClick={() => pick('select')}><MousePointer2 size={15} /> Select / edit</button>
      <button className={`tool ${tool === 'pan' ? 'active' : ''}`} onClick={() => pick('pan')}><Hand size={15} /> Pan</button>
      <button className={`tool ${tool === 'measure' ? 'active' : ''}`} onClick={() => pick('measure')}><Ruler size={15} /> Check distance</button>
      {GROUPS.map(([g, types]) => <div key={g} style={{ display: 'contents' }}><h4>{g}</h4>
        {types.map(t => <button key={t} className={`tool ${tool === t ? 'active' : ''}`} data-tool={t} onClick={() => pick(t)}><span className="sw" style={{ background: STYLE[t].fill ?? 'transparent', borderColor: STYLE[t].stroke, borderRadius: GEOM[t] === 'point' ? '50%' : 3, height: GEOM[t] === 'line' ? 4 : 14 }} />{short(t)}</button>)}</div>)}
    </div>
    <div className="canvas-wrap" ref={wrapRef}>
      {three ? <Iso3D project={p} /> :
        <svg ref={svgRef} className="plan" role="application" aria-label="Scaled site drawing" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onDoubleClick={() => finish()}
          style={{ cursor: tool === 'select' ? 'default' : tool === 'pan' ? 'grab' : 'crosshair' }}>
          <defs>
            <pattern id="g1" width={gpx} height={gpx} patternUnits="userSpaceOnUse" x={-view.x * view.z} y={-view.y * view.z}><path d={`M ${gpx} 0 L 0 0 0 ${gpx}`} fill="none" stroke="#e7ebe6" strokeWidth="1" /></pattern>
            <pattern id="g2" width={major} height={major} patternUnits="userSpaceOnUse" x={-view.x * view.z} y={-view.y * view.z}><path d={`M ${major} 0 L 0 0 0 ${major}`} fill="none" stroke="#cdd5cd" strokeWidth="1" /></pattern>
          </defs>
          {gridOn && gpx >= 7 && <rect width="100%" height="100%" fill="url(#g1)" />}
          {gridOn && major >= 7 && <rect width="100%" height="100%" fill="url(#g2)" />}
          {p.underlay && vis.underlay && underlayUrl && <image href={underlayUrl} x={(p.underlay.x - view.x) * view.z} y={(p.underlay.y - view.y) * view.z} width={p.underlay.w * p.underlay.mPerPx * view.z} height={p.underlay.h * p.underlay.mPerPx * view.z} opacity={p.underlay.opacity} preserveAspectRatio="none" />}
          {ordered.filter(visible).map(o => <Shape key={o.id} o={o} S={S} z={view.z} selected={o.id === s.selectedId} dims={dims || o.id === s.selectedId} />)}
          {sel && visible(sel) && !sel.locked && sel.points.map((v, i) => { const [x, y] = S(v); return <g key={i}><rect x={x - 5} y={y - 5} width="10" height="10" fill="#fff" stroke="#1d5fa8" strokeWidth="2" style={{ cursor: 'move' }} /><text x={x + 8} y={y - 8} fontSize="11" fill="#1d5fa8" fontWeight="700">{i + 1}</text></g>; })}
          {draft.length > 0 && tool !== 'select' && (() => { const g = GEOM[tool as ObjType]; const pts = g === 'area' && areaMode === 'rect' && draft.length === 2 ? rectPoints(Math.min(draft[0].x, draft[1].x), Math.min(draft[0].y, draft[1].y), Math.abs(draft[1].x - draft[0].x), Math.abs(draft[1].y - draft[0].y)) : cursor ? [...draft, cursor] : draft;
            return <g pointerEvents="none"><polyline points={(g === 'area' && areaMode === 'rect' ? [...pts, pts[0]] : pts).map(q => S(q).join(',')).join(' ')} fill="rgba(44,106,59,.12)" stroke="#2c6a3b" strokeWidth="2" strokeDasharray="6 4" />
              {draft.map((q, i) => { const [x, y] = S(q); return <circle key={i} cx={x} cy={y} r="4" fill="#2c6a3b" />; })}</g>; })()}
          {measure.length > 0 && <g pointerEvents="none">{measure.length === 2 && <line x1={S(measure[0])[0]} y1={S(measure[0])[1]} x2={S(measure[1])[0]} y2={S(measure[1])[1]} stroke="#7c3aed" strokeWidth="2" />}
            {measure.map((q, i) => <circle key={i} cx={S(q)[0]} cy={S(q)[1]} r="4" fill="#7c3aed" />)}
            {measure.length === 2 && <Label x={(S(measure[0])[0] + S(measure[1])[0]) / 2} y={(S(measure[0])[1] + S(measure[1])[1]) / 2 - 8} text={`${dist(measure[0], measure[1]).toFixed(3)} m`} color="#7c3aed" />}</g>}
          {calib && <g pointerEvents="none">{calib.pts.map((q, i) => <circle key={i} cx={S(q)[0]} cy={S(q)[1]} r="5" fill="#b3261e" />)}{calib.pts.length === 2 && <line x1={S(calib.pts[0])[0]} y1={S(calib.pts[0])[1]} x2={S(calib.pts[1])[0]} y2={S(calib.pts[1])[1]} stroke="#b3261e" strokeWidth="2" />}</g>}
          {cursor && tool !== 'select' && tool !== 'pan' && <circle cx={S(cursor)[0]} cy={S(cursor)[1]} r="3" fill="none" stroke="#17202a" pointerEvents="none" />}
        </svg>}
      <div className="canvas-bar">
        <div className="group">
          <button className="btn icon" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!s.past.length} onClick={s.undo}><Undo2 size={16} /></button>
          <button className="btn icon" aria-label="Redo" title="Redo (Ctrl+Y)" disabled={!s.future.length} onClick={s.redo}><Redo2 size={16} /></button>
        </div>
        <div className="group">
          <button className="btn icon" aria-label="Zoom to fit" title="Zoom to fit" onClick={fit}><Maximize size={16} /></button>
          <button className={`btn icon ${gridOn ? 'active' : ''}`} aria-label="Toggle grid" title="Grid" aria-pressed={gridOn} onClick={() => setGridOn(!gridOn)}><Grid3x3 size={16} /></button>
          <button className={`btn icon ${snapOn ? 'active' : ''}`} aria-label="Toggle snapping" title="Snap to grid and corners" aria-pressed={snapOn} onClick={() => setSnapOn(!snapOn)}><Magnet size={16} /></button>
          <select aria-label="Grid step" title="Grid / snap step" value={step} onChange={e => setStep(Number(e.target.value))} style={{ border: 0, width: 'auto', minHeight: 34, borderRadius: 0 }}><option value={0.01}>10 mm</option><option value={0.05}>50 mm</option><option value={0.1}>100 mm</option><option value={0.5}>0.5 m</option><option value={1}>1 m</option></select>
        </div>
        <div className="group">
          <button className={`btn sm ${dims ? 'active' : ''}`} aria-pressed={dims} onClick={() => setDims(!dims)}>Dimensions</button>
          <button className={`btn sm ${three ? 'active' : ''}`} aria-pressed={three} onClick={() => setThree(!three)}><Box size={15} /> 3D</button>
        </div>
        {tool !== 'select' && tool !== 'pan' && tool !== 'measure' && tool !== 'calibrate' && GEOM[tool] === 'area' && <div className="group">
          <button className={`btn sm ${areaMode === 'rect' ? 'active' : ''}`} onClick={() => { setAreaMode('rect'); setDraft([]); }}>Rectangle</button>
          <button className={`btn sm ${areaMode === 'poly' ? 'active' : ''}`} onClick={() => { setAreaMode('poly'); setDraft([]); }}>Corners</button></div>}
        {tool !== 'select' && tool !== 'pan' && tool !== 'measure' && tool !== 'calibrate' && GEOM[tool] === 'line' && tool !== 'dimension' && <div className="group">
          <button className={`btn sm ${lineMode === 'poly' ? 'active' : ''}`} onClick={() => { setLineMode('poly'); setDraft([]); }}>Straight</button>
          <button className={`btn sm ${lineMode === 'arc' ? 'active' : ''}`} onClick={() => { setLineMode('arc'); setDraft([]); }}>Arc</button></div>}
        {draft.length > 0 && !(GEOM[tool as ObjType] === 'area' && areaMode === 'rect') && <div className="group">
          <button className="btn sm primary" style={{ borderRadius: 0 }} onClick={finish}><Check size={15} /> Finish</button><button className="btn sm" onClick={cancel}><X size={15} /> Cancel</button></div>}
      </div>
      {calib && calib.pts.length === 2 && <div className="card" style={{ position: 'absolute', left: 8, top: 56, width: 280, zIndex: 5 }}>
        <h3>Known distance between the two points</h3><Num ariaLabel="Known distance in metres" value={calib.value} allowNull min={0.05} max={1000} onChange={v => setCalib({ ...calib, value: v })} unit="m" />
        <div className="row" style={{ marginTop: 8 }}><button className="btn primary sm" disabled={!calib.value} onClick={applyCalib}>Scale image</button><button className="btn sm" onClick={() => { setCalib(null); setTool('select'); }}>Cancel</button></div></div>}
      <div className="canvas-hint" role="status">{hint}{live ? ` · ${live}` : ''}</div>
      <div className="canvas-scale mono">{cursor ? `x ${cursor.x.toFixed(2)}  y ${cursor.y.toFixed(2)} m · ` : ''}{`1 m = ${view.z.toFixed(0)} px`}</div>
    </div>
    <div className="inspector">
      {sel ? <Inspector o={sel} onDelete={removeSel} onDuplicate={duplicate} /> : <>
        <h2>Drawing</h2>
        <p className="muted" style={{ fontSize: '.84rem' }}>All geometry is in real metres. Pick a drawing tool, then draw on the plan. Select an object to edit its exact size and materials.</p>
        <h3>Layers</h3>
        {(['existing', 'proposed'] as const).map(l => <label key={l} className="row" style={{ padding: '3px 0' }}><input type="checkbox" checked={vis[l]} onChange={e => setVis({ ...vis, [l]: e.target.checked })} /> {l === 'existing' ? 'Existing site' : 'Proposed design'} <small>({p.objects.filter(o => o.layer === l).length})</small></label>)}
        {p.underlay && <>
          <label className="row" style={{ padding: '3px 0' }}><input type="checkbox" checked={vis.underlay} onChange={e => setVis({ ...vis, underlay: e.target.checked })} /> Reference image {p.underlay.calibrated ? <span className="badge ok">scaled</span> : <span className="badge danger">not scaled</span>}</label>
          <div className="row" style={{ margin: '6px 0' }}><button className="btn sm" onClick={() => { cancel(); setTool('calibrate'); setCalib({ pts: [], value: null }); }}><Crosshair size={14} /> Calibrate scale</button>
            <button className="btn sm danger" onClick={() => s.update(x => { delete x.underlay; }, { audit: 'Reference image removed from drawing' })}>Remove</button></div>
          <Field label="Opacity"><input type="range" min="0.1" max="1" step="0.05" value={p.underlay.opacity} onChange={e => s.update(x => { x.underlay!.opacity = Number(e.target.value); })} /></Field>
          <small>Aerial and satellite images are not accurate enough for construction, and map boundary lines are not a survey. Use them to sketch, then measure.</small>
        </>}
        {!p.underlay && <small>To trace over an aerial screenshot or plan: Site Capture → open the image → "Use as drawing reference".</small>}
        <h3 style={{ marginTop: 14 }}>Checks ({d.issues.length})</h3>
        {d.issues.length === 0 ? <Banner kind="ok">No geometry problems found.</Banner> : d.issues.map((i, k) => <button key={k} className={`banner ${i.severity === 'error' ? 'danger' : i.severity === 'warn' ? 'warn' : 'info'}`} style={{ width: '100%', textAlign: 'left', cursor: i.objectId ? 'pointer' : 'default', font: 'inherit', fontSize: '.8rem' }} onClick={() => i.objectId && s.select(i.objectId)}>{i.message}</button>)}
        <h3 style={{ marginTop: 14 }}>Objects</h3>
        {p.objects.length === 0 && <small>Nothing drawn yet. Start with "Site outline", then buildings and existing features, then the proposed design.</small>}
        {p.objects.map(o => <div key={o.id} className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
          <button className="btn ghost sm grow" style={{ justifyContent: 'flex-start', overflow: 'hidden' }} onClick={() => s.select(o.id)}><span className="sw" style={{ width: 10, height: 10, background: STYLE[o.type].fill ?? STYLE[o.type].stroke, border: `1px solid ${STYLE[o.type].stroke}`, flex: 'none' }} /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.name}</span></button>
          <button className="btn ghost sm icon" aria-label={`${o.hidden ? 'Show' : 'Hide'} ${o.name}`} onClick={() => s.update(x => { const k = x.objects.find(z => z.id === o.id)!; k.hidden = !k.hidden; })}>{o.hidden ? <EyeOff size={14} /> : <Eye size={14} />}</button>
        </div>)}
      </>}
    </div>
  </div>;
}

const rank = (o: SiteObject) => (o.type === 'boundary' ? 0 : GEOM[o.type] === 'area' ? (o.layer === 'existing' ? 1 : 2) : GEOM[o.type] === 'line' ? 3 : 4);

function Label({ x, y, text, color = '#17202a', size = 11 }: { x: number; y: number; text: string; color?: string; size?: number }) {
  return <text x={x} y={y} fontSize={size} textAnchor="middle" fill={color} stroke="#fff" strokeWidth="3" paintOrder="stroke" style={{ pointerEvents: 'none', fontVariantNumeric: 'tabular-nums' }}>{text}</text>;
}

function Shape({ o, S, z, selected, dims }: { o: SiteObject; S: (q: Pt) => [number, number]; z: number; selected: boolean; dims: boolean }) {
  const st = STYLE[o.type], g = GEOM[o.type];
  const P = o.points.map(S), str = P.map(q => q.join(',')).join(' ');
  const stroke = selected ? '#1d5fa8' : st.stroke, est = o.confidence !== 'verified';
  const dash = st.dash?.map(v => v * 2).join(' ');
  const edge = (i: number, j: number) => { const a = P[i], b = P[j]; if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 46) return null; const L = dist(o.points[i], o.points[j]); return <Label key={`${i}-${j}`} x={(a[0] + b[0]) / 2} y={(a[1] + b[1]) / 2 - 5} text={`${est ? '~' : ''}${L.toFixed(est ? 2 : 3)} m`} color={selected ? '#1d5fa8' : '#374151'} size={10.5} />; };
  if (g === 'area') {
    const c = S(centroid(o.points)), bb = bbox(o.points), roomW = bb.w * z, roomH = bb.h * z;
    const showName = roomW > o.name.length * 6.5 && roomH > 18, showArea = showName && roomH > 34;
    return <g opacity={o.layer === 'existing' && o.type !== 'boundary' && o.type !== 'building' ? 0.8 : 1}>
      <polygon points={str} fill={st.fill ?? 'transparent'} fillOpacity={o.type === 'boundary' ? 0 : 0.85} stroke={stroke} strokeWidth={selected ? 2.5 : Math.max(1.2, st.w * 2.4)} strokeDasharray={dash} strokeLinejoin="round" />
      {showName && o.type !== 'boundary' && <Label x={c[0]} y={c[1] - 2} text={o.name} size={11.5} />}
      {showArea && o.type !== 'boundary' && o.type !== 'building' && <Label x={c[0]} y={c[1] + 12} text={`${fmt(polygonArea(o.points), 2)} m²`} color="#5a6572" size={10.5} />}
      {dims && o.points.map((_, i) => edge(i, (i + 1) % o.points.length))}
    </g>;
  }
  if (g === 'line') {
    const mid = Math.floor((P.length - 1) / 2), a = P[mid], b = P[mid + 1] ?? a;
    return <g>
      <polyline points={str} fill="none" stroke="transparent" strokeWidth="14" />
      <polyline points={str} fill="none" stroke={stroke} strokeWidth={o.type === 'wall' ? Math.max(4, 0.12 * z) : Math.max(1.5, st.w * 3)} strokeDasharray={dash} strokeLinejoin="round" strokeLinecap={o.type === 'wall' ? 'butt' : 'round'} />
      {o.type === 'dimension' && o.points.length === 2 ? <Label x={(a[0] + b[0]) / 2} y={(a[1] + b[1]) / 2 - 6} text={`${dist(o.points[0], o.points[1]).toFixed(3)} m`} />
        : <>{polylineLength(o.points) * z > o.name.length * 9 && z > 18 && <Label x={(a[0] + b[0]) / 2} y={(a[1] + b[1]) / 2 + (dims ? 16 : -8)} text={o.type === 'wall' ? `${o.name} · ${fmt(polylineLength(o.points), 2)} m × ${o.props.exposedHeight ?? '?'} m` : o.name} size={10.5} color="#374151" />}
          {dims && o.points.slice(0, -1).map((_, i) => edge(i, i + 1))}</>}
    </g>;
  }
  const [x, y] = P[0];
  if (o.type === 'tree') { const r = Math.max(8, ((Number(o.props.spread) || 3) / 2) * z); return <g><circle cx={x} cy={y} r={r} fill={st.fill} fillOpacity=".45" stroke={stroke} strokeWidth={selected ? 2.5 : 1.5} /><circle cx={x} cy={y} r="3.5" fill={stroke} />
    {o.props.dbh && o.layer === 'existing' && <circle cx={x} cy={y} r={12 * Number(o.props.dbh) * z} fill="none" stroke="#22633a" strokeDasharray="5 4" />}{z > 30 && <Label x={x} y={y - r - 4} text={o.name} size={10.5} />}</g>; }
  if (o.type === 'level') return <g><circle cx={x} cy={y} r="12" fill="transparent" /><path d={`M ${x - 7} ${y} H ${x + 7} M ${x} ${y - 7} V ${y + 7}`} stroke={stroke} strokeWidth="2" />{z > 25 && <Label x={x + 34} y={y + 4} text={o.props.rl == null || o.props.rl === '' ? 'RL ?' : `RL ${Number(o.props.rl).toFixed(2)}${est ? ' ~' : ''}`} />}</g>;
  if (o.type === 'note') return <g><circle cx={x} cy={y} r="4" fill={stroke} /><text x={x + 8} y={y + 4} fontSize="12" fill={stroke} stroke="#fff" strokeWidth="3" paintOrder="stroke">{String(o.props.text ?? '')}</text></g>;
  return <g>{o.type === 'pit' ? <rect x={x - 8} y={y - 8} width="16" height="16" fill={st.fill} stroke={stroke} strokeWidth="2" /> : <circle cx={x} cy={y} r={o.type === 'plant' ? 9 : 7} fill={st.fill} stroke={stroke} strokeWidth="2" />}
    {z > 24 && <Label x={x} y={y - 12} text={o.type === 'plant' ? `${o.props.qty ?? 1} × ${o.name}` : o.name} size={10} color="#374151" />}</g>;
}

const GROUP_FOR: Partial<Record<ObjType, string>> = { paving: 'paving', steps: 'paving', turf: 'turf', garden: 'soil', deck: 'deck-board', gravel: 'gravel', edging: 'edging', light: 'light', pit: 'pit', plant: 'plant', tree: 'tree' };

function Inspector({ o, onDelete, onDuplicate }: { o: SiteObject; onDelete: () => void; onDuplicate: () => void }) {
  const s = useStore(), d = useDerived()!, p = s.project!;
  const set = (fn: (o: SiteObject) => void, audit?: string) => s.update(x => { const k = x.objects.find(z => z.id === o.id); if (k) fn(k); }, { undo: true, audit });
  const prop = (k: string, v: any) => set(x => { x.props[k] = v; }, `${o.name}: ${k} set to ${v ?? 'unknown'}`);
  const g = GEOM[o.type], r = g === 'area' ? asRectangle(o.points) : null;
  const group = o.type === 'wall' ? WALL_SYSTEMS[(o.props.system as WallSystem) ?? 'concrete-sleeper'].group : o.type === 'drain' ? (o.props.kind === 'stormwater' ? 'pipe-sw' : o.props.kind === 'channel' ? 'channel' : 'agpipe-100') : GROUP_FOR[o.type];
  const mats = group ? s.materials.filter(m => m.group === group) : [];
  const lines = d.lines.filter(l => l.objectId === o.id);
  const cost = objectDirectCost(p, o.id, d.lines, s.materials);
  const L = g === 'line' ? polylineLength(o.points) : 0;
  const dis = !!o.locked;
  const N = (label: string, k: string, o2: { unit?: string; min?: number; max?: number; nullable?: boolean; hint?: string; placeholder?: string } = {}) => <Field label={label} hint={o2.hint}><Num value={o.props[k] === '' ? null : o.props[k]} allowNull={o2.nullable} placeholder={o2.placeholder} min={o2.min ?? 0} max={o2.max} unit={o2.unit} onChange={v => prop(k, v)} /></Field>;
  return <div data-testid="inspector">
    <div className="row between"><h2 style={{ margin: 0 }}>{TYPE_LABEL[o.type]}</h2><button className="btn ghost icon" aria-label="Close properties" onClick={() => s.select(null)}><X size={16} /></button></div>
    <div className="row" style={{ margin: '8px 0' }}>
      <button className="btn sm icon" title="Duplicate (Ctrl+D)" aria-label="Duplicate" onClick={onDuplicate}><Copy size={15} /></button>
      <button className="btn sm icon" title="Rotate 15° anticlockwise" aria-label="Rotate anticlockwise" disabled={dis || g === 'point'} onClick={() => set(x => { x.points = rotate(x.points, -15); }, `Rotated ${o.name}`)}><RotateCcw size={15} /></button>
      <button className="btn sm icon" title="Rotate 15° clockwise" aria-label="Rotate clockwise" disabled={dis || g === 'point'} onClick={() => set(x => { x.points = rotate(x.points, 15); }, `Rotated ${o.name}`)}><RotateCw size={15} /></button>
      <button className="btn sm" disabled={dis || g === 'point'} onClick={() => set(x => { x.points = rotate(x.points, 90); }, `Rotated ${o.name} 90°`)}>90°</button>
      <button className={`btn sm icon ${o.locked ? 'active' : ''}`} title={o.locked ? 'Unlock' : 'Lock'} aria-label={o.locked ? 'Unlock object' : 'Lock object'} onClick={() => s.update(x => { const k = x.objects.find(z => z.id === o.id)!; k.locked = !k.locked; }, { undo: true })}>{o.locked ? <Lock size={15} /> : <Unlock size={15} />}</button>
      <button className="btn sm icon danger" title="Delete" aria-label="Delete object" disabled={dis} onClick={onDelete}><Trash2 size={15} /></button>
    </div>
    {o.locked && <Banner kind="info">Locked. Unlock to move, resize or delete.</Banner>}
    <div className="grid">
      <Field label="Name"><Text value={o.name} onChange={v => set(x => { x.name = v || TYPE_LABEL[o.type]; })} /></Field>
      <div className="grid g2">
        <Field label="Layer"><Select value={o.layer} onChange={v => set(x => { x.layer = v; }, `${o.name}: moved to ${v} layer`)} options={[['existing', 'Existing'], ['proposed', 'Proposed']]} /></Field>
        <Field label="Geometry confidence"><Select value={o.confidence} onChange={v => set(x => { x.confidence = v; }, `${o.name}: geometry marked ${v}`)} options={[['estimated', 'Estimated'], ['verified', 'Verified on site'], ['unknown', 'Unknown']]} /></Field>
      </div>
      {o.type === 'boundary' && <Banner kind="warn">Reference line only. It is not a legal boundary unless taken from a registered survey.</Banner>}

      {g !== 'point' && <h3>Size</h3>}
      {r && <div className="grid g2">
        <Field label="Side 1 to 2"><Num ariaLabel="Width in metres" value={Math.round(r.w * 1000) / 1000} min={0.01} max={500} unit="m" onChange={v => v && !dis && set(x => { x.points = resizeRectangle(x.points, v, r.h); x.confidence = 'estimated'; }, `${o.name}: width set to ${v} m`)} /></Field>
        <Field label="Side 2 to 3"><Num ariaLabel="Depth in metres" value={Math.round(r.h * 1000) / 1000} min={0.01} max={500} unit="m" onChange={v => v && !dis && set(x => { x.points = resizeRectangle(x.points, r.w, v); x.confidence = 'estimated'; }, `${o.name}: depth set to ${v} m`)} /></Field>
      </div>}
      {g === 'line' && <Field label={o.points.length > 2 ? 'Total length (moves the last point)' : 'Length'}><Num ariaLabel="Length in metres" value={Math.round(L * 1000) / 1000} min={0.01} max={1000} unit="m" onChange={v => v && !dis && set(x => { x.points = setPolylineLength(x.points, v); x.confidence = 'estimated'; }, `${o.name}: length set to ${v} m`)} /></Field>}
      {g === 'area' && <div className="row"><span className="badge info">Area {fmt(polygonArea(o.points), 3)} m²</span><span className="badge">Perimeter {fmt(polylineLength(o.points, true), 3)} m</span><ConfBadge c={o.confidence} /></div>}
      {g !== 'point' && <details className="explain"><summary>Corner coordinates ({o.points.length})</summary>
        {o.points.map((q, i) => <div key={i} className="row" style={{ gap: 4, flexWrap: 'nowrap', marginTop: 4 }}><small style={{ width: 14 }}>{i + 1}</small>
          <Num ariaLabel={`Corner ${i + 1} x`} value={Math.round(q.x * 1000) / 1000} min={-1000} max={1000} onChange={v => v != null && !dis && set(x => { x.points[i].x = v; })} />
          <Num ariaLabel={`Corner ${i + 1} y`} value={Math.round(q.y * 1000) / 1000} min={-1000} max={1000} onChange={v => v != null && !dis && set(x => { x.points[i].y = v; })} />
          <button className="btn sm ghost icon" aria-label={`Remove corner ${i + 1}`} disabled={dis || o.points.length <= (g === 'area' ? 3 : 2)} onClick={() => set(x => { x.points.splice(i, 1); })}><Trash2 size={13} /></button></div>)}
        <button className="btn sm" style={{ marginTop: 6 }} disabled={dis} onClick={() => set(x => { let bi = 0, bl = -1; const n = x.points.length, lim = g === 'area' ? n : n - 1; for (let i = 0; i < lim; i++) { const l = dist(x.points[i], x.points[(i + 1) % n]); if (l > bl) { bl = l; bi = i; } } const a = x.points[bi], b = x.points[(bi + 1) % n]; x.points.splice(bi + 1, 0, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }); })}><Plus size={13} /> Add corner on longest side</button>
      </details>}

      {o.layer === 'proposed' && (mats.length > 0 || o.type === 'wall') && <h3>Material</h3>}
      {o.type === 'wall' && <Field label="Wall system"><Select value={(o.props.system as WallSystem) ?? 'concrete-sleeper'} onChange={v => set(x => { x.props.system = v; x.materialId = WALL_SYSTEMS[v].defaultMaterial; }, `${o.name}: wall system changed to ${WALL_SYSTEMS[v].label}`)} options={(Object.keys(WALL_SYSTEMS) as WallSystem[]).map(k => [k, WALL_SYSTEMS[k].label] as const)} /></Field>}
      {o.type === 'drain' && <Field label="Drain type"><Select value={o.props.kind ?? 'agpipe'} onChange={v => set(x => { x.props.kind = v; x.materialId = defaultMaterial('drain', x.props); }, `${o.name}: drain type ${v}`)} options={[['agpipe', 'Subsoil ag pipe'], ['stormwater', 'Stormwater pipe'], ['channel', 'Channel / trench drain']]} /></Field>}
      {mats.length > 0 && <Field label="Product" hint={(() => { const m = s.materials.find(x => x.id === o.materialId); return m ? `${m.price == null ? 'No price: quote required' : `${money(m.price)} per ${UNIT_LABEL[m.unit]} ${m.gstInclusive ? 'inc' : 'ex'} GST · ${m.priceStatus}`}` : 'Select a product'; })()}>
        <select aria-label="Product" value={o.materialId ?? ''} onChange={e => set(x => { x.materialId = e.target.value; }, `${o.name}: material changed to ${s.materials.find(m => m.id === e.target.value)?.name}`)}>
          {!mats.some(m => m.id === o.materialId) && <option value={o.materialId ?? ''}>{s.materials.find(m => m.id === o.materialId)?.name ?? 'Select…'}</option>}
          {mats.map(m => <option key={m.id} value={m.id}>{m.name}{m.price == null ? ' (unpriced)' : ` · ${money(m.price)}/${UNIT_LABEL[m.unit]}`}</option>)}</select></Field>}

      {o.type === 'wall' && <>
        <h3>Wall</h3>
        <div className="grid g2">{N('Exposed face height', 'exposedHeight', { unit: 'm', min: 0.05, max: 6 })}{N('Retained height', 'retainedHeight', { unit: 'm', min: 0, max: 6, hint: 'Ground-level difference' })}
          {N('Ground level in front', 'levelFront', { unit: 'RL m', nullable: true, min: -500, max: 9000 })}{N('Ground level behind', 'levelBack', { unit: 'RL m', nullable: true, min: -500, max: 9000 })}</div>
        <Field label="Load behind the wall" hint="Anything other than level ground triggers engineering review"><Select value={o.props.surcharge ?? 'unknown'} onChange={v => prop('surcharge', v)} options={[['unknown', 'Not recorded'], ['none', 'None: level ground, no loads'], ['slope', 'Sloping ground behind'], ['fence', 'Fence on or behind wall'], ['driveway', 'Driveway / vehicles'], ['structure', 'Building or structure nearby']]} /></Field>
        <div className="grid g2">{N('Distance to boundary', 'distToBoundary', { unit: 'm', nullable: true })}{N('Drainage zone width', 'drainWidth', { unit: 'm', min: 0.1, max: 2 })}{N('Ag pipe outlet allowance', 'outletAllowance', { unit: 'm', max: 100 })}</div>
        <Field label="Soil / ground conditions"><Text value={o.props.soil ?? ''} onChange={v => prop('soil', v)} placeholder="e.g. clay, fill, rock, wet" /></Field>
        {o.props.system === 'concrete-sleeper' && <><Banner kind="warn">Post size, embedment and footing dimensions are not designed by this app. Enter them only from an engineer's design or the manufacturer's table.</Banner>
          <div className="grid g2">{N('Footing hole diameter', 'footingDia', { unit: 'm', nullable: true, min: 0.1, max: 2 })}{N('Footing hole depth', 'footingDepth', { unit: 'm', nullable: true, min: 0.1, max: 6 })}</div>
          <Field label="Post product"><select value={o.props.postMaterialId ?? 'post-h-tbc'} onChange={e => prop('postMaterialId', e.target.value)}>{s.materials.filter(m => m.group === 'wall-post' || m.group === 'wall-post-end').map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field></>}
        {o.props.system === 'segmental-block' && <label className="row"><input type="checkbox" checked={!!o.props.capping} onChange={e => prop('capping', e.target.checked)} /> Include capping units</label>}
        <Field label="Engineer design reference"><Text value={o.props.engineerRef ?? ''} onChange={v => prop('engineerRef', v)} placeholder="Drawing or report number, if any" /></Field>
      </>}
      {o.type === 'paving' && <><h3>Paving</h3>
        <Field label="Laying pattern" hint={`Default cutting waste ${PATTERN_WASTE[o.props.pattern] ?? 5}%`}><Select value={o.props.pattern ?? 'stretcher'} onChange={v => prop('pattern', v)} options={[['stack', 'Stack bond'], ['stretcher', 'Stretcher bond'], ['herringbone', 'Herringbone'], ['diagonal', '45° diagonal'], ['random', 'Random / French']]} /></Field>
        <div className="grid g2">{N('Base course depth', 'baseDepth', { unit: 'mm', max: 600 })}{N('Bedding depth', 'beddingDepth', { unit: 'mm', max: 100 })}{N('Waste override', 'wastePct', { unit: '%', nullable: true, max: 50, placeholder: 'default' })}{N('Edge restraint share', 'edgePct', { unit: '%', max: 100 })}
          {N('Fall', 'fallPct', { unit: '%', nullable: true, max: 20 })}{N('Cut / fill', 'cutFill', { unit: 'm', nullable: true, max: 5 })}{N('Jointing sand coverage', 'jointCoverage', { unit: 'm²/bag', nullable: true, min: 0.1, hint: 'From product datasheet' })}</div>
        <Field label="Falls towards"><Text value={o.props.fallTo ?? ''} onChange={v => prop('fallTo', v)} placeholder="e.g. lawn, channel drain, pit" /></Field></>}
      {o.type === 'garden' && <><h3>Garden bed</h3><div className="grid g2">{N('Soil depth', 'soilDepth', { unit: 'mm', max: 1500 })}{N('Mulch depth', 'mulchDepth', { unit: 'mm', max: 300 })}</div>
        <Field label="Planting"><select value={o.props.plantId ?? ''} onChange={e => prop('plantId', e.target.value)}><option value="">No planting counted</option>{s.materials.filter(m => m.group === 'plant').map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
        {o.props.plantId && <>{N('Plant spacing', 'plantSpacing', { unit: 'm centres', nullable: true, min: 0.1, max: 10 })}<small>{s.materials.find(m => m.id === o.props.plantId)?.note}</small></>}</>}
      {o.type === 'turf' && N('Underlay depth', 'underlayDepth', { unit: 'mm', max: 500 })}
      {o.type === 'gravel' && N('Gravel depth', 'depth', { unit: 'mm', max: 500 })}
      {o.type === 'deck' && <><h3>Deck</h3><Banner kind="warn">Framing quantities are allowances. Enter spacings only from AS 1684 span tables, the board manufacturer or an engineer.</Banner>
        <div className="grid g2">{N('Floor height above ground', 'height', { unit: 'm', nullable: true, max: 10 })}{N('Distance to boundary', 'distToBoundary', { unit: 'm', nullable: true })}{N('Joist spacing', 'joistSpacing', { unit: 'm', nullable: true, min: 0.2, max: 1.2 })}{N('Bearer spacing', 'bearerSpacing', { unit: 'm', nullable: true, min: 0.5, max: 4 })}{N('Board gap', 'gap', { unit: 'mm', max: 20 })}</div></>}
      {o.type === 'drain' && <><div className="grid g2">{N('Trench width', 'trenchWidth', { unit: 'm', max: 3 })}{N('Trench depth', 'trenchDepth', { unit: 'm', max: 5 })}</div>
        <Field label="Discharges to" hint="Concept only. Connection rights are not verified."><Text value={o.props.dischargeTo ?? ''} onChange={v => prop('dischargeTo', v)} /></Field></>}
      {o.type === 'tree' && <><div className="grid g2">{N('Trunk diameter at 1.4 m', 'dbh', { unit: 'm', nullable: true, min: 0.01, max: 5 })}{N('Canopy spread', 'spread', { unit: 'm', min: 0.5, max: 40 })}</div>
        <Field label="Species"><Text value={o.props.species ?? ''} onChange={v => prop('species', v)} /></Field><label className="row"><input type="checkbox" checked={!!o.props.retain} onChange={e => prop('retain', e.target.checked)} /> Retain and protect</label></>}
      {o.type === 'plant' && N('Quantity', 'qty', { min: 1, max: 5000 })}
      {o.type === 'level' && <>{N('Reduced level', 'rl', { unit: 'RL m', nullable: true, min: -500, max: 9000 })}<small>Levels are estimates unless taken with a level and marked verified.</small></>}
      {o.type === 'note' && <Field label="Text"><Text value={o.props.text ?? ''} onChange={v => prop('text', v)} /></Field>}
      {o.type === 'fence' && N('Height', 'height', { unit: 'm', nullable: true, max: 5 })}
      {o.type === 'feature' && <Field label="Note"><Text value={o.props.note ?? ''} onChange={v => prop('note', v)} placeholder='e.g. "To be demolished"' /></Field>}

      {lines.length > 0 && <>
        <h3>Quantities from this object</h3>
        <div>{lines.map(l => <div className="qty-mini" key={l.key} title={`${l.formula}\n${l.assumptions.join('\n')}`}><span>{l.component}{l.warning && <span className="badge danger" style={{ marginLeft: 6 }}>input needed</span>}</span>
          <b>{l.gross == null ? 'unknown' : `${fmt(l.gross)} ${UNIT_LABEL[l.unit]}`}{l.purchaseQty != null && l.purchaseUnit !== l.unit ? ` → ${fmt(l.purchaseQty)} ${UNIT_LABEL[l.purchaseUnit!]}` : ''}</b></div>)}</div>
        <div className="qty-mini"><span><b>Direct cost of this object</b><br /><small>materials + labour, ex GST{cost.incomplete ? ' · unpriced items excluded' : ''}</small></span><b>{money(cost.cost, 0)}</b></div>
        <button className="btn sm" onClick={() => s.go('estimate')}>Open full estimate</button>
      </>}
    </div>
  </div>;
}
