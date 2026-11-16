import { describe, expect, it } from 'vitest';
import { arcThrough, asRectangle, overlapArea, polygonArea, polylineLength, rectPoints, resizeRectangle, selfIntersects, setPolylineLength } from '../src/core/geometry.ts';
import { ceilTo, toPurchase, volumeToTonnes, exGst } from '../src/core/units.ts';
import { SEED_MATERIALS, SEED_SUPPLIERS } from '../src/core/catalogue.ts';
import { takeoff, purchaseSchedule } from '../src/core/assemblies.ts';
import { computeEstimate, gstOn, marginFromMarkup, markupFromMargin, priceFromMargin, priceFromMarkup } from '../src/core/estimate.ts';
import { newObject, newProject, DEFAULT_SETTINGS } from '../src/core/project.ts';
import { demoProject } from '../src/core/demo.ts';
import { validateProject, guidedMeasurements } from '../src/core/validation.ts';
import { evaluateCompliance, issueBlockers } from '../src/core/compliance.ts';
import { applyOps, parseCommand } from '../src/core/ops.ts';
import { generateAlternatives } from '../src/core/alternatives.ts';
import type { Material, Project } from '../src/core/types.ts';

const M = SEED_MATERIALS, S = SEED_SUPPLIERS;
const line = (p: Project, objectId: string, component: string) => takeoff(p, M).find(l => l.objectId === objectId && l.component === component)!;

describe('21.3 drawing geometry', () => {
  it('5 m x 4 m rectangle is 20 m2; resized to 6 x 4 is 24 m2 and quantities follow', () => {
    const p = newProject();
    const pav = newObject('paving', rectPoints(0, 0, 5, 4), []);
    p.objects.push(pav);
    expect(polygonArea(pav.points)).toBeCloseTo(20, 9);
    expect(line(p, pav.id, 'Pavers').net).toBeCloseTo(20, 9);
    const before = line(p, pav.id, 'Pavers').purchaseQty!;
    pav.points = resizeRectangle(pav.points, 6, 4);
    expect(polygonArea(pav.points)).toBeCloseTo(24, 9);
    expect(asRectangle(pav.points)).toMatchObject({ w: 6, h: 4 });
    const after = line(p, pav.id, 'Pavers');
    expect(after.net).toBeCloseTo(24, 9);
    expect(after.purchaseQty!).toBeGreaterThan(before);
    // base course: 24 m2 x 0.1 m = 2.4 m3 net
    expect(line(p, pav.id, 'Base course').net).toBeCloseTo(2.4, 9);
  });
  it('rotated rectangles, self-intersection, overlap, arcs', () => {
    const r = rectPoints(1, 1, 3, 2);
    expect(selfIntersects(r)).toBe(false);
    expect(selfIntersects([{ x: 0, y: 0 }, { x: 2, y: 2 }, { x: 2, y: 0 }, { x: 0, y: 2 }])).toBe(true);
    expect(overlapArea(rectPoints(0, 0, 4, 4), rectPoints(2, 2, 4, 4))).toBeCloseTo(4, 9);
    expect(overlapArea(rectPoints(0, 0, 1, 1), rectPoints(2, 2, 1, 1))).toBeCloseTo(0, 9);
    const arc = arcThrough({ x: -1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 0 }, 64);
    expect(polylineLength(arc)).toBeCloseTo(Math.PI, 2);
  });
});

