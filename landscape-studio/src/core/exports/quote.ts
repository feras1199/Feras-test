import { jsPDF } from 'jspdf';
import type { CompanySettings, Material, Project, QtyLine } from '../types.ts';
import { objectDirectCost, type Estimate } from '../estimate.ts';
import { TYPE_LABEL } from '../types.ts';

export interface QuoteRow { label: string; priceEx: number }

/** Customer-facing breakdown: each element's direct cost scaled so that rows add up to the selling price. */
export function quoteRows(project: Project, e: Estimate, lines: QtyLine[], materials: Material[]): QuoteRow[] {
  const objs = project.objects.filter(o => o.layer === 'proposed');
  const direct = objs.map(o => ({ o, c: objectDirectCost(project, o.id, lines, materials).cost }));
  const sumObj = direct.reduce((a, b) => a + b.c, 0);
  const other = Math.max(0, e.direct - sumObj);
  const k = e.direct > 0 ? e.priceEx / e.direct : 0;
  const grouped = new Map<string, number>();
  for (const { o, c } of direct) { const key = ['light', 'cable'].includes(o.type) ? 'Garden lighting' : ['drain', 'pit'].includes(o.type) ? 'Drainage' : ['plant', 'tree'].includes(o.type) ? 'Planting' : o.name || TYPE_LABEL[o.type]; grouped.set(key, (grouped.get(key) ?? 0) + c * k); }
  const rows = [...grouped.entries()].filter(([, v]) => v > 0.5).map(([label, priceEx]) => ({ label, priceEx }));
  if (other * k > 0.5) rows.push({ label: 'Site establishment, equipment, delivery and disposal', priceEx: other * k });
  return rows;
}

const aud = (v: number) => v.toLocaleString('en-AU', { style: 'currency', currency: 'AUD' });

export function quotePdf(project: Project, e: Estimate, rows: QuoteRow[], s: CompanySettings): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210, L = 18, R = W - 18;
  let y = 20;
  const line = (t: string, size = 10, bold = false, color: [number, number, number] = [23, 32, 42], x = L, align: 'left' | 'right' = 'left') => { doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size); doc.setTextColor(...color); doc.text(t, x, y, { align }); };
  const para = (t: string, size = 9, color: [number, number, number] = [90, 101, 114]) => { doc.setFont('helvetica', 'normal'); doc.setFontSize(size); doc.setTextColor(...color); for (const l of doc.splitTextToSize(t, R - L) as string[]) { if (y > 280) { doc.addPage(); y = 20; } doc.text(l, L, y); y += size * 0.45; } y += 1.5; };
  line(s.company || s.appName, 16, true); y += 6;
  line([s.licence ? `Contractor licence ${s.licence}` : 'Contractor licence: not recorded', s.abn ? `ABN ${s.abn}` : '', s.phone, s.email].filter(Boolean).join('  |  '), 8.5, false, [90, 101, 114]); y += 9;
  line('PRELIMINARY ESTIMATE', 13, true, [44, 106, 59]); line(new Date().toLocaleDateString('en-AU', { dateStyle: 'long' }), 10, false, [23, 32, 42], R, 'right'); y += 6;
  if (project.synthetic) { line('SYNTHETIC DEMONSTRATION DATA - NOT A REAL QUOTATION', 9, true, [179, 38, 30]); y += 6; }
  line(`Project: ${project.name}`.slice(0, 95), 10, true); y += 5;
  line(`Customer: ${project.customer.name || 'not recorded'}`); y += 5;
  line(`Site: ${[project.site.address, project.site.suburb].filter(Boolean).join(', ') || 'not recorded'}`); y += 5;
  line(`Reference: ${project.id}   Design revision: ${project.versions.length}`, 9, false, [90, 101, 114]); y += 8;
  if (project.brief.scope) para(`Scope: ${project.brief.scope}`, 9.5, [23, 32, 42]);
  y += 2; doc.setDrawColor(195, 203, 196); doc.line(L, y, R, y); y += 6;
  line('Item', 9, true, [90, 101, 114]); line('Price ex GST', 9, true, [90, 101, 114], R, 'right'); y += 6;
  for (const r of rows) { line(r.label.slice(0, 80)); line(aud(r.priceEx), 10, false, [23, 32, 42], R, 'right'); y += 6; }
  doc.line(L, y - 2, R, y - 2); y += 4;
  line('Subtotal ex GST', 10, true); line(aud(e.priceEx), 10, true, [23, 32, 42], R, 'right'); y += 6;
  line(`GST ${project.estimate.gstPct}%`); line(aud(e.gst), 10, false, [23, 32, 42], R, 'right'); y += 6;
  line('Total inc GST', 12, true); line(aud(e.priceInc), 12, true, [23, 32, 42], R, 'right'); y += 10;
  if (e.flags.length) { line('This estimate is incomplete', 10, true, [179, 38, 30]); y += 5; para(`${e.flags.length} item(s) are not yet priced or measured and are excluded from the total. A firm quotation will follow once these are resolved.`, 9, [179, 38, 30]); }
  line('Basis of this estimate', 10, true); y += 5;
  for (const t of [
    'This is a preliminary estimate prepared from a concept design. It is not a contract or a fixed-price quotation.',
    'Quantities are calculated from the concept drawing. Dimensions marked as estimates will be confirmed by site measurement before a final price is given.',
    'Retaining walls, structural elements and drainage connections are subject to engineering design and approvals where required. Engineering, certification, council and survey fees are excluded unless listed.',
    'Excludes rock excavation, unknown underground services, contaminated material, and making good beyond the work area, unless listed.',
    'Supplier prices and availability can change. Materials are subject to supplier confirmation at the time of order.',
    'Residential building work over $5,000 (inc GST) in NSW requires a written contract; work over $20,000 requires Home Building Compensation cover before work starts.',
  ]) para(`• ${t}`);
  return doc;
}
