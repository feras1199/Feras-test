import type { EstimateSettings, Material, Project, QtyLine, Supplier } from './types.ts';
import { purchaseSchedule } from './assemblies.ts';
import { exGst } from './units.ts';

// ---- Pure financial formulas (unit-tested) ----

/** Selling price from cost and markup. Markup is profit as a share of COST. */
export const priceFromMarkup = (cost: number, markupPct: number) => cost * (1 + markupPct / 100);
/** Selling price from cost and target margin. Margin is profit as a share of SELLING PRICE. */
export const priceFromMargin = (cost: number, marginPct: number) => {
  if (marginPct >= 100) throw new Error('Margin must be below 100%');
  return cost / (1 - marginPct / 100);
};
export const marginFromMarkup = (markupPct: number) => (markupPct / (100 + markupPct)) * 100;
export const markupFromMargin = (marginPct: number) => (marginPct / (100 - marginPct)) * 100;
export const gstOn = (exAmount: number, gstPct = 10) => exAmount * (gstPct / 100);
export const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

export const DEFAULT_ESTIMATE: EstimateSettings = {
  rates: { skilled: 85, general: 60, supervisor: 100 },
  productivity: {
    paving: 1.0, 'wall.concrete-sleeper': 1.5, 'wall.segmental-block': 2.0, 'wall.sandstone-block': 3.0, 'wall.timber-sleeper': 1.5,
    garden: 0.4, planting: 0.15, turf: 0.15, deck: 2.5, drain: 0.5, edging: 0.25, light: 0.75, pit: 2, tree: 1.5, excavation: 0.5,
  },
  skilledShare: 0.6,
  supervisionPct: 10,
  accessFactor: 1,
  overheadPct: 10,
  contingencyPct: 10,
  markupPct: 25,
  gstPct: 10,
  bulkingFactor: 1.3,
  extras: [],
};

export const ACCESS_FACTOR = { easy: 1, restricted: 1.15, difficult: 1.35 } as const;

export interface CostLine {
  key: string; group: 'Materials' | 'Labour' | 'Equipment' | 'Subcontractors' | 'Disposal' | 'Delivery' | 'Other';
  desc: string; supplier?: string; qty: number | null; unit: string; rateEx: number | null; costEx: number;
  status: 'verified' | 'placeholder' | 'quote-required' | 'outdated' | 'assumption' | 'unknown-qty';
  materialId?: string;
  objectIds?: string[]; note?: string;
}

export interface Estimate {
  lines: CostLine[];
  totals: { materials: number; labour: number; equipment: number; subcontract: number; disposal: number; delivery: number; other: number };
  labourHours: number;
  direct: number; overhead: number; contingency: number; cost: number;
  profit: number; priceEx: number; gst: number; priceInc: number;
  markupPct: number; marginPct: number;
  flags: string[];
  /** Items priced from a project-level assumption rather than a supplier price. */
  assumed: string[];
  complete: boolean;
}

