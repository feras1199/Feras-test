import type { CompanySettings, Material, Project, Pt, QtyLine, SiteObject } from '../types.ts';
import { GEOM, TYPE_LABEL } from '../types.ts';
import { bbox, centroid, dist, polygonArea, polylineLength } from '../geometry.ts';
import { STYLE } from '../style.ts';
import { STATUS_LABEL, STATUS_STAMP } from '../project.ts';
import { purchaseSchedule, WALL_SYSTEMS, type WallSystem } from '../assemblies.ts';
import { ceilInt, fmt, UNIT_LABEL } from '../units.ts';
import { constructionSequence } from '../sequence.ts';
import type { Check } from '../compliance.ts';
import { STATUS_LABEL as CL } from '../compliance.ts';
import type { MeasureTask } from '../validation.ts';

// Drawing sheets are generated as resolution-independent primitives in paper millimetres,
// straight from the project geometry. The same primitives are rendered to PDF and SVG.

export type Prim =
  | { t: 'line'; x1: number; y1: number; x2: number; y2: number; w: number; c: string; dash?: number[] }
  | { t: 'poly'; pts: [number, number][]; closed: boolean; w: number; c: string; fill?: string; dash?: number[] }
  | { t: 'circle'; x: number; y: number; r: number; w: number; c: string; fill?: string }
  | { t: 'text'; x: number; y: number; s: string; size: number; a?: 'start' | 'middle' | 'end'; c?: string; bold?: boolean };

export interface Sheet { number: string; title: string; w: number; h: number; scale: string; prims: Prim[] }

export interface SheetInput {
  project: Project; materials: Material[]; settings: CompanySettings; lines: QtyLine[]; checks: Check[]; tasks: MeasureTask[];
  size: 'A3' | 'A4';
}

const SIZES = { A3: { w: 420, h: 297 }, A4: { w: 297, h: 210 } };
const SCALES = [10, 20, 25, 50, 75, 100, 125, 150, 200, 250, 500, 1000];
const INK = '#111827', GREY = '#6b7280', RED = '#b3261e';
const M = 8; // sheet margin
const TB = 24; // title block height

const text = (x: number, y: number, s: string, size = 2.6, a: 'start' | 'middle' | 'end' = 'start', c = INK, bold = false): Prim => ({ t: 'text', x, y, s, size, a, c, bold });
const line = (x1: number, y1: number, x2: number, y2: number, w = 0.25, c = INK, dash?: number[]): Prim => ({ t: 'line', x1, y1, x2, y2, w, c, dash });
const rect = (x: number, y: number, w: number, h: number, lw = 0.25, c = INK, fill?: string, dash?: number[]): Prim => ({ t: 'poly', pts: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], closed: true, w: lw, c, fill, dash });

/** Approximate Helvetica text width in mm; used for wrapping only. */
export const textWidth = (s: string, size: number) => s.length * size * 0.7;

export function wrap(s: string, size: number, maxW: number): string[] {
  const out: string[] = [];
  for (const para of String(s).split('\n')) {
    let cur = '';
    const maxChars = Math.max(4, Math.floor(maxW / (size * 0.7)));
    const words = para.split(/\s+/).flatMap(w => (w.length > maxChars ? w.match(new RegExp(`.{1,${maxChars}}`, 'g')) ?? [w] : [w]));
    for (const word of words) {
      const tryS = cur ? cur + ' ' + word : word;
      if (textWidth(tryS, size) <= maxW || !cur) cur = tryS; else { out.push(cur); cur = word; }
    }
    out.push(cur);
  }
  return out;
}

export const lenLabel = (m: number, verified: boolean) => (verified ? `${m.toFixed(2)}` : `~${m.toFixed(1)}`);

