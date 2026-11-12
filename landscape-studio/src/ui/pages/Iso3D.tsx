import { useState } from 'react';
import { RotateCw } from 'lucide-react';
import { GEOM, type Project, type Pt, type SiteObject } from '../../core/types.ts';
import { bbox, centroid } from '../../core/geometry.ts';
import { STYLE } from '../../core/style.ts';

// Basic massing view generated from the same geometry as the plan. Heights of buildings and fences
// are display assumptions; terrain is not modelled because levels are not surveyed.
const HEIGHT = (o: SiteObject): number => o.type === 'building' ? 2.7 : o.type === 'wall' ? Number(o.props.exposedHeight) || 0.4 : o.type === 'fence' ? Number(o.props.height) || 1.8 : o.type === 'deck' ? Number(o.props.height) || 0.3 : o.type === 'steps' ? 0.3 : 0;

export function Iso3D({ project }: { project: Project }) {
  const [turn, setTurn] = useState(0);
  const objs = project.objects.filter(o => !o.hidden && !['dimension', 'note', 'level', 'cable', 'line'].includes(o.type));
  const all = objs.flatMap(o => o.points);
  if (!all.length) return <div style={{ display: 'grid', placeItems: 'center', height: '100%' }} className="muted">Nothing to show yet. Draw the site first.</div>;
  const b = bbox(all), c = { x: b.minX + b.w / 2, y: b.minY + b.h / 2 };
  const rot = (q: Pt): Pt => { let x = q.x - c.x, y = q.y - c.y; for (let i = 0; i < turn; i++) [x, y] = [-y, x]; return { x, y }; };
  const k = 560 / Math.max(b.w + b.h, 4);
  const pr = (q: Pt, z = 0): [number, number] => { const r = rot(q); return [(r.x - r.y) * 0.866 * k, (r.x + r.y) * 0.5 * k - z * k]; };
  const depth = (q: Pt) => { const r = rot(q); return r.x + r.y; };
  type Face = { d: number; el: React.ReactNode };
  const faces: Face[] = [];
  const poly = (pts: [number, number][], fill: string, stroke: string, key: string, op = 1) => <polygon key={key} points={pts.map(q => q.join(',')).join(' ')} fill={fill} stroke={stroke} strokeWidth="1" strokeLinejoin="round" opacity={op} />;
  const shade = (hex: string, f: number) => { const n = parseInt(hex.slice(1), 16); const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v * f))); return `rgb(${ch(n >> 16)},${ch((n >> 8) & 255)},${ch(n & 255)})`; };
  for (const o of objs) {
    const st = STYLE[o.type], g = GEOM[o.type], h = HEIGHT(o);
    if (g === 'area') {
      const base = o.type === 'boundary' ? -9999 : depth(centroid(o.points)) - 1000 + (h > 0 ? 1000 : 0);
      if (o.type === 'boundary') { faces.push({ d: -99999, el: poly(o.points.map(q => pr(q)), '#f1f3ee', st.stroke, o.id) }); continue; }
      if (h > 0) for (let i = 0; i < o.points.length; i++) { const a = o.points[i], bb = o.points[(i + 1) % o.points.length]; faces.push({ d: (depth(a) + depth(bb)) / 2, el: poly([pr(a), pr(bb), pr(bb, h), pr(a, h)], shade(st.fill ?? '#cccccc', i % 2 ? 0.82 : 0.92), st.stroke, `${o.id}s${i}`) }); }
      faces.push({ d: h > 0 ? Math.max(...o.points.map(depth)) + 0.01 : base, el: poly(o.points.map(q => pr(q, h)), st.fill ?? '#dddddd', st.stroke, `${o.id}t`) });
    } else if (g === 'line') {
      const t = o.type === 'wall' ? 0.1 : 0.03;
      for (let i = 0; i < o.points.length - 1; i++) { const a = o.points[i], bb = o.points[i + 1];
        if (h > 0) faces.push({ d: (depth(a) + depth(bb)) / 2 + t, el: poly([pr(a), pr(bb), pr(bb, h), pr(a, h)], o.type === 'wall' ? '#8a929c' : '#c9ced4', '#374151', `${o.id}w${i}`, o.type === 'fence' ? 0.75 : 1) });
        else faces.push({ d: (depth(a) + depth(bb)) / 2 - 500, el: <line key={`${o.id}l${i}`} x1={pr(a)[0]} y1={pr(a)[1]} x2={pr(bb)[0]} y2={pr(bb)[1]} stroke={st.stroke} strokeWidth="2" strokeDasharray={st.dash?.join(' ')} /> }); }
    } else {
      const q = o.points[0], [x, y] = pr(q);
      if (o.type === 'tree') { const [tx, ty] = pr(q, 3), r = ((Number(o.props.spread) || 3) / 2) * k * 0.8; faces.push({ d: depth(q), el: <g key={o.id}><line x1={x} y1={y} x2={tx} y2={ty} stroke="#6b4a2b" strokeWidth="4" /><ellipse cx={tx} cy={ty - r * 0.3} rx={r} ry={r * 0.8} fill="#7fb77a" stroke="#22633a" opacity=".9" /></g> }); }
      else if (o.type === 'light') { const [tx, ty] = pr(q, 0.4); faces.push({ d: depth(q), el: <g key={o.id}><line x1={x} y1={y} x2={tx} y2={ty} stroke="#374151" strokeWidth="2" /><circle cx={tx} cy={ty} r="4" fill="#fde68a" stroke="#b45309" /></g> }); }
      else faces.push({ d: depth(q), el: <circle key={o.id} cx={x} cy={y} r="4" fill={st.fill ?? st.stroke} stroke={st.stroke} /> });
    }
  }
  faces.sort((a, z) => a.d - z.d);
  return <div style={{ height: '100%', position: 'relative' }}>
    <svg viewBox="-420 -330 840 620" style={{ width: '100%', height: '100%' }} role="img" aria-label="3D massing view of the site">{faces.map(f => f.el)}</svg>
    <div style={{ position: 'absolute', right: 8, top: 56 }}><button className="btn sm" onClick={() => setTurn((turn + 1) % 4)}><RotateCw size={14} /> Rotate view</button></div>
    <div className="canvas-hint">Massing view from the plan geometry. Building and fence heights are display assumptions; ground levels are not modelled. Illustrative only.</div>
  </div>;
}
