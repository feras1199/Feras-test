import type { Material, Project, QtyLine, Supplier } from '../types.ts';
import { GEOM } from '../types.ts';
import { purchaseSchedule } from '../assemblies.ts';
import type { Estimate } from '../estimate.ts';

const cell = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export const toCsv = (rows: unknown[][]) => rows.map(r => r.map(cell).join(',')).join('\r\n') + '\r\n';

export function boqCsv(project: Project, lines: QtyLine[], materials: Material[]): string {
  const mats = new Map(materials.map(m => [m.id, m]));
  const rows: unknown[][] = [[`Bill of quantities: ${project.name}`], [`Project ID: ${project.id}`, `Status: ${project.status}`, `Generated: ${new Date().toISOString()}`], [],
    ['Element', 'Item', 'Type', 'Material', 'Formula', 'Inputs', 'Assumptions', 'Net qty', 'Unit', 'Waste %', 'Qty incl. waste', 'Purchase qty', 'Purchase unit', 'Purchase note', 'Manual override', 'Warning']];
  for (const l of lines) rows.push([l.objectName, l.component, l.kind, l.materialId ? mats.get(l.materialId)?.name ?? l.materialId : '', l.formula, Object.entries(l.inputs).map(([k, v]) => `${k}: ${v}`).join('; '), l.assumptions.join(' | '), l.net ?? 'unknown', l.unit, l.wastePct, l.gross ?? 'unknown', l.purchaseQty ?? '', l.purchaseUnit ?? '', l.purchaseNote ?? '', l.overridden ? `${l.overridden.qty} by ${l.overridden.by} on ${l.overridden.date}: ${l.overridden.reason}` : '', l.warning ?? '']);
  return toCsv(rows);
}

export function scheduleCsv(project: Project, lines: QtyLine[], materials: Material[], suppliers: Supplier[]): string {
  const sup = new Map(suppliers.map(s => [s.id, s.name]));
  const st = new Map(project.procurement.map(l => [l.key, l.status]));
  const rows: unknown[][] = [[`Material schedule: ${project.name}`], [`Project ID: ${project.id}`, `Generated: ${new Date().toISOString()}`], [],
    ['Supplier', 'Material', 'Category', 'Design qty', 'Design unit', 'Order qty', 'Order unit', 'Rounding / conversion', 'Unit price (as listed)', 'GST inclusive', 'Price status', 'Price verified on', 'Source URL', 'Order status', 'Used in']];
  for (const r of purchaseSchedule(lines, materials)) rows.push([sup.get(r.material.supplierId) ?? r.material.supplierId, r.material.name, r.material.category, r.designQty ?? 'unknown', r.designUnit, r.purchaseQty ?? 'INCOMPLETE', r.purchaseUnit, r.note, r.material.price ?? 'NOT PRICED', r.material.gstInclusive ? 'yes' : 'no', r.material.priceStatus, r.material.verifiedDate ?? '', r.material.sourceUrl ?? '', st.get(r.key) ?? 'to-order', r.from.join(' | ')]);
  return toCsv(rows);
}

export function estimateCsv(project: Project, e: Estimate): string {
  const rows: unknown[][] = [[`Cost estimate (internal): ${project.name}`], [`Generated: ${new Date().toISOString()}`], [], ['Group', 'Description', 'Supplier', 'Qty', 'Unit', 'Rate ex GST', 'Cost ex GST', 'Basis']];
  for (const l of e.lines) rows.push([l.group, l.desc, l.supplier ?? '', l.qty == null ? 'unknown' : l.qty.toFixed(2), l.unit, l.rateEx == null ? 'NOT PRICED' : l.rateEx.toFixed(2), l.costEx.toFixed(2), l.status]);
  rows.push([], ['', 'Direct cost', '', '', '', '', e.direct.toFixed(2)], ['', `Overhead ${project.estimate.overheadPct}%`, '', '', '', '', e.overhead.toFixed(2)], ['', `Contingency ${project.estimate.contingencyPct}%`, '', '', '', '', e.contingency.toFixed(2)], ['', 'Total cost', '', '', '', '', e.cost.toFixed(2)],
    ['', `Markup ${e.markupPct}% on cost (= ${e.marginPct.toFixed(1)}% margin on price)`, '', '', '', '', e.profit.toFixed(2)], ['', 'Price ex GST', '', '', '', '', e.priceEx.toFixed(2)], ['', `GST ${project.estimate.gstPct}%`, '', '', '', '', e.gst.toFixed(2)], ['', 'Price inc GST', '', '', '', '', e.priceInc.toFixed(2)], [], ['Open items']);
  for (const f of e.flags) rows.push([f]);
  return toCsv(rows);
}

/** Minimal ASCII DXF (R12-style entities) of the plan geometry, in metres, Y up. */
export function toDxf(project: Project): string {
  const o: string[] = [];
  const g = (...kv: (string | number)[]) => { for (let i = 0; i < kv.length; i += 2) o.push(String(kv[i]), String(kv[i + 1])); };
  const layers = [...new Set(project.objects.map(x => `${x.layer.toUpperCase()}_${x.type.toUpperCase()}`))];
  g(0, 'SECTION', 2, 'HEADER', 9, '$INSUNITS', 70, 6, 9, '$MEASUREMENT', 70, 1, 0, 'ENDSEC');
  g(0, 'SECTION', 2, 'TABLES', 0, 'TABLE', 2, 'LAYER', 70, layers.length);
  for (const l of layers) g(0, 'LAYER', 2, l, 70, 0, 62, l.startsWith('EXISTING') ? 8 : 7, 6, 'CONTINUOUS');
  g(0, 'ENDTAB', 0, 'ENDSEC', 0, 'SECTION', 2, 'ENTITIES');
  for (const x of project.objects) {
    const layer = `${x.layer.toUpperCase()}_${x.type.toUpperCase()}`;
    const kind = GEOM[x.type];
    if (kind === 'point') {
      g(0, 'CIRCLE', 8, layer, 10, x.points[0].x.toFixed(4), 20, (-x.points[0].y).toFixed(4), 30, 0, 40, x.type === 'tree' ? ((Number(x.props.spread) || 3) / 2).toFixed(3) : 0.1);
      g(0, 'TEXT', 8, layer, 10, (x.points[0].x + 0.15).toFixed(4), 20, (-x.points[0].y + 0.15).toFixed(4), 30, 0, 40, 0.15, 1, x.type === 'level' ? `RL ${x.props.rl ?? '?'}` : x.name);
    } else {
      g(0, 'POLYLINE', 8, layer, 66, 1, 70, kind === 'area' ? 1 : 0);
      for (const p of x.points) g(0, 'VERTEX', 8, layer, 10, p.x.toFixed(4), 20, (-p.y).toFixed(4), 30, 0);
      g(0, 'SEQEND');
      const c = x.points[0];
      g(0, 'TEXT', 8, layer, 10, (c.x + 0.1).toFixed(4), 20, (-c.y - 0.3).toFixed(4), 30, 0, 40, 0.15, 1, x.name);
    }
  }
  g(0, 'ENDSEC', 0, 'EOF');
  return o.join('\r\n') + '\r\n';
}