function frame(inp: SheetInput, number: string, title: string, scale: string): { sheet: Sheet; area: { x: number; y: number; w: number; h: number } } {
  const { w, h } = SIZES[inp.size];
  const p = inp.project, s = inp.settings;
  const prims: Prim[] = [];
  prims.push(rect(M, M, w - 2 * M, h - 2 * M, 0.5));
  const ty = h - M - TB;
  prims.push(line(M, ty, w - M, ty, 0.5));
  const small = inp.size === 'A4';
  const colW = (w - 2 * M) / (small ? 4 : 5);
  const cols = [M, M + colW * (small ? 1.3 : 1.5), M + colW * (small ? 2.5 : 3), M + colW * (small ? 3.3 : 4)];
  for (const cx of cols.slice(1)) prims.push(line(cx, ty, cx, h - M, 0.25));
  const fs = small ? 2.1 : 2.4, lh = fs * 1.55;
  const put = (col: number, rows: [string, string][]) => rows.forEach(([k, v], i) => {
    const keyW = k ? fs * 9.6 : 0;
    const maxW = (cols[col + 1] ?? w - M) - cols[col] - 4 - keyW;
    let val = v; while (textWidth(val, fs) > maxW && val.length > 4) val = val.slice(0, -2);
    if (val !== v) val += '…';
    if (k) prims.push(text(cols[col] + 2, ty + 4.5 + i * lh, k, fs, 'start', GREY));
    prims.push(text(cols[col] + 2 + keyW, ty + 4.5 + i * lh, val, fs, 'start', INK, i === 0));
  });
  put(0, [['', s.company || s.appName], ['Project: ', p.name], ['Site: ', [p.site.address, p.site.suburb].filter(Boolean).join(', ') || 'not recorded'], ['Customer: ', p.customer.name || 'not recorded'], ['Project ID: ', p.id]]);
  put(1, [['', title], ['Drawing no: ', number], ['Revision: ', String(p.versions.length)], ['Date: ', new Date().toISOString().slice(0, 10)], ['Scale: ', `${scale} @ ${inp.size}`]]);
  const eng = p.approvals.filter(a => a.kind === 'engineering');
  const meas = p.approvals.find(a => a.kind === 'measurements');
  put(2, [['', `Status: ${STATUS_LABEL[p.status]}`], ['Measurements: ', meas ? `signed off by ${meas.reviewer} ${meas.date}` : 'not signed off'], ['Engineering: ', eng.length ? eng.map(a => `${a.reviewer} (${a.reference})`).join('; ') : 'no approval recorded'], ['Units: ', 'metres unless shown as mm'], ['', 'Check all dimensions on site.']]);
  const stampCol = cols[3];
  const issued = p.status === 'issued';
  const stampLines = wrap(STATUS_STAMP[p.status].replace(' - ', '\n'), small ? 2.6 : 3.2, (w - M - stampCol - 4));
  stampLines.forEach((l, i) => prims.push(text((stampCol + w - M) / 2, ty + 7 + i * (small ? 4 : 4.8), l, small ? 2.6 : 3.2, 'middle', issued ? '#166534' : RED, true)));
  prims.push(text((stampCol + w - M) / 2, h - M - 5.5, 'Preliminary. Not a survey, engineering', 1.9, 'middle', GREY));
  prims.push(text((stampCol + w - M) / 2, h - M - 2.6, 'certificate or planning approval.', 1.9, 'middle', GREY));
  if (p.synthetic) prims.push(text(w / 2, M + 4.5, 'SYNTHETIC DEMONSTRATION DATA - NOT A REAL SITE', 2.6, 'middle', RED, true));
  return { sheet: { number, title, w, h, scale, prims }, area: { x: M + 4, y: M + (p.synthetic ? 8 : 4), w: w - 2 * M - 8, h: h - 2 * M - TB - (p.synthetic ? 12 : 8) } };
}

interface Xf { k: number; ox: number; oy: number; scale: number }
const tx = (f: Xf, p: Pt): [number, number] => [f.ox + p.x * f.k, f.oy + p.y * f.k];

function fit(objs: SiteObject[], area: { x: number; y: number; w: number; h: number }, pad = 12): Xf {
  const pts = objs.flatMap(o => o.points);
  const b = pts.length ? bbox(pts) : { minX: 0, minY: 0, w: 10, h: 10, maxX: 10, maxY: 10 };
  const scale = SCALES.find(s => (b.w * 1000) / s <= area.w - 2 * pad && (b.h * 1000) / s <= area.h - 2 * pad) ?? 1000;
  const k = 1000 / scale;
  return { k, scale, ox: area.x + (area.w - b.w * k) / 2 - b.minX * k, oy: area.y + (area.h - b.h * k) / 2 - b.minY * k };
}

function dimension(prims: Prim[], a: [number, number], b: [number, number], label: string, away: [number, number], off = 5) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
  if (L < 6) return;
  let nx = -dy / L, ny = dx / L;
  const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  if ((mid[0] + nx - away[0]) ** 2 + (mid[1] + ny - away[1]) ** 2 < (mid[0] - nx - away[0]) ** 2 + (mid[1] - ny - away[1]) ** 2) { nx = -nx; ny = -ny; }
  const a2: [number, number] = [a[0] + nx * off, a[1] + ny * off], b2: [number, number] = [b[0] + nx * off, b[1] + ny * off];
  prims.push(line(a[0] + nx, a[1] + ny, a2[0] + nx * 1.2, a2[1] + ny * 1.2, 0.15, GREY));
  prims.push(line(b[0] + nx, b[1] + ny, b2[0] + nx * 1.2, b2[1] + ny * 1.2, 0.15, GREY));
  prims.push(line(a2[0], a2[1], b2[0], b2[1], 0.18, INK));
  const ux = dx / L, uy = dy / L;
  for (const p of [a2, b2]) prims.push(line(p[0] - (ux + nx) * 0.9, p[1] - (uy + ny) * 0.9, p[0] + (ux + nx) * 0.9, p[1] + (uy + ny) * 0.9, 0.3, INK));
  const horizontal = Math.abs(dy) < Math.abs(dx);
  const tp: [number, number] = [(a2[0] + b2[0]) / 2 + nx * (horizontal ? 2.6 : 2.2), (a2[1] + b2[1]) / 2 + ny * 2.6 + 0.8];
  prims.push(text(tp[0], tp[1], label, 2.2, horizontal ? 'middle' : nx > 0 ? 'start' : 'end'));
}

function ring(prims: Prim[], cx: number, cy: number, r: number, clip: { x: number; y: number; w: number; h: number } | undefined, w: number, c: string, dash?: number[]) {
  let run: [number, number][] = [];
  const flush = () => { if (run.length > 1) prims.push({ t: 'poly', pts: run, closed: false, w, c, dash }); run = []; };
  for (let i = 0; i <= 96; i++) {
    const a = (i / 96) * 2 * Math.PI, x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
    if (!clip || (x >= clip.x && x <= clip.x + clip.w && y >= clip.y && y <= clip.y + clip.h)) run.push([x, y]); else flush();
  }
  flush();
}

