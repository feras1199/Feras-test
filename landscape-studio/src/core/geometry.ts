import type { Pt } from './types.ts';

export const EPS = 1e-9;

export const dist = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);

export function polylineLength(pts: Pt[], closed = false): number {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += dist(pts[i - 1], pts[i]);
  if (closed && pts.length > 2) s += dist(pts[pts.length - 1], pts[0]);
  return s;
}

/** Signed area by the shoelace formula (m2). Positive when points run clockwise in screen (y-down) space. */
export function signedArea(pts: Pt[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

export const polygonArea = (pts: Pt[]) => (pts.length < 3 ? 0 : Math.abs(signedArea(pts)));

export function centroid(pts: Pt[]): Pt {
  if (pts.length === 0) return { x: 0, y: 0 };
  const a = signedArea(pts);
  if (pts.length < 3 || Math.abs(a) < EPS) {
    const n = pts.length;
    return { x: pts.reduce((s, p) => s + p.x, 0) / n, y: pts.reduce((s, p) => s + p.y, 0) / n };
  }
  let cx = 0, cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    const f = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * f; cy += (p.y + q.y) * f;
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

export function bbox(pts: Pt[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
  if (!pts.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0, w: 0, h: 0 };
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

const orient = (a: Pt, b: Pt, c: Pt) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

/** Proper intersection of segments ab and cd (shared endpoints do not count). */
export function segmentsCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
  return o1 * o2 < -EPS && o3 * o4 < -EPS;
}

export function selfIntersects(pts: Pt[], closed = true): boolean {
  const n = pts.length;
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    for (let j = i + 1; j < segs; j++) {
      if (closed && i === 0 && j === segs - 1) continue; // adjacent via wrap
      if (j === i + 1) continue;
      if (segmentsCross(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return true;
    }
  }
  return false;
}

export function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Sutherland–Hodgman clip of subject by a convex clip polygon; used for overlap area of simple shapes. */
function clipConvex(subject: Pt[], clip: Pt[]): Pt[] {
  let out = subject;
  const sign = signedArea(clip) >= 0 ? 1 : -1;
  for (let i = 0; i < clip.length && out.length; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length];
    const input = out; out = [];
    const inside = (p: Pt) => sign * orient(a, b, p) >= -EPS;
    for (let j = 0; j < input.length; j++) {
      const p = input[j], q = input[(j + 1) % input.length];
      const pin = inside(p), qin = inside(q);
      if (pin) out.push(p);
      if (pin !== qin) {
        const d1 = orient(a, b, p), d2 = orient(a, b, q);
        const t = d1 / (d1 - d2);
        out.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
      }
    }
  }
  return out;
}

export function isConvex(pts: Pt[]): boolean {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const o = orient(pts[i], pts[(i + 1) % pts.length], pts[(i + 2) % pts.length]);
    if (Math.abs(o) < EPS) continue;
    if (s === 0) s = Math.sign(o); else if (Math.sign(o) !== s) return false;
  }
  return true;
}

/** Overlap area of two polygons. Exact when at least one is convex; otherwise null (reported as 'possible overlap'). */
export function overlapArea(a: Pt[], b: Pt[]): number | null {
  if (isConvex(b)) return polygonArea(clipConvex(a, b));
  if (isConvex(a)) return polygonArea(clipConvex(b, a));
  return null;
}

export function distPointToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 < EPS) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return dist(p, { x: a.x + t * dx, y: a.y + t * dy });
}

export function distPointToPolyline(p: Pt, pts: Pt[], closed: boolean): number {
  let d = Infinity;
  const n = pts.length;
  for (let i = 0; i < (closed ? n : n - 1); i++) d = Math.min(d, distPointToSegment(p, pts[i], pts[(i + 1) % n]));
  return n === 1 ? dist(p, pts[0]) : d;
}

export const rectPoints = (x: number, y: number, w: number, h: number): Pt[] => [
  { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h },
];

/** Is this 4-point polygon an axis-aligned-or-rotated rectangle? Returns side lengths if so. */
export function asRectangle(pts: Pt[]): { w: number; h: number; angle: number } | null {
  if (pts.length !== 4) return null;
  const e = [0, 1, 2, 3].map(i => ({ x: pts[(i + 1) % 4].x - pts[i].x, y: pts[(i + 1) % 4].y - pts[i].y }));
  for (let i = 0; i < 4; i++) {
    const a = e[i], b = e[(i + 1) % 4];
    const la = Math.hypot(a.x, a.y), lb = Math.hypot(b.x, b.y);
    if (la < 1e-6 || lb < 1e-6) return null;
    if (Math.abs(a.x * b.x + a.y * b.y) / (la * lb) > 1e-3) return null;
  }
  return { w: Math.hypot(e[0].x, e[0].y), h: Math.hypot(e[1].x, e[1].y), angle: Math.atan2(e[0].y, e[0].x) };
}

/** Resize a rectangle keeping its first corner and orientation fixed. */
export function resizeRectangle(pts: Pt[], w: number, h: number): Pt[] {
  const r = asRectangle(pts);
  if (!r) return pts;
  const ux = Math.cos(r.angle), uy = Math.sin(r.angle);
  const s = Math.sign(orient(pts[0], pts[1], pts[2])) || 1;
  const vx = -uy * s, vy = ux * s;
  const p0 = pts[0];
  return [p0, { x: p0.x + ux * w, y: p0.y + uy * w }, { x: p0.x + ux * w + vx * h, y: p0.y + uy * w + vy * h }, { x: p0.x + vx * h, y: p0.y + vy * h }];
}

/** Set the total length of a polyline by moving its last point along the last segment direction. */
export function setPolylineLength(pts: Pt[], target: number): Pt[] {
  if (pts.length < 2) return pts;
  const head = pts.slice(0, -1);
  const before = polylineLength(head);
  const a = pts[pts.length - 2], b = pts[pts.length - 1];
  const segLen = dist(a, b);
  const need = target - before;
  if (need <= 0 || segLen < EPS) return pts;
  const k = need / segLen;
  return [...head, { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k }];
}

export const translate = (pts: Pt[], dx: number, dy: number): Pt[] => pts.map(p => ({ x: p.x + dx, y: p.y + dy }));

export function rotate(pts: Pt[], deg: number, about?: Pt): Pt[] {
  const c = about ?? centroid(pts);
  const r = (deg * Math.PI) / 180, cs = Math.cos(r), sn = Math.sin(r);
  return pts.map(p => ({ x: c.x + (p.x - c.x) * cs - (p.y - c.y) * sn, y: c.y + (p.x - c.x) * sn + (p.y - c.y) * cs }));
}

export function scalePts(pts: Pt[], k: number, about?: Pt): Pt[] {
  const c = about ?? centroid(pts);
  return pts.map(p => ({ x: c.x + (p.x - c.x) * k, y: c.y + (p.y - c.y) * k }));
}

/** Tessellate a circular arc through three points into a polyline. */
export function arcThrough(a: Pt, m: Pt, b: Pt, segs = 16): Pt[] {
  const d = 2 * (a.x * (m.y - b.y) + m.x * (b.y - a.y) + b.x * (a.y - m.y));
  if (Math.abs(d) < 1e-9) return [a, b];
  const ux = ((a.x ** 2 + a.y ** 2) * (m.y - b.y) + (m.x ** 2 + m.y ** 2) * (b.y - a.y) + (b.x ** 2 + b.y ** 2) * (a.y - m.y)) / d;
  const uy = ((a.x ** 2 + a.y ** 2) * (b.x - m.x) + (m.x ** 2 + m.y ** 2) * (a.x - b.x) + (b.x ** 2 + b.y ** 2) * (m.x - a.x)) / d;
  const r = Math.hypot(a.x - ux, a.y - uy);
  let a0 = Math.atan2(a.y - uy, a.x - ux), am = Math.atan2(m.y - uy, m.x - ux), a1 = Math.atan2(b.y - uy, b.x - ux);
  const norm = (t: number) => ((t % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const ccwSpan = norm(a1 - a0), midCcw = norm(am - a0);
  const span = midCcw <= ccwSpan ? ccwSpan : ccwSpan - 2 * Math.PI;
  const out: Pt[] = [];
  for (let i = 0; i <= segs; i++) { const t = a0 + (span * i) / segs; out.push({ x: ux + r * Math.cos(t), y: uy + r * Math.sin(t) }); }
  return out;
}

export const round = (v: number, dp = 3) => Math.round(v * 10 ** dp) / 10 ** dp;

export const snap = (v: number, step: number) => (step > 0 ? Math.round(v / step) * step : v);
