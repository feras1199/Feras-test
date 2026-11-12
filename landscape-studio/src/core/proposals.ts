import type { CompanySettings, DesignProposal, Material, Project, ProposalBrief, SiteObject, Supplier } from './types.ts';
import { GEOM } from './types.ts';
import { applyOps, type Op } from './ops.ts';
import { takeoff, WALL_SYSTEMS, type WallSystem, defaultProps } from './assemblies.ts';
import { computeEstimate } from './estimate.ts';
import { evaluateCompliance } from './compliance.ts';
import { bbox, polygonArea, polylineLength, rectPoints } from './geometry.ts';
import { uid } from './project.ts';
import { fmt } from './units.ts';

// Concept proposals are STRUCTURED: each one is a list of geometry and material operations
// that the deterministic engine can cost. Pictures are attached separately and are illustrative only.
// The layout is derived from the drawn site outline and buildings, never from a photo.

export const ILLUSTRATIVE_LABEL = 'Illustrative concept only - not surveyed, not to scale, not for construction.';
export const INCLUSIONS = ['paving', 'wall', 'turf', 'garden', 'lighting', 'drainage', 'deck'] as const;
export const STYLES = ['Modern', 'Sydney sandstone', 'Mediterranean', 'Coastal native', 'Low-maintenance', 'Luxury'];

type Tier = DesignProposal['tier'];
interface TierSpec {
  name: string; paving: string; pattern: string; wall: (h: number) => { system: WallSystem; materialId: string }; edging: string;
  plant: string; spacing: number; lights: number; pavingDepth: number; pavingWidthShare: number;
  pros: string[]; cons: string[]; maintenance: string; adjective: string;
}

const TIERS: Record<Tier, TierSpec> = {
  economy: {
    name: 'Economy', adjective: 'Practical', paving: 'pav-concrete-400', pattern: 'stretcher', edging: 'edging-steel', plant: 'plant-lomandra', spacing: 0.8, lights: 4, pavingDepth: 2.5, pavingWidthShare: 0.6,
    wall: h => (h <= 0.8 ? { system: 'segmental-block', materialId: 'blk-versawall' } : { system: 'concrete-sleeper', materialId: 'slp-pioneer-2000-charcoal' }),
    pros: ['Lowest installed cost', 'Common products with short lead times', 'Simple shapes keep labour and cutting waste down'],
    cons: ['Plainer finish', 'Smaller paved area', 'Concrete pavers can fade over time'], maintenance: 'Low: wide-spaced hardy natives, occasional paver clean.',
  },
  balanced: {
    name: 'Balanced', adjective: 'Natural stone', paving: 'pav-travertine-610', pattern: 'stretcher', edging: 'edging-steel', plant: 'plant-lomandra', spacing: 0.6, lights: 6, pavingDepth: 3, pavingWidthShare: 0.75,
    wall: () => ({ system: 'concrete-sleeper', materialId: 'slp-pioneer-2000-charcoal' }),
    pros: ['Natural stone paving as the feature', 'Durable concrete sleeper wall, quick to install', 'Good value per square metre'],
    cons: ['Travertine needs sealing', 'Sleeper walls need engineered post embedment'], maintenance: 'Moderate: seal travertine, prune natives once or twice a year.',
  },
  premium: {
    name: 'Premium', adjective: 'Sandstone', paving: 'pav-sandstone-600x400', pattern: 'random', edging: 'edging-sandstone', plant: 'plant-westringia', spacing: 0.9, lights: 10, pavingDepth: 3.5, pavingWidthShare: 0.9,
    wall: () => ({ system: 'sandstone-block', materialId: 'sst-blocks-m2' }),
    pros: ['Sydney sandstone throughout', 'Largest entertaining area', 'Layered lighting'],
    cons: ['Highest material and labour cost', 'Heavy stone needs machine access or more labour', 'Natural stone varies and needs sealing'], maintenance: 'Moderate to high: seal sandstone, clean organic staining in shade, trim hedging.',
  },
};

const obj = (type: SiteObject['type'], name: string, points: SiteObject['points'], materialId: string | undefined, props: Record<string, any> = {}): SiteObject =>
  ({ id: uid('obj'), type, name, layer: 'proposed', points, materialId, confidence: 'estimated', props: { ...defaultProps(type), ...props } });