function drawObject(prims: Prim[], o: SiteObject, f: Xf, opt: { ghost?: boolean; label?: boolean; dims?: boolean; project: Project; clip?: { x: number; y: number; w: number; h: number } }) {
  const st = STYLE[o.type], g = GEOM[o.type];
  const c = opt.ghost ? '#9ca3af' : st.stroke;
  const P = o.points.map(p => tx(f, p));
  const verifiedEdge = (a: number, b: number) => o.confidence === 'verified' || opt.project.measurements.some(m => m.confidence === 'verified' && m.link && 'a' in m.link && m.link.objectId === o.id && ((m.link.a === a && m.link.b === b) || (m.link.a === b && m.link.b === a)));
  if (g === 'area') {
    prims.push({ t: 'poly', pts: P, closed: true, w: opt.ghost ? 0.2 : st.w, c, fill: opt.ghost ? undefined : st.fill, dash: st.dash });
    const cen = tx(f, centroid(o.points));
    if (opt.label) {
      prims.push(text(cen[0], cen[1] - 0.5, o.name, 2.3, 'middle', opt.ghost ? GREY : INK, !opt.ghost));
      if (o.type !== 'boundary' && o.type !== 'building') prims.push(text(cen[0], cen[1] + 3, `${fmt(polygonArea(o.points), 1)} m²`, 2.1, 'middle', GREY));
    }
    if (opt.dims) for (let i = 0; i < P.length; i++) { const j = (i + 1) % P.length; dimension(prims, P[i], P[j], lenLabel(dist(o.points[i], o.points[j]), verifiedEdge(i, j)), cen, 5); }
  } else if (g === 'line') {
    prims.push({ t: 'poly', pts: P, closed: false, w: opt.ghost ? 0.25 : st.w, c, dash: st.dash });
    const mid = P[Math.floor((P.length - 1) / 2)], nxt = P[Math.floor((P.length - 1) / 2) + 1] ?? mid;
    const lp: [number, number] = [(mid[0] + nxt[0]) / 2, (mid[1] + nxt[1]) / 2];
    if (opt.label && o.type !== 'dimension') prims.push(text(lp[0], lp[1] - (o.type === 'wall' ? 3.2 : 2), o.type === 'wall' ? `${o.name} (${fmt(polylineLength(o.points), 2)} m × ${o.props.exposedHeight ?? '?'} m high)` : o.name, 2.1, 'middle', opt.ghost ? GREY : INK));
    if (o.type === 'dimension' && P.length >= 2) dimension(prims, P[0], P[1], lenLabel(dist(o.points[0], o.points[1]), false), [P[0][0], P[0][1] + 1000], 0.01);
    if (opt.dims && o.type !== 'dimension') for (let i = 0; i < P.length - 1; i++) dimension(prims, P[i], P[i + 1], lenLabel(dist(o.points[i], o.points[i + 1]), verifiedEdge(i, i + 1)), [P[i][0], P[i][1] - 1000], 5);
  } else {
    const [x, y] = P[0];
    if (o.type === 'tree') {
      const r = Math.max(2, ((Number(o.props.spread) || 3) / 2) * f.k);
      ring(prims, x, y, r, opt.clip, 0.35, c);
      prims.push({ t: 'circle', x, y, r: 0.7, w: 0.3, c, fill: c });
      if (o.props.dbh && o.layer === 'existing') {
        const rz = 12 * Number(o.props.dbh);
        ring(prims, x, y, rz * f.k, opt.clip, 0.2, '#22633a', [2, 1.5]);
        prims.push(text(x, y + 4, `Root zone r = ${rz.toFixed(1)} m`, 1.9, 'middle', '#22633a'));
      }
    } else if (o.type === 'level') {
      prims.push(line(x - 1.5, y, x + 1.5, y, 0.3)); prims.push(line(x, y - 1.5, x, y + 1.5, 0.3));
      prims.push(text(x + 2.2, y + 0.8, o.props.rl == null || o.props.rl === '' ? 'RL ?' : `RL ${Number(o.props.rl).toFixed(2)}${o.confidence === 'verified' ? '' : ' (est.)'}`, 2.1));
    } else if (o.type === 'note') {
      prims.push(text(x, y, String(o.props.text ?? ''), 2.3));
    } else {
      const r = o.type === 'pit' ? 1.6 : 1.2;
      if (o.type === 'pit') prims.push(rect(x - r, y - r, 2 * r, 2 * r, 0.4, c, st.fill)); else prims.push({ t: 'circle', x, y, r, w: 0.3, c, fill: st.fill });
      if (o.type === 'plant') prims.push(text(x + 2, y + 0.8, `${o.props.qty ?? 1} × ${o.name}`, 2));
    }
    if (opt.label && ['tree', 'pit'].includes(o.type)) prims.push(text(x + 3, y - 2, o.name, 2.1, 'start', GREY));
  }
}

function scaleBar(prims: Prim[], x: number, y: number, f: Xf) {
  const unit = [50, 20, 10, 5, 2, 1, 0.5, 0.2, 0.1].find(u => 4 * u * f.k <= 85) ?? 0.1;
  const seg = unit * f.k;
  for (let i = 0; i < 4; i++) prims.push(rect(x + i * seg, y, seg, 1.5, 0.2, INK, i % 2 ? '#ffffff' : INK));
  for (let i = 0; i <= 4; i++) prims.push(text(x + i * seg, y + 4.6, `${fmt(i * unit, 1)}`, 2, 'middle'));
  prims.push(text(x + 4 * seg + 4, y + 4.6, 'm', 2));
  prims.push(text(x, y - 1.8, `Scale 1:${f.scale} when printed at 100% (no "fit to page")`, 2, 'start', GREY));
}