describe('21.4 retaining wall', () => {
  it('10 m x 0.6 m wall face is 6 m2; 12 m is 7.2 m2; materials and estimate recalculate', () => {
    const p = newProject();
    const w = newObject('wall', [{ x: 0, y: 0 }, { x: 10, y: 0 }], []);
    w.props.exposedHeight = 0.6; w.props.retainedHeight = 0.6;
    p.objects.push(w);
    expect(line(p, w.id, 'Wall face area').net).toBeCloseTo(6, 9);
    // 2.0 m sleepers at 2.03 m centres: ceil(10/2.03)=5 bays x 3 courses = 15 sleepers, 6 posts
    expect(line(p, w.id, 'Concrete sleepers').net).toBe(15);
    expect(line(p, w.id, 'Steel posts').net).toBe(6);
    expect(line(p, w.id, 'Subsoil drain (ag pipe)').net).toBeCloseTo(13, 9);
    expect(line(p, w.id, 'Subsoil drain (ag pipe)').purchaseQty).toBe(1); // one 20 m roll
    const e10 = computeEstimate(p, takeoff(p, M), M, S);

    w.points = setPolylineLength(w.points, 12);
    expect(polylineLength(w.points)).toBeCloseTo(12, 9);
    expect(line(p, w.id, 'Wall face area').net).toBeCloseTo(7.2, 9);
    expect(line(p, w.id, 'Concrete sleepers').net).toBe(18); // ceil(12/2.03)=6 bays x 3
    expect(line(p, w.id, 'Steel posts').net).toBe(7);
    // drainage aggregate: 12 x 0.3 x 0.6 = 2.16 m3 net
    expect(line(p, w.id, 'Drainage aggregate behind wall').net).toBeCloseTo(2.16, 9);
    const e12 = computeEstimate(p, takeoff(p, M), M, S);
    expect(e12.totals.materials).toBeGreaterThan(e10.totals.materials);
    expect(e12.labourHours).toBeCloseTo(e10.labourHours * 1.2, 6);
  });
  it('footing concrete is unknown until engineer dimensions are entered, then calculated', () => {
    const p = newProject();
    const w = newObject('wall', [{ x: 0, y: 0 }, { x: 10, y: 0 }], []);
    p.objects.push(w);
    expect(line(p, w.id, 'Post footing concrete').net).toBeNull();
    w.props.footingDia = 0.45; w.props.footingDepth = 0.9;
    expect(line(p, w.id, 'Post footing concrete').net).toBeCloseTo(6 * Math.PI * 0.225 ** 2 * 0.9, 9);
  });
  it('segmental block wall: blocks and caps', () => {
    const p = newProject();
    const w = newObject('wall', [{ x: 0, y: 0 }, { x: 10, y: 0 }], []);
    w.props.system = 'segmental-block'; w.materialId = 'blk-versawall';
    p.objects.push(w);
    // 25 blocks per course x 3 courses = 75 (equals 12.5 per m2 x 6 m2), +5% = 78.75 -> 79
    expect(line(p, w.id, 'Wall blocks').net).toBe(75);
    expect(line(p, w.id, 'Wall blocks').purchaseQty).toBe(79);
    // caps: 10 m +5% = 10.5 m / 0.3 m = 35
    expect(line(p, w.id, 'Capping units').purchaseQty).toBe(35);
  });
});

