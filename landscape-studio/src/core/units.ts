import type { Material, Unit } from './types.ts';

export const UNIT_LABEL: Record<Unit, string> = {
  each: 'ea', m2: 'm²', m3: 'm³', t: 't', lm: 'm', roll: 'roll', bag: 'bag', hr: 'h', day: 'day', load: 'load', item: 'item',
};

export const mmToM = (mm: number) => mm / 1000;
export const mToMm = (m: number) => m * 1000;

/** Volume (m3) to mass (t). Density must be supplied explicitly: never guessed here. */
export function volumeToTonnes(m3: number, density: number | undefined): number | null {
  if (!density || density <= 0) return null;
  return m3 * density;
}

/** Round up to a multiple of step, tolerant of floating point noise. */
export function ceilTo(v: number, step: number): number {
  if (step <= 0) return v;
  return Math.round(Math.ceil(v / step - 1e-9) * step * 1e6) / 1e6;
}

export const ceilInt = (v: number) => Math.ceil(v - 1e-9);

export interface PurchaseResult { qty: number | null; unit: Unit; note: string; assumptions: string[] }

/**
 * Convert a design quantity (already including waste) into what must actually be bought:
 * unit conversion, then sale increment, then pack multiples, then minimum order.
 */
export function toPurchase(m: Material, qty: number, qtyUnit: Unit): PurchaseResult {
  const assumptions: string[] = [];
  let base: number | null = null;
  let note = '';
  const u = m.unit;
  if (qtyUnit === u) {
    base = qty;
  } else if (qtyUnit === 'm2' && u === 'each' && m.dims?.l && m.dims?.w) {
    const cover = (m.dims.l * m.dims.w) / 1e6;
    base = qty / cover;
    note = `${fmt(qty)} m² ÷ ${fmt(cover, 4)} m² per unit`;
  } else if (qtyUnit === 'm2' && u === 'roll' && m.lengthM && m.widthM) {
    base = qty / (m.lengthM * m.widthM);
    note = `${fmt(qty)} m² ÷ ${fmt(m.lengthM * m.widthM)} m² per roll`;
  } else if (qtyUnit === 'm2' && u === 'bag' && m.coverageM2) {
    base = qty / m.coverageM2;
    note = `${fmt(qty)} m² ÷ ${m.coverageM2} m² per bag`;
  } else if (qtyUnit === 'lm' && u === 'each' && m.dims?.l) {
    base = qty / (m.dims.l / 1000);
    note = `${fmt(qty)} m ÷ ${fmt(m.dims.l / 1000)} m per unit`;
  } else if (qtyUnit === 'lm' && u === 'roll' && m.lengthM) {
    base = qty / m.lengthM;
    note = `${fmt(qty)} m ÷ ${m.lengthM} m per roll`;
  } else if (qtyUnit === 'm3' && u === 't') {
    const t = volumeToTonnes(qty, m.density);
    if (t == null) return { qty: null, unit: u, note: 'No density set: cannot convert m³ to tonnes', assumptions };
    base = t;
    note = `${fmt(qty)} m³ × ${m.density} t/m³`;
    assumptions.push(`Bulk density ${m.density} t/m³ (${m.densitySource ?? 'user-entered'})`);
  } else if (qtyUnit === 't' && u === 'm3' && m.density) {
    base = qty / m.density;
    note = `${fmt(qty)} t ÷ ${m.density} t/m³`;
    assumptions.push(`Bulk density ${m.density} t/m³ (${m.densitySource ?? 'user-entered'})`);
  } else if (qtyUnit === 'm3' && u === 'bag' && m.density && m.bagKg) {
    base = (qty * m.density * 1000) / m.bagKg;
    note = `${fmt(qty)} m³ × ${m.density} t/m³ ÷ ${m.bagKg} kg bags`;
    assumptions.push(`Bulk density ${m.density} t/m³ (${m.densitySource ?? 'user-entered'})`);
  } else if (qtyUnit === 't' && u === 'bag' && m.bagKg) {
    base = (qty * 1000) / m.bagKg;
    note = `${fmt(qty)} t ÷ ${m.bagKg} kg bags`;
  } else {
    return { qty: null, unit: u, note: `No conversion from ${UNIT_LABEL[qtyUnit]} to ${UNIT_LABEL[u]} for this product (missing dimensions or coverage)`, assumptions };
  }
  const inc = m.increment ?? (u === 't' || u === 'm3' ? 0.5 : u === 'lm' || u === 'm2' ? 1 : 1);
  let q = ceilTo(base, inc);
  const steps: string[] = [];
  if (Math.abs(q - base) > 1e-9) steps.push(`rounded up to ${inc} ${UNIT_LABEL[u]} increments`);
  if ((u === 't' || u === 'm3') && m.increment == null) assumptions.push(`Sold in ${inc} ${UNIT_LABEL[u]} increments (assumed; confirm with supplier)`);
  if (m.packSize && m.packSize > 1) {
    const p = ceilTo(q, m.packSize);
    if (p !== q) steps.push(`rounded up to packs of ${m.packSize}`);
    q = p;
  }
  if (m.minOrder && q < m.minOrder) { steps.push(`raised to minimum order ${m.minOrder}`); q = m.minOrder; }
  return { qty: q, unit: u, note: [note, ...steps].filter(Boolean).join('; '), assumptions };
}

export function fmt(v: number | null | undefined, dp = 2): string {
  if (v == null || !isFinite(v)) return '-';
  return v.toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: dp });
}

export const money = (v: number | null | undefined, dp = 2) =>
  v == null || !isFinite(v) ? '-' : v.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: dp, maximumFractionDigits: dp });

/** Display a length honestly: estimated values are shown to the nearest 0.1 m, verified to the millimetre. */
export function fmtLen(m: number | null | undefined, confidence: 'verified' | 'estimated' | 'unknown' = 'verified'): string {
  if (m == null || !isFinite(m)) return '?';
  if (confidence === 'estimated') return `~${m.toFixed(1)} m`;
  if (confidence === 'unknown') return '?';
  return `${m.toFixed(3).replace(/0$/, '').replace(/0$/, '')} m`;
}

export const exGst = (price: number, inclusive: boolean, gstPct = 10) => (inclusive ? price / (1 + gstPct / 100) : price);
