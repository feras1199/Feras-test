import { jsPDF } from 'jspdf';
import type { Prim, Sheet } from './sheets.ts';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function sheetToSvg(sheet: Sheet): string {
  const out: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" width="${sheet.w}mm" height="${sheet.h}mm" viewBox="0 0 ${sheet.w} ${sheet.h}" font-family="Helvetica, Arial, sans-serif">`, `<rect width="${sheet.w}" height="${sheet.h}" fill="#ffffff"/>`];
  for (const p of sheet.prims) {
    const dash = 'dash' in p && p.dash ? ` stroke-dasharray="${p.dash.join(' ')}"` : '';
    if (p.t === 'line') out.push(`<line x1="${r(p.x1)}" y1="${r(p.y1)}" x2="${r(p.x2)}" y2="${r(p.y2)}" stroke="${p.c}" stroke-width="${p.w}"${dash}/>`);
    else if (p.t === 'poly') out.push(`<${p.closed ? 'polygon' : 'polyline'} points="${p.pts.map(q => `${r(q[0])},${r(q[1])}`).join(' ')}" fill="${p.fill ?? 'none'}" stroke="${p.c}" stroke-width="${p.w}" stroke-linejoin="round"${dash}/>`);
    else if (p.t === 'image') out.push(`<image href="${p.data}" x="${r(p.x)}" y="${r(p.y)}" width="${r(p.w)}" height="${r(p.h)}" preserveAspectRatio="xMidYMid meet"/>`);
    else if (p.t === 'circle') out.push(`<circle cx="${r(p.x)}" cy="${r(p.y)}" r="${r(p.r)}" fill="${p.fill ?? 'none'}" stroke="${p.c}" stroke-width="${p.w}"/>`);
    else out.push(`<text x="${r(p.x)}" y="${r(p.y)}" font-size="${p.size * 1.38}" text-anchor="${p.a ?? 'start'}" fill="${p.c ?? '#111827'}"${p.bold ? ' font-weight="bold"' : ''}>${esc(p.s)}</text>`);
  }
  out.push('</svg>');
  return out.join('\n');
}

const r = (v: number) => Math.round(v * 100) / 100;
const rgb = (hex: string): [number, number, number] => { const h = hex.replace('#', ''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; };

// jsPDF's standard fonts are WinAnsi only: map the few non-Latin-1 symbols we use.
const pdfSafe = (s: string) => s.replace(/⌈/g, 'ceil(').replace(/⌉/g, ')').replace(/[≤]/g, '<=').replace(/[≥]/g, '>=').replace(/→/g, '->').replace(/π/g, 'pi').replace(/…/g, '...').replace(/[^\x00-\xff•]/g, '?');

function drawPrim(doc: jsPDF, p: Prim) {
  if (p.t === 'image') { try { doc.addImage(p.data, 'JPEG', p.x, p.y, p.w, p.h); } catch { /* unreadable image: skip, label still printed */ } return; }
  if (p.t === 'text') {
    doc.setFont('helvetica', p.bold ? 'bold' : 'normal');
    doc.setFontSize((p.size * 1.38) / 0.3528);
    doc.setTextColor(...rgb(p.c ?? '#111827'));
    doc.text(pdfSafe(p.s), p.x, p.y, { align: p.a === 'middle' ? 'center' : p.a === 'end' ? 'right' : 'left' });
    return;
  }
  doc.setDrawColor(...rgb(p.c));
  doc.setLineWidth(p.w);
  doc.setLineDashPattern('dash' in p && p.dash ? p.dash : [], 0);
  if (p.t === 'line') doc.line(p.x1, p.y1, p.x2, p.y2);
  else if (p.t === 'circle') { if (p.fill) doc.setFillColor(...rgb(p.fill)); doc.circle(p.x, p.y, p.r, p.fill ? 'FD' : 'S'); }
  else {
    if (p.pts.length < 2) return;
    if (p.fill) doc.setFillColor(...rgb(p.fill));
    const rel = p.pts.slice(1).map((q, i) => [q[0] - p.pts[i][0], q[1] - p.pts[i][1]]);
    doc.lines(rel, p.pts[0][0], p.pts[0][1], [1, 1], p.fill ? 'FD' : 'S', p.closed);
  }
}

export function sheetsToPdf(sheets: Sheet[], title: string): jsPDF {
  const first = sheets[0];
  const doc = new jsPDF({ unit: 'mm', format: [first.w, first.h], orientation: 'landscape', compress: true });
  doc.setProperties({ title, creator: 'Landscape Intelligence Studio' });
  sheets.forEach((s, i) => {
    if (i > 0) doc.addPage([s.w, s.h], 'landscape');
    for (const p of s.prims) drawPrim(doc, p);
  });
  return doc;
}