function legend(prims: Prim[], x: number, y: number, objs: SiteObject[]) {
  const types = [...new Set(objs.map(o => o.type))].filter(t => t !== 'note' && t !== 'dimension');
  prims.push(text(x, y, 'LEGEND', 2.3, 'start', INK, true));
  types.forEach((t, i) => {
    const st = STYLE[t], yy = y + 4 + i * 4.2;
    if (GEOM[t] === 'area') prims.push(rect(x, yy - 2.2, 7, 2.8, st.w, st.stroke, st.fill, st.dash));
    else if (GEOM[t] === 'line') prims.push(line(x, yy - 0.8, x + 7, yy - 0.8, st.w, st.stroke, st.dash));
    else prims.push({ t: 'circle', x: x + 3.5, y: yy - 0.8, r: 1.2, w: 0.3, c: st.stroke, fill: st.fill });
    prims.push(text(x + 9, yy, st.label, 2.1));
  });
  return y + 4 + types.length * 4.2;
}

function planSheet(inp: SheetInput, number: string, title: string, mode: 'existing' | 'proposed' | 'setout'): Sheet {
  const objs = inp.project.objects.filter(o => !o.hidden);
  const all = mode === 'existing' ? objs.filter(o => o.layer === 'existing') : objs;
  const pre = frame(inp, number, title, '');
  const legendW = inp.size === 'A3' ? 62 : 50;
  const area = { ...pre.area, w: pre.area.w - legendW, h: pre.area.h - 12 };
  const f = fit(all.length ? all : objs, area, mode === 'setout' ? 20 : 12);
  const { sheet } = frame(inp, number, title, `1:${f.scale}`);
  const prims = sheet.prims;
  for (const pass of ['area', 'line', 'point'] as const) for (const o of all) {
    if (GEOM[o.type] !== pass) continue;
    const ghost = mode === 'setout' && o.layer === 'existing' && o.type !== 'boundary';
    const key = ['wall', 'paving', 'deck', 'steps'].includes(o.type);
    drawObject(prims, o, f, { project: inp.project, clip: area, ghost, label: mode !== 'setout' || (o.layer === 'proposed' && key), dims: mode === 'setout' ? o.layer === 'proposed' && key : o.type === 'boundary' });
  }
  scaleBar(prims, area.x + 2, area.y + area.h + 5, f);
  const lx = area.x + area.w + 4;
  prims.push(line(lx - 2, pre.area.y, lx - 2, pre.area.y + pre.area.h, 0.2, GREY));
  let ly = legend(prims, lx, pre.area.y + 4, all) + 3;
  const notes = mode === 'setout'
    ? ['SET-OUT NOTES', 'Dimensions in metres.', 'Plain figures: verified on site.', 'Figures with ~ : estimates. Measure before set-out.', 'Datum: corner marked D.', 'Check diagonals for square.', 'North point not recorded.']
    : ['NOTES', 'Site outline is a reference line, not a legal boundary.', 'Positions with (est.) or ~ are estimates.', 'Underground services not shown.', 'North point not recorded.', mode === 'proposed' ? 'Drainage and lighting routes are concept only.' : 'Existing conditions as recorded on site.'];
  notes.forEach((n, i) => { for (const l of wrap(n, 2, legendW - 6)) { prims.push(text(lx, ly, l, i === 0 ? 2.3 : 2, 'start', i === 0 ? INK : GREY, i === 0)); ly += 3.2; } });
  if (mode === 'setout') {
    const b = inp.project.objects.find(o => o.type === 'boundary');
    const datum = b?.points[0] ?? { x: f.ox, y: f.oy };
    if (b) { const d = tx(f, datum); prims.push({ t: 'circle', x: d[0], y: d[1], r: 1.6, w: 0.4, c: RED }); prims.push(text(d[0] - 2.5, d[1] - 2.5, 'D', 2.8, 'end', RED, true)); }
    ly += 2; prims.push(text(lx, ly, 'SET-OUT POINTS', 2.2, 'start', INK, true)); ly += 3.2; prims.push(text(lx, ly, 'metres from datum D', 1.9, 'start', GREY)); ly += 4;
    prims.push(text(lx, ly, 'Point', 1.9, 'start', GREY)); prims.push(text(lx + legendW - 22, ly, 'Across', 1.9, 'end', GREY)); prims.push(text(lx + legendW - 6, ly, 'Out', 1.9, 'end', GREY)); ly += 3.2;
    const maxY = pre.area.y + pre.area.h - 2;
    outer: for (const o of inp.project.objects.filter(o => o.layer === 'proposed' && ['wall', 'paving', 'deck', 'steps'].includes(o.type))) {
      for (let i = 0; i < o.points.length; i++) {
        if (ly > maxY) { prims.push(text(lx, ly, '… continued in BoQ CSV', 1.9, 'start', GREY)); break outer; }
        const nm = `${o.name} ${i + 1}`;
        prims.push(text(lx, ly, nm.length > 22 ? nm.slice(0, 21) + '…' : nm, 1.9));
        prims.push(text(lx + legendW - 22, ly, (o.points[i].x - datum.x).toFixed(2), 1.9, 'end'));
        prims.push(text(lx + legendW - 6, ly, (o.points[i].y - datum.y).toFixed(2), 1.9, 'end'));
        ly += 3;
        const [px, py] = tx(f, o.points[i]);
        prims.push(text(px + 1.2, py - 1.2, String(i + 1), 1.8, 'start', RED));
      }
    }
  }
  return sheet;
}

