import type { Project, SiteObject } from './types.ts';
import { newProject } from './project.ts';
import { rectPoints } from './geometry.ts';
import { defaultProps } from './assemblies.ts';

// SYNTHETIC demonstration project. No real customer, address, survey or supplier quote.

export const DEMO_ID = 'prj_demo_backyard';

export function demoProject(): Project {
  const p = newProject('DEMO (synthetic): Residential Backyard Transformation');
  p.id = DEMO_ID;
  p.synthetic = true;
  p.customer = { id: 'cus_demo', name: 'Demo Customer (synthetic)', phone: '0400 000 000', email: 'demo@example.com' };
  p.site = { address: '1 Example Street (synthetic address)', suburb: 'Sydney', council: 'Northern Beaches Council', lotAreaM2: 550, access: 'restricted', heritage: 'no', floodControlLot: 'no', bushfire: 'unknown', easements: 'unknown', nearWaterbody: 'no', conditions: 'Existing concrete patio at rear of house. Rear garden slopes up towards the back fence (about 0.6 m, estimated from photos). Side access about 1.1 m wide.' };
  p.brief = { description: 'Replace tired patio with stone paving, terrace the sloping rear garden with a low retaining wall, add planting, surface drainage and garden lighting.', scope: 'Paving, low retaining wall, garden bed and planting, turf, drainage, lighting', budgetMin: 20000, budgetMax: 30000, preferredMaterials: 'Natural stone look paving, low-maintenance natives', targetCompletion: 'Autumn', notes: 'All figures in this project are synthetic and for demonstration only.' };
  p.status = 'concept';
  p.estimate.accessFactor = 1.15;
  p.estimate.extras = [
    { id: 'x1', category: 'equipment', desc: 'Mini excavator hire, dry (ASSUMPTION)', qty: 1, unit: 'day', rate: 400, assumption: true },
    { id: 'x2', category: 'disposal', desc: 'Spoil cart-away and tipping (ASSUMPTION rate)', qty: 9, unit: 'm3', rate: 90, assumption: true },
    { id: 'x4', category: 'delivery', desc: 'Delivery allowance, 3 suppliers (ASSUMPTION)', qty: 3, unit: 'order', rate: 120, assumption: true },
    { id: 'x3', category: 'subcontract', desc: 'Licensed electrician: lighting connection (ASSUMPTION allowance)', qty: 1, unit: 'item', rate: 600, assumption: true },
  ];
  const o = (type: SiteObject['type'], name: string, layer: SiteObject['layer'], points: SiteObject['points'], extra: Partial<SiteObject> = {}, props: Record<string, any> = {}): SiteObject =>
    ({ id: `demo_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`, type, name, layer, points, confidence: 'estimated', props: { ...defaultProps(type), ...props }, ...extra });
  const A = (price: number) => ({ price, note: 'DEMO ASSUMPTION, not a supplier price' });
  p.priceAssumptions = {
    'sand-bedding': A(120), 'edge-restraint': A(12), 'mulch': A(110), 'plant-lomandra': A(9), 'pvc-100-stormwater': A(14),
    'pit-450': A(95), 'light-cable': A(4), 'light-spike': A(85), 'post-h-tbc': A(85), 'sand-jointing': A(25),
  };
  p.objects = [
    o('boundary', 'Site outline (rear yard)', 'existing', rectPoints(0, 0, 12, 9.5), { confidence: 'verified', locked: true }),
    o('building', 'House (rear wall)', 'existing', rectPoints(1.5, 0, 9, 1.2), { locked: true }),
    o('feature', 'Existing concrete patio', 'existing', rectPoints(3, 1.2, 6, 2), {}, { note: 'To be demolished' }),
    o('fence', 'Rear fence', 'existing', [{ x: 0, y: 9.5 }, { x: 12, y: 9.5 }]),
    o('tree', 'Existing tree', 'existing', [{ x: 10.6, y: 8.6 }], {}, { dbh: 0.3, retain: true, species: 'Not identified', spread: 4 }),
    o('paving', 'New paving', 'proposed', rectPoints(2.5, 1.2, 7, 3), { materialId: 'pav-travertine-610', confidence: 'verified' }, { pattern: 'stretcher', fallPct: 1.5, fallTo: 'channel drain (to be confirmed)', cutFill: 0.1, jointCoverage: 5 }),
    o('turf', 'Lawn', 'proposed', rectPoints(1, 4.5, 10, 1.6), { materialId: 'turf-sirwalter' }),
    o('wall', 'Retaining wall', 'proposed', [{ x: 1, y: 6.3 }, { x: 11, y: 6.3 }], { materialId: 'slp-pioneer-2000-charcoal' }, { system: 'concrete-sleeper', exposedHeight: 0.6, retainedHeight: 0.6, surcharge: 'slope', distToBoundary: 1 }),
    o('garden', 'Raised garden bed', 'proposed', rectPoints(1, 6.5, 10, 2.8), { materialId: 'soil-garden-organic' }, { plantId: 'plant-lomandra', plantSpacing: 0.6 }),
    o('drain', 'Stormwater line', 'proposed', [{ x: 2.3, y: 4.35 }, { x: 0.5, y: 4.35 }, { x: 0.5, y: 0.6 }], { materialId: 'pvc-100-stormwater' }, { kind: 'stormwater', dischargeTo: 'Existing stormwater (connection NOT verified)' }),
    o('pit', 'Grated pit', 'proposed', [{ x: 2.3, y: 4.35 }], { materialId: 'pit-450' }),
    o('cable', 'Lighting cable', 'proposed', [{ x: 1.5, y: 1.4 }, { x: 1.5, y: 6.1 }, { x: 10.5, y: 6.1 }], { materialId: 'light-cable' }),
    ...[2.5, 5, 7.5, 10].map((x, i) => o('light', `Garden light ${i + 1}`, 'proposed', [{ x, y: 6.1 }], { materialId: 'light-spike' })),
    o('level', 'Level at patio', 'existing', [{ x: 6, y: 4.3 }], {}, { rl: 10.0, note: 'Assumed site datum' }),
    o('level', 'Level at rear garden', 'existing', [{ x: 6, y: 7.5 }], {}, { rl: 10.6, note: 'Estimated from photos' }),
  ];
  const d = '2026-11-10';
  p.measurements = [
    { id: 'm1', label: 'Yard width (side fence to side fence)', value: 12.0, method: 'laser', source: 'Synthetic demo data', confidence: 'verified', date: d, verifiedBy: 'Demo user', link: { objectId: 'demo_site_outline_rear_yard_', a: 0, b: 1 } },
    { id: 'm2', label: 'Yard depth (house line to rear fence)', value: 9.5, method: 'laser', source: 'Synthetic demo data', confidence: 'verified', date: d, verifiedBy: 'Demo user', link: { objectId: 'demo_site_outline_rear_yard_', a: 1, b: 2 } },
    { id: 'm3', label: 'New paving width', value: 7.0, method: 'tape', source: 'Synthetic demo data', confidence: 'verified', date: d, verifiedBy: 'Demo user', link: { objectId: 'demo_new_paving', a: 0, b: 1 } },
    { id: 'm4', label: 'New paving depth', value: 3.0, method: 'tape', source: 'Synthetic demo data', confidence: 'verified', date: d, verifiedBy: 'Demo user', link: { objectId: 'demo_new_paving', a: 1, b: 2 } },
    { id: 'm5', label: 'New paving diagonal', value: 7.616, method: 'tape', source: 'Synthetic demo data', confidence: 'verified', date: d, verifiedBy: 'Demo user', link: { objectId: 'demo_new_paving', a: 0, b: 2 } },
    { id: 'm6', label: 'Retaining wall length', value: 10, method: 'photo-estimate', source: 'Estimated from site photo (synthetic)', confidence: 'estimated', date: d, link: { objectId: 'demo_retaining_wall', a: 0, b: 1 } },
    { id: 'm7', label: 'Retained height at wall', value: 0.6, method: 'photo-estimate', source: 'Estimated from site photo (synthetic)', confidence: 'estimated', date: d, link: { objectId: 'demo_retaining_wall', prop: 'retainedHeight' } },
  ];
  p.audit.push({ at: new Date().toISOString(), by: 'system', action: 'Synthetic demonstration data loaded' });
  return p;
}
