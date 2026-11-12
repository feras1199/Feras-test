import type { Material, Project, SiteObject } from './types.ts';
import { GEOM } from './types.ts';
import { asRectangle, dist, overlapArea, pointInPolygon, polygonArea, polylineLength, selfIntersects } from './geometry.ts';
import { takeoff } from './assemblies.ts';
import { objectDirectCost } from './estimate.ts';

export interface Issue { severity: 'error' | 'warn' | 'info'; kind: string; objectId?: string; message: string }

const TOL_VERIFIED = 0.01; // 10 mm between a verified measurement and the drawing
const SURFACES = ['paving', 'garden', 'turf', 'deck', 'gravel'];

export function validateProject(project: Project): Issue[] {
  const out: Issue[] = [];
  const objs = project.objects;
  for (const o of objs) {
    const g = GEOM[o.type];
    if (o.points.some(p => !isFinite(p.x) || !isFinite(p.y))) { out.push({ severity: 'error', kind: 'invalid', objectId: o.id, message: `${o.name}: has a non-numeric coordinate.` }); continue; }
    if (g === 'area') {
      if (o.points.length < 3) out.push({ severity: 'error', kind: 'open', objectId: o.id, message: `${o.name}: needs at least 3 points to form a closed shape.` });
      else {
        if (selfIntersects(o.points, true)) out.push({ severity: 'error', kind: 'self-intersection', objectId: o.id, message: `${o.name}: outline crosses itself, so its area is not reliable.` });
        if (polygonArea(o.points) < 0.01) out.push({ severity: 'error', kind: 'zero-area', objectId: o.id, message: `${o.name}: area is effectively zero.` });
        const r = o.points.length === 4 ? null : undefined;
        if (r === null && !asRectangle(o.points)) {
          // 4 points but not square: report the worst corner if it is close to 90 degrees
          for (let i = 0; i < 4; i++) {
            const a = o.points[(i + 3) % 4], b = o.points[i], c = o.points[(i + 1) % 4];
            const ang = Math.abs((Math.atan2(a.y - b.y, a.x - b.x) - Math.atan2(c.y - b.y, c.x - b.x)) * 180 / Math.PI) % 180;
            const dev = Math.abs(90 - ang);
            if (dev > 0.2 && dev < 5) { out.push({ severity: 'info', kind: 'square', objectId: o.id, message: `${o.name}: corner ${i + 1} is ${ang.toFixed(1)}°, not square. Check with a diagonal measurement.` }); break; }
          }
        }
      }
    } else if (g === 'line') {
      if (o.points.length < 2 || polylineLength(o.points) < 0.01) out.push({ severity: 'error', kind: 'zero-length', objectId: o.id, message: `${o.name}: has no length.` });
    }
    const big = o.points.some(p => Math.abs(p.x) > 500 || Math.abs(p.y) > 500);
    if (big) out.push({ severity: 'warn', kind: 'units', objectId: o.id, message: `${o.name}: coordinates exceed 500 m. Check that millimetres were not entered as metres.` });
    if (o.type === 'wall') {
      const h = o.props.exposedHeight, rh = o.props.retainedHeight;
      if (h != null && h !== '' && (Number(h) <= 0 || Number(h) > 6)) out.push({ severity: 'error', kind: 'invalid', objectId: o.id, message: `${o.name}: exposed height ${h} m is not valid.` });
      const lf = o.props.levelFront, lb = o.props.levelBack;
      if (lf != null && lf !== '' && lb != null && lb !== '' && rh != null && rh !== '' && Math.abs(Number(lb) - Number(lf) - Number(rh)) > 0.05)
        out.push({ severity: 'error', kind: 'level-conflict', objectId: o.id, message: `${o.name}: ground levels differ by ${(Number(lb) - Number(lf)).toFixed(2)} m but retained height is ${Number(rh).toFixed(2)} m. Resolve on site; nothing was auto-corrected.` });
    }
  }
  // Overlaps between proposed surfaces
  const surf = objs.filter(o => o.layer === 'proposed' && SURFACES.includes(o.type) && o.points.length >= 3);
  for (let i = 0; i < surf.length; i++) for (let j = i + 1; j < surf.length; j++) {
    const a = overlapArea(surf[i].points, surf[j].points);
    if (a == null) { if (surf[i].points.some(p => pointInPolygon(p, surf[j].points)) || surf[j].points.some(p => pointInPolygon(p, surf[i].points))) out.push({ severity: 'warn', kind: 'overlap', objectId: surf[i].id, message: `${surf[i].name} and ${surf[j].name} may overlap. Quantities would be double-counted.` }); }
    else if (a > 0.01) out.push({ severity: 'warn', kind: 'overlap', objectId: surf[i].id, message: `${surf[i].name} and ${surf[j].name} overlap by ${a.toFixed(2)} m². Quantities are double-counted in the overlap.` });
  }
  // Outside the boundary
  const b = objs.find(o => o.type === 'boundary' && o.points.length >= 3);
  if (b) for (const o of objs) {
    if (o.layer !== 'proposed' || o.id === b.id) continue;
    if (o.points.some(p => !pointInPolygon(p, b.points) && distToRing(p, b.points) > 0.01)) out.push({ severity: 'warn', kind: 'outside-boundary', objectId: o.id, message: `${o.name}: extends outside the drawn site boundary reference.` });
  }
  // Measurements vs drawing
  for (const m of project.measurements) {
    if (m.value == null || !m.link) continue;
    const o = objs.find(x => x.id === m.link!.objectId);
    if (!o) continue;
    let drawn: number | null = null;
    if ('prop' in m.link) { const v = o.props[m.link.prop]; drawn = v == null || v === '' ? null : Number(v); }
    else if (o.points[m.link.a] && o.points[m.link.b]) drawn = dist(o.points[m.link.a], o.points[m.link.b]);
    if (drawn == null) continue;
    const diff = Math.abs(drawn - m.value);
    if (m.confidence === 'verified' && diff > TOL_VERIFIED)
      out.push({ severity: 'error', kind: 'measurement-conflict', objectId: o.id, message: `${m.label}: verified measurement is ${m.value.toFixed(3)} m but the drawing shows ${drawn.toFixed(3)} m (difference ${(diff * 1000).toFixed(0)} mm). The drawing was not changed automatically.` });
    else if (m.confidence === 'estimated' && diff > Math.max(0.3, m.value * 0.1))
      out.push({ severity: 'info', kind: 'measurement-diff', objectId: o.id, message: `${m.label}: estimate ~${m.value.toFixed(1)} m differs from the drawing (${drawn.toFixed(2)} m).` });
  }
  // Diagonal consistency for rectangles with verified sides and diagonal
  for (const o of objs) {
    if (o.points.length !== 4 || GEOM[o.type] !== 'area') continue;
    const ms = project.measurements.filter(m => m.confidence === 'verified' && m.value != null && m.link && 'a' in m.link && m.link.objectId === o.id);
    const get = (a: number, b: number) => ms.find(m => { const l = m.link as { a: number; b: number }; return (l.a === a && l.b === b) || (l.a === b && l.b === a); })?.value ?? null;
    const s1 = get(0, 1), s2 = get(1, 2), d = get(0, 2);
    if (s1 != null && s2 != null && d != null) {
      const exp = Math.hypot(s1, s2);
      if (Math.abs(exp - d) > 0.02) out.push({ severity: 'warn', kind: 'diagonal', objectId: o.id, message: `${o.name}: sides ${s1.toFixed(3)} × ${s2.toFixed(3)} m give a square diagonal of ${exp.toFixed(3)} m, but the measured diagonal is ${d.toFixed(3)} m. The shape is out of square by about ${(Math.abs(exp - d) * 1000).toFixed(0)} mm.` });
    }
  }
  if (project.underlay && !project.underlay.calibrated) out.push({ severity: 'warn', kind: 'scale', message: 'Reference image is not calibrated. Use Calibrate with a known distance before tracing.' });
  if (!objs.length) out.push({ severity: 'info', kind: 'empty', message: 'The drawing is empty. Add the site boundary reference, then existing and proposed features.' });
  return out;
}