function wallSheet(inp: SheetInput, number: string, o: SiteObject, part: 'elevation' | 'section'): Sheet {
  const { project: p, materials } = inp;
  const sys: WallSystem = o.props.system ?? 'concrete-sleeper';
  const L = polylineLength(o.points), H = Number(o.props.exposedHeight) || 0, HR = Number(o.props.retainedHeight ?? H) || H;
  const m = materials.find(x => x.id === o.materialId);
  const approved = p.approvals.find(a => a.kind === 'engineering' && a.scope === o.id);
  const { sheet, area } = frame(inp, number, part === 'elevation' ? `${o.name}: elevation and site notes` : `${o.name}: concept section`, 'as shown');
  const prims = sheet.prims;
  const E: Prim[] = part === 'elevation' ? prims : [];
  // ---- Elevation
  const ex = area.x + 6, ew = area.w - 30;
  const es = SCALES.find(s => (L * 1000) / s <= ew && (H * 1000) / s <= area.h * 0.35) ?? 200;
  const k = 1000 / es;
  const ey = area.y + 16 + Math.max(H * k, 8);
  E.push(text(ex, area.y + 6, `ELEVATION  1:${es}`, 2.8, 'start', INK, true));
  E.push(line(ex - 4, ey, ex + L * k + 4, ey, 0.5));
  E.push(rect(ex, ey - H * k, L * k, H * k, 0.5, INK, '#eef0f3'));
  const ul = (m?.dims?.l ?? (sys === 'segmental-block' ? 400 : 2000)) / 1000, uh = (m?.dims?.w ?? 200) / 1000;
  const courses = H > 0 ? ceilInt(H / uh) : 0;
  if (m?.dims?.l && m.dims.w) {
    for (let c = 1; c < courses; c++) E.push(line(ex, ey - c * uh * k, ex + L * k, ey - c * uh * k, 0.15, GREY));
    const sp = sys === 'concrete-sleeper' ? ul + 0.03 : ul;
    if (sp * k > 1.2) for (let x = sp; x < L - 1e-6; x += sp) E.push(line(ex + x * k, ey - H * k, ex + x * k, ey, sys === 'concrete-sleeper' ? 0.5 : 0.12, sys === 'concrete-sleeper' ? INK : GREY));
  }
  dimension(E, [ex, ey], [ex + L * k, ey], `${lenLabel(L, o.confidence === 'verified')} m`, [ex, ey - 1000], 7);
  dimension(E, [ex + L * k, ey - H * k], [ex + L * k, ey], `${(H * 1000).toFixed(0)} mm`, [ex - 1000, ey], 6);
  let ny = ey + 18;
  const bays = sys === 'concrete-sleeper' ? ceilInt(L / (ul + 0.03)) : null;
  const facts = [
    `System: ${WALL_SYSTEMS[sys].label}`, `Material: ${m?.name ?? 'not selected'}`,
    `Length ${fmt(L, 2)} m${o.confidence === 'verified' ? '' : ' (ESTIMATE: measure before ordering)'}; exposed height ${fmt(H * 1000, 0)} mm; retained height ${fmt(HR * 1000, 0)} mm`,
    `Wall face area ${fmt(L * H, 2)} m²${courses ? `; ${courses} course${courses > 1 ? 's' : ''}` : ''}${bays ? `; ${bays} bays, ${bays + 1} posts` : ''}`,
    `Ground level in front: ${o.props.levelFront ?? 'not recorded'}; behind: ${o.props.levelBack ?? 'not recorded'}`,
    `Load behind wall: ${o.props.surcharge ?? 'unknown'}; soil: ${o.props.soil || 'not recorded'}; distance to boundary: ${o.props.distToBoundary ?? 'unknown'} m`,
  ];
  for (const fct of facts) for (const l of wrap(fct, 2.3, ew)) { E.push(text(ex, ny, l, 2.3)); ny += 3.8; }
  ny += 3;
  E.push(text(ex, ny, 'ON SITE', 2.5, 'start', INK, true)); ny += 4.2;
  for (const s of ['1. Locate services. Set out wall line and check length.', '2. Excavate. Do not undermine fences or structures.', '3. Posts / base course to the approved detail only.', '4. Fabric, ag pipe to outlet, drainage gravel as wall rises.', '5. Backfill in layers. Grade surface so water runs away from the wall.'])
    for (const l of wrap(s, 2.2, ew)) { E.push(text(ex, ny, l, 2.2)); ny += 3.6; }

  if (part === 'elevation') return sheet;
  // ---- Section
  const sx0 = area.x + 4, sw = area.w * 0.64;
  const below = 0.55, width = 0.5 + 0.3 + (Number(o.props.drainWidth) || 0.3) + 0.6;
  const ss = SCALES.find(s => (width * 1000) / s <= sw - 52 && ((HR + below + 0.25) * 1000) / s <= area.h - 34) ?? 50;
  const q = 1000 / ss;
  prims.push(text(sx0, area.y + 6, `CONCEPT SECTION  1:${ss}`, 2.8, 'start', INK, true));
  const stamp = approved ? `Engineering approval recorded: ${approved.reviewer}, ref ${approved.reference}` : 'CONCEPT ONLY - NOT FOR CONSTRUCTION';
  prims.push(text(sx0, area.y + 11, stamp, 2.4, 'start', approved ? '#166534' : RED, true));
  const gx = sx0 + 8 + 0.5 * q, gy = area.y + 20 + (HR + 0.2) * q; // wall face x, front ground y
  const X = (m_: number) => gx + m_ * q, Y = (m_: number) => gy - m_ * q;
  const t = sys === 'concrete-sleeper' ? 0.075 : sys === 'segmental-block' ? 0.215 : sys === 'sandstone-block' ? 0.3 : 0.075;
  const dw = Number(o.props.drainWidth) || 0.3;
  // ground
  prims.push(line(X(-0.5), Y(0), X(0), Y(0), 0.5));
  prims.push({ t: 'poly', pts: [[X(t + dw), Y(HR)], [X(t + dw + 0.6), Y(HR + (o.props.surcharge === 'slope' ? 0.08 : 0))]], closed: false, w: 0.5, c: INK });
  prims.push({ t: 'poly', pts: [[X(t + dw), Y(HR)], [X(t + dw), Y(0)], [X(t + dw + 0.6), Y(0)]], closed: false, w: 0.2, c: GREY, dash: [2, 1.5] });
  prims.push(text(X(t + dw + 0.06), Y(HR) + 4, 'Retained ground', 2, 'start', GREY));
  // wall units
  prims.push(rect(X(0), Y(H), t * q, H * q, 0.5, INK, '#d5d9de'));
  for (let c = 1; c < courses; c++) prims.push(line(X(0), Y(c * uh), X(t), Y(c * uh), 0.15, GREY));
  if (sys === 'segmental-block' && o.props.capping) prims.push(rect(X(-0.02), Y(H + 0.06), (t + 0.04) * q, 0.06 * q, 0.4, INK, '#c4c9d0'));
  // post + footing (sleeper system)
  if (sys === 'concrete-sleeper') {
    const fd = o.props.footingDia == null ? null : Number(o.props.footingDia), fz = o.props.footingDepth == null ? null : Number(o.props.footingDepth);
    const depth = fz ?? below - 0.05, dia = fd ?? 0.35;
    prims.push(rect(X(t / 2 - dia / 2), Y(0), dia * q, depth * q, 0.3, fd == null ? RED : INK, undefined, [2, 1]));
    prims.push(rect(X(t / 2 - 0.05), Y(H), 0.1 * q, (H + depth - 0.05) * q, 0.3, INK, undefined, [3, 1]));
    const fl = X(t / 2 + dia / 2) + 2;
    prims.push(text(fl, Y(-depth * 0.45), fd == null || fz == null ? 'Post, embedment, footing:' : `Footing ${fd * 1000} dia × ${fz * 1000} deep`, 2, 'start', fd == null ? RED : INK));
    prims.push(text(fl, Y(-depth * 0.45) + 3.4, fd == null || fz == null ? 'SIZE BY ENGINEER / MFR TABLE' : '(entered from engineer / table)', 2, 'start', fd == null ? RED : GREY, fd == null));
  }
  // drainage zone
  prims.push(rect(X(t), Y(Math.max(HR - 0.1, 0.1)), dw * q, Math.max(HR - 0.1, 0.1) * q, 0.2, '#1d5fa8', '#e3edf9'));
  for (let yy = 0.06; yy < HR - 0.12; yy += 0.09) for (let xx = t + 0.05; xx < t + dw - 0.02; xx += 0.09) prims.push({ t: 'circle', x: X(xx + ((Math.round(yy * 100) % 2) ? 0.03 : 0)), y: Y(yy), r: 0.35, w: 0.12, c: '#1d5fa8' });
  prims.push({ t: 'poly', pts: [[X(t), Y(HR - 0.1)], [X(t + dw), Y(HR - 0.1)], [X(t + dw), Y(0)], [X(t), Y(0)]], closed: false, w: 0.35, c: '#b45309', dash: [1.5, 1] });
  prims.push({ t: 'circle', x: X(t + 0.09), y: Y(0.07), r: 0.05 * q, w: 0.4, c: '#1d5fa8', fill: '#ffffff' });
  // labels with leaders
  const lab = (px: number, py: number, s: string) => { const lx = X(t + dw + 0.6) + 3; prims.push(line(px, py, lx - 1, py, 0.12, GREY)); prims.push(text(lx, py + 0.8, s, 2)); };
  lab(X(t + dw / 2), Y(HR * 0.72), 'Drainage aggregate');
  prims.push(text(X(t + dw + 0.6) + 3, Y(HR * 0.72) + 3.6, '10 to 20 mm', 2));
  lab(X(t + dw), Y(HR * 0.4), 'Geotextile filter fabric');
  lab(X(t + 0.09), Y(0.07), '100 mm ag pipe to outlet');
  prims.push(text(X(-0.5), Y(0) + 4, 'Finished', 2, 'start', GREY)); prims.push(text(X(-0.5), Y(0) + 7.2, 'ground', 2, 'start', GREY));
  prims.push(text(X(t + dw + 0.02), Y(HR) - 4.5, 'Grade surface away from wall', 2, 'start', GREY));
  dimension(prims, [X(0), Y(H)], [X(0), Y(0)], `${(H * 1000).toFixed(0)}`, [X(5), Y(0)], 6);
  dimension(prims, [X(t), Y(HR)], [X(t + dw), Y(HR)], `${(dw * 1000).toFixed(0)} min`, [X(0), Y(-5)], 9);
  const nx0 = area.x + area.w * 0.68, nw = area.w * 0.3;
  let sy = area.y + 22;
  prims.push(line(nx0 - 4, area.y, nx0 - 4, area.y + area.h, 0.2, GREY));
  prims.push(text(nx0, area.y + 16, 'READ BEFORE USING THIS DETAIL', 2.4, 'start', INK, true));
  const sn = [
    'This section shows the arrangement of components only.',
    'It contains no structural design. Post or footing sizes, embedment, reinforcement, bearing, sliding and overturning have not been checked.',
    HR > 0.8 ? 'Retained height exceeds 800 mm: engineer design required (AS 4678).' : 'Follow the wall system manufacturer installation guide for base, setback and maximum height.',
    'Drainage zone width from manufacturer guidance (300 mm minimum). Outlet location to be confirmed on site.',
  ];
  for (const n of sn) { for (const l of wrap(n, 2.2, nw)) { if (sy < area.y + area.h) prims.push(text(nx0, sy, l, 2.2, 'start', GREY)); sy += 3.6; } sy += 1.5; }
  return sheet;
}