/** Usable yard: inside the site outline, beyond the house. Null when the site outline is not drawn. */
export function yardOf(project: Project) {
  const b = project.objects.find(o => o.type === 'boundary' && o.points.length >= 3);
  if (!b) return null;
  const bb = bbox(b.points);
  const houses = project.objects.filter(o => o.type === 'building');
  const front = houses.length ? Math.max(...houses.map(h => bbox(h.points).maxY)) : bb.minY;
  const y0 = Math.min(Math.max(front, bb.minY), bb.maxY - 3);
  return { x0: bb.minX, x1: bb.maxX, y0, y1: bb.maxY, w: bb.w, d: bb.maxY - y0 };
}

function layoutOps(project: Project, t: TierSpec, inc: Set<string>, materials: Material[]): DesignProposal['changes'] {
  const y = yardOf(project)!;
  const out: DesignProposal['changes'] = [];
  const m = (id: string) => materials.find(x => x.id === id)?.name ?? id;
  const add = (o: SiteObject, text: string) => out.push({ id: uid('chg'), text, op: { op: 'addObject', object: o } });
  const cx = (y.x0 + y.x1) / 2;
  let cursor = y.y0;
  if (inc.has('paving')) {
    const w = Math.max(2, Math.round((y.w - 1) * t.pavingWidthShare * 2) / 2), d = Math.min(t.pavingDepth, y.d * 0.45);
    const o = obj('paving', 'New paving', rectPoints(cx - w / 2, y.y0, w, d), t.paving, { pattern: t.pattern, fallPct: 1.5, fallTo: 'away from house (confirm outlet)' });
    add(o, `Add ${fmt(w * d, 1)} m² paving, ${fmt(w, 1)} × ${fmt(d, 1)} m (${m(t.paving)}, ${t.pattern})`);
    cursor = y.y0 + d;
  }
  const wallY = inc.has('wall') ? cursor + (y.y1 - cursor) * 0.45 : null;
  if (inc.has('turf')) {
    const top = cursor + 0.3, bottom = (wallY ?? y.y1 - 1.5) - 0.2;
    if (bottom - top > 0.8) { const o = obj('turf', 'Lawn', rectPoints(y.x0 + 1, top, y.w - 2, bottom - top), 'turf-sirwalter'); add(o, `Add ${fmt(polygonArea(o.points), 1)} m² turf (${m('turf-sirwalter')})`); }
  }
  if (wallY != null) {
    const h = 0.6, w = t.wall(h);
    const o = obj('wall', 'Retaining wall', [{ x: y.x0 + 1, y: wallY }, { x: y.x1 - 1, y: wallY }], w.materialId, { system: w.system, exposedHeight: h, retainedHeight: h, surcharge: 'unknown' });
    add(o, `Add ${fmt(y.w - 2, 1)} m retaining wall, 0.6 m exposed face (${WALL_SYSTEMS[w.system].label}). Height and loads to be measured.`);
  }
  if (inc.has('garden')) {
    const top = (wallY ?? cursor + 2) + 0.2, bottom = y.y1 - 0.2;
    if (bottom - top > 0.6) { const o = obj('garden', 'Garden bed', rectPoints(y.x0 + 1, top, y.w - 2, bottom - top), 'soil-garden-organic', { plantId: t.plant, plantSpacing: t.spacing }); add(o, `Add ${fmt(polygonArea(o.points), 1)} m² garden bed, ${m(t.plant)} at ${t.spacing} m centres`); }
    if (t.edging && inc.has('turf')) { const ey = (wallY ?? cursor + 2) - 0.2; const o = obj('edging', 'Lawn edge', [{ x: y.x0 + 1, y: ey }, { x: y.x1 - 1, y: ey }], t.edging); add(o, `Add ${fmt(y.w - 2, 1)} m garden edging (${m(t.edging)})`); }
  }
  if (inc.has('deck')) { const o = obj('deck', 'Deck', rectPoints(y.x1 - 4, y.y0, 3, 3), 'deck-merbau-90', { height: 0.4 }); add(o, 'Add 9 m² deck (merbau). Framing must come from a verified span table.'); }
  if (inc.has('lighting')) {
    const ly = (wallY ?? cursor + 1) - 0.15;
    for (let i = 0; i < t.lights; i++) { const x = y.x0 + 1.5 + ((y.w - 3) * (i + 0.5)) / t.lights; add(obj('light', `Garden light ${i + 1}`, [{ x, y: ly }], 'light-spike'), `Add garden light ${i + 1} (low-voltage spike)`); }
    const c = obj('cable', 'Lighting cable', [{ x: y.x0 + 0.5, y: y.y0 + 0.2 }, { x: y.x0 + 0.5, y: ly }, { x: y.x1 - 1, y: ly }], 'light-cable'); add(c, `Add ${fmt(polylineLength(c.points), 1)} m lighting cable route (preliminary; licensed electrician)`);
  }
  if (inc.has('drainage')) {
    const dy = cursor + 0.15;
    const d = obj('drain', 'Stormwater line', [{ x: cx, y: dy }, { x: y.x0 + 0.5, y: dy }, { x: y.x0 + 0.5, y: y.y0 + 0.3 }], 'pvc-100-stormwater', { kind: 'stormwater', dischargeTo: 'Existing stormwater - outlet NOT verified' });
    add(d, `Add ${fmt(polylineLength(d.points), 1)} m stormwater line as a concept route (outlet must be verified)`);
    add(obj('pit', 'Grated pit', [{ x: cx, y: dy }], 'pit-450'), 'Add one grated pit at the low edge of the paving');
  }
  return out;
}