describe('21.5 procurement calculations', () => {
  const paver: Material = { id: 'p', name: 'Paver 400x400', category: 'Paving', supplierId: 'generic', unit: 'each', price: 5, gstInclusive: true, priceStatus: 'placeholder', dims: { l: 400, w: 400, t: 40 } };
  it('area to units with waste, then pack rounding and minimum order', () => {
    // 37.4 m2 + 5% = 39.27 m2 / 0.16 = 245.44 -> 246 each
    expect(toPurchase(paver, 37.4 * 1.05, 'm2').qty).toBe(246);
    // packs of 50 -> 250
    expect(toPurchase({ ...paver, packSize: 50 }, 37.4 * 1.05, 'm2').qty).toBe(250);
    // min order 300
    expect(toPurchase({ ...paver, packSize: 50, minOrder: 300 }, 37.4 * 1.05, 'm2').qty).toBe(300);
  });
  it('volume to tonnes needs an explicit density', () => {
    expect(volumeToTonnes(2, undefined)).toBeNull();
    expect(volumeToTonnes(2, 1.6)).toBeCloseTo(3.2, 9);
    const agg: Material = { id: 'a', name: 'Agg', category: 'Aggregates', supplierId: 'generic', unit: 't', price: 100, gstInclusive: true, priceStatus: 'placeholder' };
    expect(toPurchase(agg, 2, 'm3').qty).toBeNull();
    const r = toPurchase({ ...agg, density: 1.5 }, 2.16 * 1.1, 'm3'); // 3.564 t -> 4.0 t in 0.5 t steps
    expect(r.qty).toBe(4);
    expect(r.assumptions.join(' ')).toMatch(/density 1.5/);
  });
  it('lengths to rolls and sleepers', () => {
    const roll = M.find(m => m.id === 'agpipe-100-20-bcs')!;
    expect(toPurchase(roll, 13, 'lm').qty).toBe(1);
    expect(toPurchase(roll, 20.01, 'lm').qty).toBe(2);
    const geo = M.find(m => m.id === 'geo-2000x50')!;
    expect(toPurchase(geo, 101, 'm2').qty).toBe(2);
    expect(ceilTo(0.6 / 0.2, 1)).toBe(3);
    expect(ceilTo(1.2000000000001, 0.5)).toBe(1.5);
  });
  it('same product across objects is consolidated before rounding', () => {
    const p = newProject();
    p.objects.push(newObject('wall', [{ x: 0, y: 0 }, { x: 8, y: 0 }], []), newObject('wall', [{ x: 0, y: 5 }, { x: 8, y: 5 }], p.objects));
    const row = purchaseSchedule(takeoff(p, M), M).find(r => r.material.id === 'agpipe-100-20-bcs')!;
    expect(row.designQty).toBeCloseTo(22, 9); // (8+3) x 2
    expect(row.purchaseQty).toBe(2);
  });
});