function pavingSheet(inp: SheetInput, number: string, o: SiteObject): Sheet {
  const m = inp.materials.find(x => x.id === o.materialId);
  const { sheet, area } = frame(inp, number, `${o.name}: layout and concept section`, 'as shown');
  const prims = sheet.prims;
  const half = area.w * 0.5;
  const f = fit([o], { x: area.x, y: area.y + 8, w: half, h: area.h - 30 }, 16);
  prims.push(text(area.x + 2, area.y + 6, `LAYOUT  1:${f.scale}`, 2.8, 'start', INK, true));
  drawObject(prims, o, f, { project: inp.project, label: true, dims: true });
  scaleBar(prims, area.x + 4, area.y + area.h - 8, f);
  const sx = area.x + half + 8, sw = half - 12;
  prims.push(line(sx - 5, area.y, sx - 5, area.y + area.h, 0.2, GREY));
  prims.push(text(sx, area.y + 6, 'CONCEPT SECTION  1:5', 2.8, 'start', INK, true));
  const pt = m?.dims?.t ?? 0, bed = Number(o.props.beddingDepth) || 0, base = Number(o.props.baseDepth) || 0;
  const q = 1 / 5; let y = area.y + 22;
  const layers: [string, number, string][] = [[`Paver: ${m?.name ?? 'not selected'}`, pt, '#ead9bd'], ['Bedding sand', bed, '#f5ecd2'], ['Compacted base course (roadbase)', base, '#d9d4c7']];
  const lw = Math.min(sw * 0.45, 70);
  for (const [name, mm, fill] of layers) {
    const h = Math.max(mm * q, 1.5);
    prims.push(rect(sx, y, lw, h, 0.35, INK, fill));
    prims.push(line(sx + lw, y + h / 2, sx + lw + 5, y + h / 2, 0.12, GREY));
    for (const [i, l] of wrap(`${name}: ${mm ? mm + ' mm' : 'thickness not recorded'}`, 2.1, sw - lw - 8).entries()) prims.push(text(sx + lw + 6, y + h / 2 + 0.8 + i * 3.2, l, 2.1));
    y += h;
  }
  prims.push(rect(sx, y, lw, 8, 0.2, GREY, undefined, [2, 1.5])); prims.push(text(sx + lw / 2, y + 5, 'Compacted subgrade', 2, 'middle', GREY));
  prims.push(line(sx, area.y + 17, sx + lw, area.y + 19, 0.3, '#1d5fa8'));
  prims.push(text(sx, area.y + 14, o.props.fallPct == null || o.props.fallPct === '' ? 'FALL NOT RECORDED: set fall and direction before laying' : `Fall ${o.props.fallPct}% to ${o.props.fallTo || 'direction not recorded'}`, 2.2, 'start', o.props.fallPct == null || o.props.fallPct === '' ? RED : '#1d5fa8', true));
  y += 16;
  const A = polygonArea(o.points);
  const info = [`Area ${fmt(A, 2)} m²; perimeter ${fmt(polylineLength(o.points, true), 2)} m`, `Pattern: ${o.props.pattern}`, `Edge restraint to ${o.props.edgePct ?? 100}% of perimeter`, 'Base depth is a pedestrian allowance from supplier guidance. Driveways and soft ground need a designed pavement.', 'Slip resistance of the paver has not been verified. Ask the supplier for an AS 4586 test report.', 'Paving must fall away from buildings and drain to the existing stormwater system.'];
  for (const s of info) for (const l of wrap(s, 2.2, sw)) { prims.push(text(sx, y, l, 2.2, 'start', s.startsWith('Area') || s.startsWith('Pattern') || s.startsWith('Edge') ? INK : GREY)); y += 3.6; }
  return sheet;
}