function distToRing(p: { x: number; y: number }, ring: { x: number; y: number }[]) {
  let d = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
    d = Math.min(d, Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy));
  }
  return d;
}

export interface MeasureTask { priority: number; objectId: string; text: string; why: string; link: { objectId: string; a: number; b: number } | { objectId: string; prop: string }; label: string }

/** The smallest useful set of site measurements still needed, ordered by how much cost depends on them. */
export function guidedMeasurements(project: Project, materials: Material[], limit = 10): MeasureTask[] {
  const lines = takeoff(project, materials);
  const tasks: MeasureTask[] = [];
  const verified = (o: SiteObject, test: (l: any) => boolean) => project.measurements.some(m => m.confidence === 'verified' && m.value != null && m.link && m.link.objectId === o.id && test(m.link));
  const edge = (a: number, b: number) => (l: any) => 'a' in l && ((l.a === a && l.b === b) || (l.a === b && l.b === a));
  const prop = (p: string) => (l: any) => 'prop' in l && l.prop === p;
  const weight = (o: SiteObject) => (o.layer === 'proposed' ? objectDirectCost(project, o.id, lines, materials).cost : 0);

  for (const o of project.objects) {
    const g = GEOM[o.type];
    const w = weight(o);
    if (o.type === 'boundary') {
      for (let i = 0; i < o.points.length; i++) {
        const j = (i + 1) % o.points.length;
        if (!verified(o, edge(i, j))) tasks.push({ priority: 50 - i, objectId: o.id, label: `${o.name} side ${i + 1}`, link: { objectId: o.id, a: i, b: j }, text: `Measure side ${i + 1} of the site reference outline (corner ${i + 1} to corner ${j + 1}).`, why: 'Everything else is positioned from the site outline.' });
      }
      continue;
    }
    if (o.layer !== 'proposed') continue;
    if (o.type === 'wall') {
      for (let i = 0; i < o.points.length - 1; i++)
        if (!verified(o, edge(i, i + 1))) tasks.push({ priority: 100 + w / 50, objectId: o.id, label: `${o.name} length${o.points.length > 2 ? ` (run ${i + 1})` : ''}`, link: { objectId: o.id, a: i, b: i + 1 }, text: `Measure the length of ${o.name}${o.points.length > 2 ? ` run ${i + 1}` : ''} between its two ends.`, why: 'Wall length drives sleepers or blocks, posts, drainage and labour.' });
      if (!verified(o, prop('retainedHeight'))) tasks.push({ priority: 120 + w / 50, objectId: o.id, label: `${o.name} retained height`, link: { objectId: o.id, prop: 'retainedHeight' }, text: `Measure the ground-level difference across ${o.name} (retained height) at its highest point.`, why: 'Retained height decides the engineering and approval pathway as well as quantities.' });
      if (o.props.levelFront == null || o.props.levelBack == null) tasks.push({ priority: 60, objectId: o.id, label: `${o.name} exposed height`, link: { objectId: o.id, prop: 'exposedHeight' }, text: `Record ground levels in front of and behind ${o.name} (dumpy or laser level).`, why: 'Confirms the wall height along its length and the fall for drainage.' });
    } else if (g === 'area' && o.points.length >= 3 && ['paving', 'deck', 'turf', 'garden', 'gravel'].includes(o.type)) {
      const n = o.points.length;
      const need: [number, number][] = n === 4 ? [[0, 1], [1, 2], [0, 2]] : o.points.map((_, i) => [i, (i + 1) % n] as [number, number]);
      need.forEach(([a, b], k) => {
        if (verified(o, edge(a, b))) return;
        const diag = n === 4 && k === 2;
        tasks.push({ priority: (o.type === 'paving' || o.type === 'deck' ? 80 : 30) + w / 50 - k, objectId: o.id, label: `${o.name} ${diag ? 'diagonal' : `side ${a + 1}`}`, link: { objectId: o.id, a, b }, text: diag ? `Measure one diagonal of ${o.name} (corner 1 to corner 3).` : `Measure side ${a + 1} of ${o.name} (corner ${a + 1} to corner ${b + 1}).`, why: diag ? 'A diagonal confirms the shape is square.' : 'Area drives material, base and labour quantities.' });
      });
    }
  }
  for (const t of project.objects.filter(o => o.type === 'tree' && o.layer === 'existing' && (o.props.dbh == null || o.props.dbh === '')))
    tasks.push({ priority: 40, objectId: t.id, label: `${t.name} trunk diameter`, link: { objectId: t.id, prop: 'dbh' }, text: `Measure the trunk diameter of ${t.name} at about 1.4 m above ground.`, why: 'Needed to work out the root zone that excavation should stay out of.' });
  return tasks.sort((a, b) => b.priority - a.priority).slice(0, limit);
}