describe('21.6 pricing formulas', () => {
  it('markup and margin are different things', () => {
    expect(priceFromMarkup(1000, 20)).toBeCloseTo(1200, 9); // 20% markup
    expect(priceFromMargin(1000, 20)).toBeCloseTo(1250, 9); // 20% margin
    expect(marginFromMarkup(20)).toBeCloseTo(16.6667, 3);
    expect(markupFromMargin(20)).toBeCloseTo(25, 9);
    expect(marginFromMarkup(markupFromMargin(37.5))).toBeCloseTo(37.5, 9);
    expect(() => priceFromMargin(100, 100)).toThrow();
  });
  it('GST', () => {
    expect(gstOn(1000)).toBeCloseTo(100, 9);
    expect(exGst(110, true)).toBeCloseTo(100, 9);
    expect(exGst(110, false)).toBe(110);
  });
  it('estimate roll-up: materials, labour, overhead, contingency, markup, GST', () => {
    const p = newProject();
    const pav = newObject('paving', rectPoints(0, 0, 5, 4), []);
    pav.materialId = 'p'; pav.props.jointCoverage = 10;
    p.objects.push(pav);
    const price = (id: string, unit: Material['unit'], inc: number, extra: Partial<Material> = {}): Material => ({ id, name: id, category: 'x', supplierId: 'internal', unit, price: inc, gstInclusive: true, priceStatus: 'verified', ...extra });
    const mats = [price('p', 'm2', 110), price('base-roadbase-recycled', 't', 55, { density: 1.6, increment: 0.5 }), price('sand-bedding', 't', 66, { density: 1.5, increment: 0.5 }), price('sand-jointing', 'bag', 22), price('edge-restraint', 'lm', 11)];
    p.estimate = { ...p.estimate, rates: { skilled: 80, general: 50, supervisor: 100 }, productivity: { paving: 1, excavation: 0 }, skilledShare: 0.5, supervisionPct: 0, accessFactor: 1, overheadPct: 10, contingencyPct: 5, markupPct: 25, gstPct: 10, extras: [{ id: 'e', category: 'equipment', desc: 'Compactor', qty: 1, unit: 'day', rate: 100, assumption: true }, { id: 'd', category: 'disposal', desc: 'Tip', qty: 1, unit: 'load', rate: 200, assumption: true }] };
    const e = computeEstimate(p, takeoff(p, mats), mats, S);
    // pavers 20 m2 +5% = 21 m2 @ $100 ex = 2100
    // base 2 m3 +10% = 2.2 m3 x 1.6 = 3.52 t -> 4.0 t @ $50 = 200
    // bedding 0.6 m3 +10% = 0.66 x 1.5 = 0.99 t -> 1.0 t @ $60 = 60
    // jointing 2 bags @ $20 = 40 ; edge 18 m @ $10 = 180
    expect(e.totals.materials).toBeCloseTo(2100 + 200 + 60 + 40 + 180, 6);
    expect(e.labourHours).toBeCloseTo(20, 9);
    expect(e.totals.labour).toBeCloseTo(10 * 80 + 10 * 50, 6);
    expect(e.totals.equipment).toBe(100);
    expect(e.totals.disposal).toBe(200);
    const direct = 2580 + 1300 + 100 + 200;
    expect(e.direct).toBeCloseTo(direct, 6);
    expect(e.overhead).toBeCloseTo(direct * 0.1, 6);
    expect(e.contingency).toBeCloseTo(direct * 1.1 * 0.05, 6);
    const cost = direct * 1.1 * 1.05;
    expect(e.cost).toBeCloseTo(cost, 6);
    expect(e.priceEx).toBeCloseTo(cost * 1.25, 6);
    expect(e.profit).toBeCloseTo(cost * 0.25, 6);
    expect(e.marginPct).toBeCloseTo(20, 6); // 25% markup = 20% margin
    expect(e.gst).toBeCloseTo(cost * 1.25 * 0.1, 6);
    expect(e.priceInc).toBeCloseTo(cost * 1.25 * 1.1, 6);
    expect(e.complete).toBe(true);
  });
  it('unpriced materials are flagged and excluded, never guessed', () => {
    const p = newProject();
    p.objects.push(newObject('paving', rectPoints(0, 0, 5, 4), []));
    const e = computeEstimate(p, takeoff(p, M), M, S);
    expect(e.complete).toBe(false);
    expect(e.flags.some(f => /No price for "Washed river sand/.test(f))).toBe(true);
  });
  it('manual quantity override is applied and recorded', () => {
    const p = newProject();
    const pav = newObject('paving', rectPoints(0, 0, 5, 4), []);
    p.objects.push(pav);
    p.overrides.push({ key: `${pav.id}:Pavers`, qty: 30, reason: 'extra for feature border', by: 'Tester', date: '2026-11-11' });
    const l = line(p, pav.id, 'Pavers');
    expect(l.gross).toBe(30);
    expect(l.overridden?.reason).toMatch(/feature border/);
  });
});

describe('validation, guidance, compliance, assistant', () => {
  it('demo project validates without errors and conflicts are flagged, not auto-corrected', () => {
    const p = demoProject();
    expect(validateProject(p).filter(i => i.severity === 'error')).toEqual([]);
    const pav = p.objects.find(o => o.id === 'demo_new_paving')!;
    const before = structuredClone(pav.points);
    pav.points = resizeRectangle(pav.points, 7.5, 3);
    const issues = validateProject(p);
    expect(issues.some(i => i.kind === 'measurement-conflict' && /7\.000 m but the drawing shows 7\.500/.test(i.message))).toBe(true);
    expect(pav.points).not.toEqual(before); // drawing left as the user drew it
  });
  it('invalid geometry is reported', () => {
    const p = newProject();
    p.objects.push(newObject('paving', [{ x: 0, y: 0 }, { x: 2, y: 2 }, { x: 2, y: 0 }, { x: 0, y: 2 }], []), newObject('wall', [{ x: 0, y: 0 }, { x: 0, y: 0 }], []));
    const kinds = validateProject(p).map(i => i.kind);
    expect(kinds).toContain('self-intersection');
    expect(kinds).toContain('zero-length');
  });
  it('guided measurements prioritise the unverified wall', () => {
    const g = guidedMeasurements(demoProject(), M);
    expect(g[0].objectId).toBe('demo_retaining_wall');
    expect(g.some(t => /New paving/.test(t.label))).toBe(false); // already verified incl. diagonal
  });
  it('compliance never reports a wall as cleared without evidence', () => {
    const p = demoProject();
    const e = computeEstimate(p, takeoff(p, M), M, S);
    const c = evaluateCompliance(p, e.priceInc, DEFAULT_SETTINGS);
    expect(c.find(k => k.id === 'wall-eng:demo_retaining_wall')!.status).toBe('potential'); // slope surcharge
    expect(c.find(k => k.id === 'wall-exempt:demo_retaining_wall')!.status).toBe('insufficient');
    expect(c.find(k => k.id === 'tree:demo_existing_tree')!.status).toBe('potential');
    expect(issueBlockers(p, c).length).toBeGreaterThan(0);
    const wall = p.objects.find(o => o.id === 'demo_retaining_wall')!;
    wall.props.retainedHeight = 1.2;
    const c2 = evaluateCompliance(p, e.priceInc, DEFAULT_SETTINGS);
    expect(c2.find(k => k.id === 'wall-exempt:demo_retaining_wall')!.result).toMatch(/exceeds the 600 mm/);
    expect(c2.find(k => k.id === 'wall-eng:demo_retaining_wall')!.result).toMatch(/above 800 mm/);
  });
  it('assistant commands produce structured changes that update the estimate', () => {
    const p = demoProject();
    const r = parseCommand('make the wall 12 m long', p, M, S);
    expect(r.ops).toEqual([{ op: 'setLength', objectId: 'demo_retaining_wall', length: 12 }]);
    const p2 = applyOps(p, r.ops);
    expect(polylineLength(p2.objects.find(o => o.id === 'demo_retaining_wall')!.points)).toBeCloseTo(12, 9);
    const r2 = parseCommand('replace the wall with sandstone', p, M, S);
    expect(r2.ops[0]).toMatchObject({ op: 'setWallSystem', system: 'sandstone-block' });
    const r3 = parseCommand('make this design $1,000 cheaper', p, M, S);
    expect(r3.ops.length).toBeGreaterThan(0);
    const e0 = computeEstimate(p, takeoff(p, M), M, S), p3 = applyOps(p, r3.ops), e3 = computeEstimate(p3, takeoff(p3, M), M, S);
    expect(e3.priceInc).toBeLessThan(e0.priceInc);
    expect(parseCommand('sing me a song', p, M, S).understood).toBe(false);
  });
  it('three design alternatives are costed from the same geometry', () => {
    const a = generateAlternatives(demoProject(), M, S, DEFAULT_SETTINGS);
    expect(a.map(x => x.tier)).toEqual(['economy', 'balanced', 'premium']);
    expect(a[0].estimate.priceInc).toBeLessThan(a[2].estimate.priceInc);
  });
});

describe('price assumptions', () => {
  it('project allowances are included, labelled, and never written to the catalogue', () => {
    const p = demoProject();
    const e = computeEstimate(p, takeoff(p, M), M, S);
    expect(e.assumed.length).toBeGreaterThan(0);
    expect(e.lines.find(l => l.desc.startsWith('Washed river sand'))!.status).toBe('assumption');
    expect(M.find(m => m.id === 'sand-bedding')!.price).toBeNull();
    delete p.priceAssumptions!['sand-bedding'];
    const e2 = computeEstimate(p, takeoff(p, M), M, S);
    expect(e2.priceInc).toBeLessThan(e.priceInc);
    expect(e2.flags.some(f => /Washed river sand/.test(f))).toBe(true);
  });
});
