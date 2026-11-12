import type { Material, Project, Pt, SiteObject } from './types.ts';
import { GEOM } from './types.ts';
import { bbox, centroid } from './geometry.ts';
import { STYLE } from './style.ts';

// Conceptual isometric massing built from the plan geometry. Shared by the on-screen 3D view
// and the drawing pack. Heights for buildings and fences are display assumptions; levels and
// terrain are NOT modelled, so the ground is drawn flat.

export const MASSING_LABEL = 'Conceptual 3D massing - not structural design. Ground drawn flat; levels not modelled.';

export type IsoPrim =
  | { t: 'poly'; pts: [number, number][]; fill: string; stroke: string; opacity?: number }
  | { t: 'line'; a: [number, number]; b: [number, number]; stroke: string; w: number; dash?: number[] }
  | { t: 'circle'; c: [number, number]; r: number; fill: string; stroke: string };

const HEIGHT = (o: SiteObject): number => o.type === 'building' ? 2.7 : o.type === 'wall' ? Number(o.props.exposedHeight) || 0.4 : o.type === 'fence' ? Number(o.props.height) || 1.8 : o.type === 'deck' ? Number(o.props.height) || 0.3 : o.type === 'steps' ? 0.3 : o.type === 'garden' ? 0.15 : 0;

/** Display colour from the selected material, so a material change shows in 3D. */
export function materialColour(o: SiteObject, materials: Material[]): string {
  const m = materials.find(x => x.id === o.materialId);
  const t = `${m?.name ?? ''} ${m?.colour ?? ''}`.toLowerCase();
  if (/charcoal|graphite/.test(t)) return '#5b6168';
  if (/sandstone/.test(t)) return '#d9b77a';
  if (/travertine/.test(t)) return '#e6d5b8';
  if (/porcelain/.test(t)) return '#c9c6c0';
  if (/versawall|block|concrete/.test(t)) return '#a7a39b';
  if (/merbau|timber|pine/.test(t)) return '#9a6a43';
  return STYLE[o.type].fill ?? '#cccccc';
}

const shade = (hex: string, f: number) => { const n = parseInt(hex.slice(1), 16); const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v * f))); return `#${[ch(n >> 16), ch((n >> 8) & 255), ch(n & 255)].map(v => v.toString(16).padStart(2, '0')).join('')}`; };

/** Returns primitives in an abstract unit space plus their bounds. turn = quarter rotations. */
export function isoScene(project: Project, materials: Material[], turn = 0): { prims: IsoPrim[]; bounds: { minX: number; minY: number; maxX: number; maxY: number } } | null {
  const objs = project.objects.filter(o => !o.hidden && !['dimension', 'note', 'level', 'cable', 'line'].includes(o.type));
  const all = objs.flatMap(o => o.points);
  if (!all.length) return null;
  const b = bbox(all), c = { x: b.minX + b.w / 2, y: b.minY + b.h / 2 };
  const rot = (q: Pt): Pt => { let x = q.x - c.x, y = q.y - c.y; for (let i = 0; i < turn; i++) [x, y] = [-y, x]; return { x, y }; };
  const pr = (q: Pt, z = 0): [number, number] => { const r = rot(q); return [(r.x - r.y) * 0.866, (r.x + r.y) * 0.5 - z]; };
  const depth = (q: Pt) => { const r = rot(q); return r.x + r.y; };
  const faces: { d: number; p: IsoPrim }[] = [];
  for (const o of objs) {
    const st = STYLE[o.type], g = GEOM[o.type], h = HEIGHT(o);
    const col = o.layer === 'proposed' ? materialColour(o, materials) : st.fill ?? '#dddddd';
    if (g === 'area') {
      if (o.type === 'boundary') { faces.push({ d: -1e9, p: { t: 'poly', pts: o.points.map(q => pr(q)), fill: '#eef1ea', stroke: st.stroke } }); continue; }
      const base = h > 0 ? 0 : -1e6;
      if (h > 0) for (let i = 0; i < o.points.length; i++) { const a = o.points[i], bb = o.points[(i + 1) % o.points.length]; faces.push({ d: (depth(a) + depth(bb)) / 2, p: { t: 'poly', pts: [pr(a), pr(bb), pr(bb, h), pr(a, h)], fill: shade(col, i % 2 ? 0.8 : 0.9), stroke: st.stroke } }); }
      faces.push({ d: h > 0 ? Math.max(...o.points.map(depth)) + 0.01 : base + depth(centroid(o.points)), p: { t: 'poly', pts: o.points.map(q => pr(q, h)), fill: col, stroke: st.stroke } });
    } else if (g === 'line') {
      for (let i = 0; i < o.points.length - 1; i++) {
        const a = o.points[i], bb = o.points[i + 1];
        if (h > 0) faces.push({ d: (depth(a) + depth(bb)) / 2 + 0.1, p: { t: 'poly', pts: [pr(a), pr(bb), pr(bb, h), pr(a, h)], fill: o.type === 'wall' ? col : '#c9ced4', stroke: '#374151', opacity: o.type === 'fence' ? 0.75 : 1 } });
        else faces.push({ d: -5e5, p: { t: 'line', a: pr(a), b: pr(bb), stroke: st.stroke, w: 1.5, dash: st.dash } });
      }
    } else {
      const q = o.points[0];
      if (o.type === 'tree') { const top = pr(q, 3), r = ((Number(o.props.spread) || 3) / 2) * 0.8; faces.push({ d: depth(q), p: { t: 'line', a: pr(q), b: top, stroke: '#6b4a2b', w: 3 } }); faces.push({ d: depth(q) + 0.01, p: { t: 'circle', c: [top[0], top[1] - r * 0.3], r, fill: '#7fb77a', stroke: '#22633a' } }); }
      else if (o.type === 'light') { const top = pr(q, 0.4); faces.push({ d: depth(q), p: { t: 'line', a: pr(q), b: top, stroke: '#374151', w: 1.5 } }); faces.push({ d: depth(q) + 0.01, p: { t: 'circle', c: top, r: 0.12, fill: '#fde68a', stroke: '#b45309' } }); }
      else faces.push({ d: depth(q), p: { t: 'circle', c: pr(q), r: 0.12, fill: st.fill ?? st.stroke, stroke: st.stroke } });
    }
  }
  faces.sort((a, z) => a.d - z.d);
  const xs: number[] = [], ys: number[] = [];
  for (const { p } of faces) { const pts = p.t === 'poly' ? p.pts : p.t === 'line' ? [p.a, p.b] : [[p.c[0] - p.r, p.c[1] - p.r], [p.c[0] + p.r, p.c[1] + p.r]] as [number, number][]; for (const [x, y] of pts) { xs.push(x); ys.push(y); } }
  return { prims: faces.map(f => f.p), bounds: { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) } };
}