function swapOps(project: Project, t: TierSpec, materials: Material[]): DesignProposal['changes'] {
  const m = (id: string) => materials.find(x => x.id === id)?.name ?? id;
  const out: DesignProposal['changes'] = [];
  for (const o of project.objects.filter(x => x.layer === 'proposed')) {
    if (o.type === 'wall') { const h = Number(o.props.retainedHeight ?? o.props.exposedHeight ?? 0); const w = t.wall(h); if (o.props.system !== w.system || o.materialId !== w.materialId) out.push({ id: uid('chg'), text: `${o.name}: change to ${WALL_SYSTEMS[w.system].label} (${m(w.materialId)})`, op: { op: 'setWallSystem', objectId: o.id, system: w.system, materialId: w.materialId } }); }
    else if (o.type === 'paving' && o.materialId !== t.paving) { out.push({ id: uid('chg'), text: `${o.name}: change paving to ${m(t.paving)}`, op: { op: 'setMaterial', objectId: o.id, materialId: t.paving } }); out.push({ id: uid('chg'), text: `${o.name}: ${t.pattern} laying pattern`, op: { op: 'setProp', objectId: o.id, prop: 'pattern', value: t.pattern } }); }
    else if (o.type === 'edging' && o.materialId !== t.edging) out.push({ id: uid('chg'), text: `${o.name}: change edging to ${m(t.edging)}`, op: { op: 'setMaterial', objectId: o.id, materialId: t.edging } });
    else if (o.type === 'garden' && o.props.plantId !== t.plant) { out.push({ id: uid('chg'), text: `${o.name}: plant ${m(t.plant)} at ${t.spacing} m centres`, op: { op: 'setProp', objectId: o.id, prop: 'plantId', value: t.plant } }); out.push({ id: uid('chg'), text: `${o.name}: plant spacing ${t.spacing} m`, op: { op: 'setProp', objectId: o.id, prop: 'plantSpacing', value: t.spacing } }); }
  }
  return out;
}

export function proposalCost(project: Project, ops: Op[], materials: Material[], suppliers: Supplier[], settings: CompanySettings) {
  const p1 = applyOps(project, ops);
  const est = computeEstimate(p1, takeoff(p1, materials), materials, suppliers);
  const checks = evaluateCompliance(p1, est.priceInc, settings);
  const newIds = new Set(ops.flatMap(o => (o.op === 'addObject' ? [o.object.id] : 'objectId' in o ? [o.objectId] : [])));
  return { project: p1, est, flags: checks.filter(c => c.status === 'potential' && (!c.objectId || newIds.has(c.objectId) || p1.objects.some(o => o.id === c.objectId && o.layer === 'proposed'))).map(c => `${c.title}: ${c.result}`) };
}