interface Col { title: string; w: number; a?: 'start' | 'end' }

function tableSheets(inp: SheetInput, numberPrefix: string, title: string, cols: Col[], rows: string[][], foot: string[] = []): Sheet[] {
  const sheets: Sheet[] = [];
  let i = 0, page = 1;
  const fs = inp.size === 'A4' ? 2 : 2.2, lh = fs * 1.5;
  while (i < rows.length || page === 1) {
    const { sheet, area } = frame(inp, `${numberPrefix}${page > 1 ? '.' + page : ''}`, title + (page > 1 ? ` (page ${page})` : ''), 'not to scale');
    const prims = sheet.prims;
    const total = cols.reduce((a, c) => a + c.w, 0), k = area.w / total;
    let y = area.y + 5;
    let x = area.x;
    prims.push(rect(area.x, y - 4, area.w, 6, 0.25, INK, '#eef0f3'));
    for (const c of cols) { prims.push(text(c.a === 'end' ? x + c.w * k - 1.5 : x + 1.5, y, c.title, fs, c.a ?? 'start', INK, true)); x += c.w * k; }
    y += 6;
    const maxY = area.y + area.h - (foot.length ? foot.length * 3.4 + 4 : 2);
    while (i < rows.length) {
      const cells = rows[i].map((s, ci) => wrap(s, fs, cols[ci].w * k - 3));
      const rh = Math.max(...cells.map(c => c.length)) * lh + 1.6;
      if (y + rh > maxY) break;
      x = area.x;
      cells.forEach((ls, ci) => { ls.forEach((l, li) => prims.push(text(cols[ci].a === 'end' ? x + cols[ci].w * k - 1.5 : x + 1.5, y + li * lh, l, fs, cols[ci].a ?? 'start'))); x += cols[ci].w * k; });
      y += rh;
      prims.push(line(area.x, y - lh + 0.6, area.x + area.w, y - lh + 0.6, 0.1, '#d1d5db'));
      i++;
    }
    let fy = area.y + area.h - foot.length * 3.4 + 2;
    for (const l of foot) { prims.push(text(area.x, fy, l, 2, 'start', GREY)); fy += 3.4; }
    sheets.push(sheet);
    page++;
    if (i >= rows.length) break;
  }
  return sheets;
}