export function computeEstimate(project: Project, lines: QtyLine[], materials: Material[], suppliers: Supplier[]): Estimate {
  const s = project.estimate;
  const out: CostLine[] = [];
  const flags: string[] = [];
  const assumed: string[] = [];
  const sup = new Map(suppliers.map(x => [x.id, x]));

  // Materials: priced on the consolidated purchase quantity (after pack rounding), ex GST.
  const sched = purchaseSchedule(lines, materials);
  const usedSuppliers = new Set<string>();
  for (const r of sched) {
    const m = r.material;
    const pa = m.price == null ? project.priceAssumptions?.[m.id] : undefined;
    const rateEx = m.price != null ? exGst(m.price, m.gstInclusive, s.gstPct) : pa ? exGst(pa.price, true, s.gstPct) : null;
    const qty = r.purchaseQty;
    const cost = rateEx != null && qty != null ? rateEx * qty : 0;
    let status: CostLine['status'] = pa ? 'assumption' : m.priceStatus;
    if (qty == null || r.incomplete) status = 'unknown-qty';
    if (pa) assumed.push(`Assumed price $${pa.price.toFixed(2)} per ${m.unit} inc GST for "${m.name}"${pa.note ? ` (${pa.note})` : ''}`);
    else if (m.price == null) flags.push(`No price for "${m.name}": excluded from the total until priced.`);
    else if (m.priceStatus === 'placeholder') flags.push(`Placeholder price used for "${m.name}".`);
    else if (m.priceStatus === 'outdated') flags.push(`Price for "${m.name}" is outdated (last verified ${m.verifiedDate ?? 'unknown'}).`);
    if (r.incomplete) flags.push(`Quantity incomplete for "${m.name}": a required dimension is missing (see Quantities).`);
    if (qty && qty > 0) usedSuppliers.add(m.supplierId);
    out.push({ key: `mat:${r.key}`, materialId: m.id, group: 'Materials', desc: m.name, supplier: sup.get(m.supplierId)?.name, qty, unit: r.purchaseUnit, rateEx, costEx: cost, status, note: r.note });
  }

  // Delivery: one allowance per supplier actually used, only when the fee is known.
  const deliveryAllowance = s.extras.some(e => e.category === 'delivery');
  for (const id of usedSuppliers) {
    const x = sup.get(id);
    if (!x || id === 'internal') continue;
    if (x.deliveryFee == null) { if (!deliveryAllowance) flags.push(`Delivery cost for ${x.name} not known: add a delivery line or set the supplier fee.`); }
    else if (x.deliveryFee > 0) out.push({ key: `del:${id}`, group: 'Delivery', desc: `Delivery: ${x.name}`, qty: 1, unit: 'order', rateEx: exGst(x.deliveryFee, true, s.gstPct), costEx: exGst(x.deliveryFee, true, s.gstPct), status: x.deliveryStatus === 'verified' ? 'verified' : 'assumption' });
  }

  // Labour: hours from take-off, split skilled / general, plus supervision.
  let hours = 0, unknownLabour = false;
  for (const l of lines) if (l.kind === 'labour') { if (l.gross == null) unknownLabour = true; else hours += l.gross; }
  let excav = 0;
  for (const l of lines) if (l.kind === 'earthworks' && l.unit === 'm3' && l.gross != null) excav += l.gross;
  const excavHours = excav * (s.productivity.excavation ?? 0) * s.accessFactor;
  hours += excavHours;
  if (unknownLabour) flags.push('Some labour hours could not be calculated (missing dimensions).');
  const skilledH = hours * s.skilledShare, generalH = hours - skilledH, superH = hours * (s.supervisionPct / 100);
  if (hours > 0) {
    out.push({ key: 'lab:skilled', group: 'Labour', desc: 'Skilled landscaping labour', qty: skilledH, unit: 'h', rateEx: s.rates.skilled, costEx: skilledH * s.rates.skilled, status: 'assumption' });
    out.push({ key: 'lab:general', group: 'Labour', desc: 'General labour', qty: generalH, unit: 'h', rateEx: s.rates.general, costEx: generalH * s.rates.general, status: 'assumption' });
    if (superH > 0) out.push({ key: 'lab:super', group: 'Labour', desc: 'Supervision', qty: superH, unit: 'h', rateEx: s.rates.supervisor, costEx: superH * s.rates.supervisor, status: 'assumption' });
  }

  // User-entered lines: equipment, subcontractors, disposal, delivery, other.
  const groupOf = { equipment: 'Equipment', subcontract: 'Subcontractors', disposal: 'Disposal', delivery: 'Delivery', other: 'Other' } as const;
  for (const e of s.extras) out.push({ key: `x:${e.id}`, group: groupOf[e.category], desc: e.desc, qty: e.qty, unit: e.unit, rateEx: e.rate, costEx: e.qty * e.rate, status: e.assumption ? 'assumption' : 'verified' });
  if (excav > 0 && !s.extras.some(e => e.category === 'disposal'))
    flags.push(`About ${(excav * s.bulkingFactor).toFixed(1)} m³ of loose spoil (${excav.toFixed(1)} m³ in ground × bulking ${s.bulkingFactor}) has no disposal line.`);

  const sum = (g: CostLine['group']) => out.filter(l => l.group === g).reduce((a, l) => a + l.costEx, 0);
  const totals = { materials: sum('Materials'), labour: sum('Labour'), equipment: sum('Equipment'), subcontract: sum('Subcontractors'), disposal: sum('Disposal'), delivery: sum('Delivery'), other: sum('Other') };
  const direct = Object.values(totals).reduce((a, b) => a + b, 0);
  const overhead = direct * (s.overheadPct / 100);
  const contingency = (direct + overhead) * (s.contingencyPct / 100);
  const cost = direct + overhead + contingency;
  const priceEx = priceFromMarkup(cost, s.markupPct);
  const profit = priceEx - cost;
  const gst = gstOn(priceEx, s.gstPct);
  return {
    lines: out, totals, labourHours: hours, direct, overhead, contingency, cost, profit, priceEx, gst, priceInc: priceEx + gst,
    markupPct: s.markupPct, marginPct: priceEx > 0 ? (profit / priceEx) * 100 : 0,
    flags: [...new Set(flags)], assumed, complete: flags.length === 0,
  };
}

/** Cost attributable to one object (materials on its own purchase rounding + its labour), for comparisons. */
export function objectDirectCost(project: Project, objectId: string, lines: QtyLine[], materials: Material[]): { cost: number; incomplete: boolean; missing: string } {
  const mats = new Map(materials.map(m => [m.id, m]));
  const s = project.estimate;
  const blended = s.rates.skilled * s.skilledShare + s.rates.general * (1 - s.skilledShare) + s.rates.supervisor * (s.supervisionPct / 100);
  let cost = 0, incomplete = false;
  const missing: string[] = [];
  for (const l of lines) {
    if (l.objectId !== objectId) continue;
    if (l.kind === 'labour') { if (l.gross == null) incomplete = true; else cost += l.gross * blended; }
    else if (l.kind === 'earthworks' && l.unit === 'm3') { if (l.gross != null) cost += l.gross * (s.productivity.excavation ?? 0) * s.accessFactor * blended; }
    else if (l.kind === 'material' && l.materialId) {
      const m = mats.get(l.materialId);
      const pa = m && m.price == null ? project.priceAssumptions?.[m.id] : undefined;
      if (!m || (m.price == null && !pa) || l.purchaseQty == null) { incomplete = true; missing.push(l.component); continue; }
      cost += (m.price != null ? exGst(m.price, m.gstInclusive, s.gstPct) : exGst(pa!.price, true, s.gstPct)) * l.purchaseQty;
    }
  }
  return { cost, incomplete, missing: missing.sort().join('|') };
}