export function generateProposals(project: Project, brief: ProposalBrief, materials: Material[], suppliers: Supplier[], settings: CompanySettings): { proposals: DesignProposal[]; error?: string } {
  const hasDesign = project.objects.some(o => o.layer === 'proposed');
  if (!hasDesign && !yardOf(project)) return { proposals: [], error: 'Draw the site outline (and the house, if any) in Site Drawing first. Concept layouts are placed inside the drawn outline, not taken from photos.' };
  const inc = new Set(brief.inclusions);
  if (!hasDesign && inc.size === 0) return { proposals: [], error: 'Choose at least one item to include.' };
  const proposals = (Object.keys(TIERS) as Tier[]).map(tier => {
    const t = TIERS[tier];
    const changes = hasDesign ? swapOps(project, t, materials) : layoutOps(project, t, inc, materials);
    const c = proposalCost(project, changes.map(x => x.op), materials, suppliers, settings);
    const priced = c.est.flags.filter(f => /No price|Quantity incomplete/.test(f));
    const used = [...new Set(c.project.objects.filter(o => o.layer === 'proposed' && o.materialId).map(o => materials.find(m => m.id === o.materialId)?.name).filter(Boolean) as string[])];
    return {
      id: uid('prop'), tier, title: `${t.name}: ${t.adjective} ${brief.style.toLowerCase()}`.trim(),
      summary: hasDesign ? `Keeps the current layout and dimensions, using ${t.name.toLowerCase()} materials.` : `A ${brief.style.toLowerCase()} layout inside the drawn site outline with ${[...inc].join(', ')}, using ${t.name.toLowerCase()} materials.`,
      status: 'draft' as const, createdAt: new Date().toISOString(), brief: structuredClone(brief), changes,
      materials: used.slice(0, 8), pros: t.pros, cons: t.cons, maintenance: t.maintenance,
      costLow: Math.round(c.est.priceInc), costHigh: Math.round(c.est.priceInc * 1.15), costComplete: priced.length === 0, excluded: priced,
      assumptions: [
        hasDesign ? 'Uses the current drawn dimensions' : 'Positions and sizes are proposed from the drawn site outline; measure on site before quoting',
        'Upper end of the range adds 15% for unverified measurements and site conditions (assumption)',
        'Labour rates and productivity from Estimate settings (assumptions)',
        ...(c.est.assumed.length ? [`${c.est.assumed.length} items priced from project allowances`] : []),
        ...(brief.constraints ? [`Constraints noted: ${brief.constraints}`] : []),
      ],
      reviewFlags: [...new Set(c.flags)],
      renders: [],
    } satisfies DesignProposal;
  });
  return { proposals };
}

/** Customer picks a direction. Records who and when; does not change geometry. */
export function selectProposal(project: Project, id: string, customerName: string, by: string, note?: string): Project {
  const p = structuredClone(project);
  for (const x of p.proposals ?? []) {
    if (x.id === id) { x.status = 'customer-selected'; x.selection = { by, customerName, date: new Date().toISOString(), note }; }
    else if (x.status === 'customer-selected') { x.status = 'draft'; delete x.selection; }
  }
  if (['draft', 'concept'].includes(p.status)) p.status = 'customer-selected';
  p.audit.push({ at: new Date().toISOString(), by, action: `Customer ${customerName || '(unnamed)'} selected concept "${p.proposals?.find(x => x.id === id)?.title}"` });
  return p;
}

/**
 * Apply only the approved changes of the selected proposal to the authoritative geometry.
 * Saves a "before" version and an "after" version carrying the proposal's renders.
 */
export function applyProposal(project: Project, id: string, approvedChangeIds: string[], by: string): Project {
  const prop = project.proposals?.find(x => x.id === id);
  if (!prop) throw new Error('Proposal not found');
  if (prop.status !== 'customer-selected') throw new Error('Record the customer selection before applying a concept');
  const ops = prop.changes.filter(c => approvedChangeIds.includes(c.id)).map(c => c.op);
  if (!ops.length) throw new Error('No changes approved');
  const now = new Date().toISOString();
  const before = { id: uid('ver'), name: `Before "${prop.title}"`, date: now, objects: structuredClone(project.objects) };
  const p = applyOps(project, ops);
  const after = { id: uid('ver'), name: `Customer choice: ${prop.title}`, date: now, objects: structuredClone(p.objects), proposalId: prop.id, renderIds: prop.renders.map(r => r.id), note: `Selected by ${prop.selection?.customerName ?? ''} on ${prop.selection?.date.slice(0, 10) ?? ''}; ${ops.length} of ${prop.changes.length} changes approved by ${by}` };
  p.versions = [...project.versions, before, after];
  const q = p.proposals!.find(x => x.id === id)!;
  q.status = 'applied'; q.appliedVersionId = after.id; q.approvedChangeIds = approvedChangeIds;
  p.activeProposalId = id;
  p.audit.push({ at: now, by, action: `Applied ${ops.length} approved changes from "${prop.title}" (versions saved)` });
  return p;
}

export const isGeometryOp = (o: Op) => o.op === 'addObject' || o.op === 'setLength' || o.op === 'setRect' || (o.op === 'removeObject');
export { GEOM };