export function buildSheets(inp: SheetInput): Sheet[] {
  const p = inp.project;
  const sheets: Sheet[] = [];
  sheets.push(planSheet(inp, 'L-01', 'Existing site plan', 'existing'));
  sheets.push(planSheet(inp, 'L-02', 'Proposed landscape plan', 'proposed'));
  sheets.push(planSheet(inp, 'L-03', 'Dimensioned set-out plan', 'setout'));
  let n = 4;
  for (const w of p.objects.filter(o => o.type === 'wall' && o.layer === 'proposed')) { sheets.push(wallSheet(inp, `L-${String(n++).padStart(2, '0')}`, w, 'elevation')); sheets.push(wallSheet(inp, `L-${String(n++).padStart(2, '0')}`, w, 'section')); }
  for (const pv of p.objects.filter(o => o.type === 'paving' && o.layer === 'proposed')) sheets.push(pavingSheet(inp, `L-${String(n++).padStart(2, '0')}`, pv));

  const sched = purchaseSchedule(inp.lines, inp.materials);
  sheets.push(...tableSheets(inp, `L-${String(n++).padStart(2, '0')}`, 'Materials schedule (purchase quantities)',
    [{ title: 'Material', w: 40 }, { title: 'Supplier', w: 18 }, { title: 'Design qty', w: 12, a: 'end' }, { title: 'Order qty', w: 12, a: 'end' }, { title: 'Rounding / conversion', w: 30 }, { title: 'Used in', w: 30 }],
    sched.map(r => [r.material.name, r.material.supplierId, r.designQty == null ? 'unknown' : `${fmt(r.designQty)} ${UNIT_LABEL[r.designUnit]}`, r.purchaseQty == null ? 'INCOMPLETE' : `${fmt(r.purchaseQty)} ${UNIT_LABEL[r.purchaseUnit]}`, r.note || '-', [...new Set(r.from.map(s => s.split(':')[0]))].join(', ')]),
    ['Order quantities include waste allowances and pack rounding. INCOMPLETE means an input is missing: see the bill of quantities.', 'Supplier stock and prices are not confirmed by this document.']));
  sheets.push(...tableSheets(inp, `L-${String(n++).padStart(2, '0')}`, 'Bill of quantities (with formulas)',
    [{ title: 'Element', w: 20 }, { title: 'Item', w: 26 }, { title: 'Formula', w: 40 }, { title: 'Inputs', w: 40 }, { title: 'Net', w: 11, a: 'end' }, { title: 'Waste', w: 8, a: 'end' }, { title: 'Qty', w: 13, a: 'end' }],
    inp.lines.filter(l => l.kind !== 'labour').map(l => [l.objectName, l.component, l.formula, Object.entries(l.inputs).map(([k, v]) => `${k}: ${v}`).join('; '), l.net == null ? 'unknown' : fmt(l.net), `${l.wastePct}%`, l.gross == null ? 'unknown' : `${fmt(l.gross)} ${UNIT_LABEL[l.unit]}${l.overridden ? ' (manual)' : ''}`]),
    ['Quantities are calculated from the drawing geometry. "unknown" means a required dimension has not been provided.']));

  const seq = constructionSequence(p);
  const rows: string[][] = seq.map(s => [String(s.n), s.title, s.items.join('  •  '), s.hold ?? '']);
  sheets.push(...tableSheets(inp, `L-${String(n++).padStart(2, '0')}`, 'Construction sequence and hold points', [{ title: '#', w: 4 }, { title: 'Stage', w: 22 }, { title: 'What to do', w: 80 }, { title: 'HOLD POINT', w: 44 }], rows));
  const flags: string[][] = [
    ...inp.tasks.map(t => ['Measure on site', t.label, t.text, t.why]),
    ...inp.checks.filter(c => c.status === 'potential' || c.status === 'insufficient').map(c => [CL[c.status], c.title, c.result, c.humanReview]),
  ];
  sheets.push(...tableSheets(inp, `L-${String(n++).padStart(2, '0')}`, 'Measurements to check and review flags', [{ title: 'Type', w: 24 }, { title: 'Item', w: 34 }, { title: 'Finding', w: 60 }, { title: 'Who must review / why', w: 44 }], flags,
    ['Automated checks are screening aids. They are not planning approval, certification or engineering sign-off.']));
  return sheets;
}

export { TYPE_LABEL };
